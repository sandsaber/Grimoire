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
      'claude-flip-smoke-matrix.md',
      'codex-flip-smoke-matrix.md',
      'gemini-flip-smoke-matrix.md',
      'grok-flip-smoke-matrix.md',
      'mimocode-flip-smoke-matrix.md',
      'opencode-flip-smoke-matrix.md',
    ]);
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
      'claude-flip-smoke-matrix.md: 2026-08-21',
      'codex-flip-smoke-matrix.md: 2026-08-21',
      // Run, and mostly blocked — by the account's daily quota rather than by
      // the flip. What it found before running out is in that matrix: three
      // defects, two of them shipped.
      'gemini-flip-smoke-matrix.md: 2026-08-23',
      'grok-flip-smoke-matrix.md: 2026-08-21',
      // Run, and mostly red — for a reason the matrix states rather than the
      // flip: that account cannot generate. A date here is "when did this last
      // run", not "did it pass".
      'mimocode-flip-smoke-matrix.md: 2026-08-22',
      'opencode-flip-smoke-matrix.md: 2026-08-21',
    ]);
  });
});
