import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Keeps the cross-platform job's selection honest.
 *
 * The matrix selects suites with a regular expression, which is the only form
 * that works on both path separators. The cost is that a new suite is included
 * by accident of where it was filed: the Windows job has already failed once by
 * selecting nothing at all, and it would have reported green had
 * `--passWithNoTests` been added. A pattern that quietly matches *fewer* files
 * than intended fails the same way and is harder to see, so the set the matrix
 * must cover is asserted here rather than assumed.
 *
 * Scope is deliberate: the matrix exists for process ownership, termination,
 * and platform primitives. Provider protocol state machines are
 * platform-independent and stay in `validate`, which runs every suite.
 */

const WORKFLOW_PATH = '.github/workflows/ci.yml';

/** Directories whose every suite has to run on all three platforms. */
const PLATFORM_SENSITIVE_ROOTS = [
  'tests/unit/core/execution',
  'tests/unit/app/execution',
  'tests/integration/app/execution',
];

function readWorkflow(): string {
  return readFileSync(resolve(process.cwd(), WORKFLOW_PATH), 'utf8');
}

/** Extracts the `--testPathPatterns` arguments from the execution matrix job. */
function selectionPatterns(): RegExp[] {
  const workflow = readWorkflow();
  const jobStart = workflow.indexOf('  execution-platforms:');
  expect(jobStart).toBeGreaterThan(-1);
  const job = workflow.slice(jobStart);
  const patterns = [...job.matchAll(/--testPathPatterns "([^"]+)"/g)].map(match => match[1]);
  expect(patterns.length).toBeGreaterThan(0);
  // Compiled exactly as written: bash passes the double-quoted argument
  // through unchanged, so Jest builds its expression from these same
  // characters and matches it against absolute paths on the runner.
  return patterns.map(pattern => new RegExp(pattern));
}

function collectTestFiles(root: string): string[] {
  const absoluteRoot = resolve(process.cwd(), root);
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.test.ts')) {
        found.push(relative(process.cwd(), path));
      }
    }
  };
  walk(absoluteRoot);
  return found.sort();
}

describe('cross-platform execution coverage', () => {
  const patterns = selectionPatterns();

  function isSelected(repoRelativePath: string): boolean {
    // Jest applies the pattern to the absolute path, so both separators are
    // exercised: POSIX here, and the same expression against a Windows path.
    const posix = `/home/runner/work/Grimoire/Grimoire/${repoRelativePath}`;
    const windows = `C:\\a\\Grimoire\\Grimoire\\${repoRelativePath.replaceAll('/', '\\')}`;
    return patterns.some(pattern => pattern.test(posix))
      && patterns.some(pattern => pattern.test(windows));
  }

  it.each(PLATFORM_SENSITIVE_ROOTS)('selects every suite under %s', root => {
    const suites = collectTestFiles(root);

    expect(suites.length).toBeGreaterThan(0);
    expect(suites.filter(suite => !isSelected(suite))).toEqual([]);
  });

  it('selects nothing outside the platform-sensitive roots', () => {
    // A pattern that widened by accident would run UI suites on three
    // platforms and blame the matrix for their flakiness.
    const strays = collectTestFiles('tests')
      .filter(suite => isSelected(suite))
      .filter(suite => !PLATFORM_SENSITIVE_ROOTS.some(root => suite.startsWith(`${root}/`)));

    expect(strays).toEqual([]);
  });

  it('never allows an empty selection to pass', () => {
    // The near-miss worth remembering: adding this flag would have turned the
    // Windows failure into a green job that ran zero tests. The comment that
    // says so is not the flag, so only executable lines are inspected.
    const commands = readWorkflow()
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'));

    expect(commands.join('\n')).not.toContain('--passWithNoTests');
  });

  it('resolves the platform-sensitive roots to real directories', () => {
    // Guards the guard: a renamed directory would otherwise make the
    // assertions above vacuous instead of failing.
    for (const root of PLATFORM_SENSITIVE_ROOTS) {
      expect(statSync(resolve(process.cwd(), root)).isDirectory()).toBe(true);
    }
    expect(sep).toBeTruthy();
  });
});
