import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * When each live smoke matrix was last run, and whether it ever was.
 *
 * The matrices are deliberately manual: they need a real CLI in a real vault,
 * and no CI job can stand in for a person looking at a rendered tool card. The
 * cost of that is that nothing anywhere says *when* one last ran — the only
 * record is each matrix's own table, four documents deep, and two of them had
 * no table at all. A matrix nobody has run then looks exactly like a matrix
 * that passed.
 *
 * This gate makes that state readable in one place. It does not require a run;
 * it requires an answer, and `never` is one.
 */
const DOCS = resolve(process.cwd(), 'docs');
const HARNESSES = resolve(process.cwd(), 'tests/integration');

/**
 * Every live harness in the repository, by file name.
 *
 * Read from the tests rather than listed, for the same reason the rows below
 * are: a harness whose matrix does not exist is invisible here, and looks
 * exactly like a surface with nothing to record. Two were — Antigravity for
 * four days and Kimi Code from its flip — and neither absence was noticeable in
 * a list of files that were present.
 *
 * **Scanned by file rather than by provider directory, and that is the second
 * version of this reader.** The first walked `app/execution/<provider>/` and
 * matched a matrix by the directory's name, which made "has a live harness" and
 * "is a provider" the same question. The chat projection flip is one surface
 * across nine providers: its harness lives under `app/chat/`, and the first
 * reader could not see it at all — a gate over a subset reads exactly like a
 * gate over everything.
 */
function liveHarnesses(directory: string = HARNESSES): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory()
      ? liveHarnesses(join(directory, entry.name))
      : entry.name.includes('LiveSmoke') ? [entry.name] : []))
    .sort();
}

interface MatrixRecord {
  readonly file: string;
  readonly rows: readonly string[][];
}

function readMatrices(): MatrixRecord[] {
  return readdirSync(DOCS)
    .filter(name => name.endsWith('-smoke-matrix.md'))
    .sort()
    .map(file => ({ file, rows: recordRows(readFileSync(join(DOCS, file), 'utf8')) }));
}

/** The data rows of the `## Record` table, split into cells. */
function recordRows(source: string): string[][] {
  const section = source.split(/^## Record$/m)[1];
  if (section === undefined) {
    return [];
  }
  return section
    .split('\n')
    .filter(line => line.startsWith('|'))
    // The header and its separator are the first two table lines.
    .slice(2)
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length >= 5);
}

describe('live smoke matrix records', () => {
  const matrices = readMatrices();

  it('finds every matrix in the docs directory', () => {
    // Guards the reader: a parser that silently matched nothing would make
    // every assertion below vacuously true.
    expect(matrices.map(matrix => matrix.file)).toEqual([
      'antigravity-flip-smoke-matrix.md',
      // Not a provider's matrix: the chat projection flip is one surface across
      // every provider, gated per provider by the list it names.
      'chat-projection-flip-smoke-matrix.md',
      'claude-flip-smoke-matrix.md',
      'codex-flip-smoke-matrix.md',
      'gemini-flip-smoke-matrix.md',
      'grok-flip-smoke-matrix.md',
      'kimicode-flip-smoke-matrix.md',
      'mimocode-flip-smoke-matrix.md',
      'opencode-flip-smoke-matrix.md',
      'qwen-flip-smoke-matrix.md',
    ]);
  });

  it('finds the harnesses it is meant to be pairing', () => {
    // Guards the other reader, and it needed guarding: a `readdirSync` filter
    // that matched nothing left the pairing below asserting that an empty list
    // contains nothing, which it always does. The same shape as the D7 guard's
    // own first-run defect, caught the same way — by breaking it.
    expect(liveHarnesses()).toEqual([
      // Not a provider's, and the reason this list is files rather than
      // directories: the chat projection flip is one surface across nine
      // providers, certified one at a time.
      'AntigravityChatProjectionLiveSmoke.integration.test.ts',
      'AntigravityLiveSmoke.integration.test.ts',
      'ClaudeChatProjectionLiveSmoke.integration.test.ts',
      'ClaudeLiveSmoke.integration.test.ts',
      'CodexChatProjectionLiveSmoke.integration.test.ts',
      'CodexLiveSmoke.integration.test.ts',
      'GeminiLiveSmoke.integration.test.ts',
      'GrokChatProjectionLiveSmoke.integration.test.ts',
      'GrokLiveSmoke.integration.test.ts',
      'KimicodeLiveSmoke.integration.test.ts',
      'MimocodeLiveSmoke.integration.test.ts',
      'OpencodeChatProjectionLiveSmoke.integration.test.ts',
      'OpencodeLiveSmoke.integration.test.ts',
      'QwenLiveSmoke.integration.test.ts',
    ]);
  });

  it('gives every live harness a matrix that names it', () => {
    const harnesses = liveHarnesses();
    // Guards the reader, which walks a tree: one that found nothing would make
    // the assertion below vacuous, and a wrong root is silent.
    expect(harnesses.length).toBeGreaterThan(0);
    const sources = matrices.map(matrix => readFileSync(join(DOCS, matrix.file), 'utf8')).join('\n');

    // Not every matrix needs a harness — a surface can have rows only a person
    // can run — but a harness with nowhere to write down what it found is a run
    // nobody outside the journal will ever see. Matched by name rather than by
    // directory, so a harness that is not a provider's still has to say where
    // its results go.
    // By the harness's own identifier rather than its whole file name: a matrix
    // may cite it with or without the `.integration.test.ts` suffix, and which
    // one it chose is not what this is asking about.
    expect(harnesses.filter(harness => !sources.includes(harness.split('.')[0] ?? ''))).toEqual([]);
  });

  it.each(matrices.map(matrix => matrix.file))('%s records whether it has ever run', file => {
    const matrix = matrices.find(entry => entry.file === file);

    expect(matrix?.rows.length ?? 0).toBeGreaterThan(0);
  });

  it.each(matrices.map(matrix => matrix.file))('%s dates every run it claims', file => {
    const matrix = matrices.find(entry => entry.file === file);
    const dates = (matrix?.rows ?? []).map(cells => cells[0]);

    // `never` is an answer. A row with anything else has to be a date, because
    // "when did this last run" is the whole question this table exists for.
    for (const date of dates) {
      expect(date === 'never' || /^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(true);
    }
  });

  it('says in one place when each matrix last ran', () => {
    const status = matrices.map(matrix => {
      const dated = matrix.rows
        .map(cells => cells[0])
        .filter(date => date !== 'never')
        .sort();
      return `${matrix.file}: ${dated.at(-1) ?? 'never'}`;
    });

    // Printed by being asserted: the expectation is the summary, so a reader
    // who wants the answer reads this line rather than four documents. Update
    // it in the same commit as the run it records.
    expect(status).toEqual([
      // The only provider whose automated half is fully green on this machine,
      // and the last to get a matrix: its rows lived in the journal for four
      // days, where the assertion above could not see them.
      'antigravity-flip-smoke-matrix.md: 2026-08-23',
      // Antigravity's chat projection flip, driven half only: the rows a person
      // has to watch in a vault are outstanding under the standing override.
      'chat-projection-flip-smoke-matrix.md: 2026-08-27',
      'claude-flip-smoke-matrix.md: 2026-08-21',
      'codex-flip-smoke-matrix.md: 2026-08-21',
      // Run, and mostly blocked — by the account's daily quota rather than by
      // the flip. What it found before running out is in that matrix: three
      // defects, two of them shipped.
      'gemini-flip-smoke-matrix.md: 2026-08-23',
      'grok-flip-smoke-matrix.md: 2026-08-21',
      // Run, and every row that needs an answer blocked — this CLI is not
      // logged in here. Written last of the eight, and worth the run anyway:
      // it found a shipped defect on a path an authenticated account never
      // takes. A date is "when did this last run", not "did it pass".
      'kimicode-flip-smoke-matrix.md: 2026-08-23',
      // Run, and mostly red — for a reason the matrix states rather than the
      // flip: that account cannot generate. A date here is "when did this last
      // run", not "did it pass".
      'mimocode-flip-smoke-matrix.md: 2026-08-22',
      'opencode-flip-smoke-matrix.md: 2026-08-21',
      // Run, and every row blocked — the CLI is not authenticated here, so no
      // session has ever opened. A date is "when did this last run", not "did
      // it pass", and this run found a defect before it could pass anything.
      'qwen-flip-smoke-matrix.md: 2026-08-23',
    ]);
  });
});
