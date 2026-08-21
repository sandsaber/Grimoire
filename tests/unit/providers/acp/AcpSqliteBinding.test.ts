import { bindSqliteQuery } from '@/providers/acp/history/AcpSqliteReader';

/**
 * What the sqlite3 CLI fallback is allowed to build.
 *
 * The primary reader binds parameters through `node:sqlite`. This fallback
 * cannot — the CLI takes a statement and nothing else — so the escaping is the
 * safety, and an untested escaper is a claim rather than a guarantee.
 */
describe('sqlite parameter binding for the CLI fallback', () => {
  it('doubles the quotes in a string, which is what closes the injection', () => {
    expect(bindSqliteQuery('SELECT * FROM t WHERE id = ?', ["o'brien"]))
      .toBe("SELECT * FROM t WHERE id = 'o''brien';");
  });

  it('survives the shapes an attacker would reach for', () => {
    const hostile = "'; DROP TABLE sessions; --";

    const sql = bindSqliteQuery('SELECT * FROM t WHERE id = ?', [hostile]);

    // One literal, still one statement: the closing quote never lands early.
    expect(sql).toBe("SELECT * FROM t WHERE id = '''; DROP TABLE sessions; --';");
  });

  it('writes numbers, booleans and null without quoting them', () => {
    expect(bindSqliteQuery('SELECT ?, ?, ?, ?', [42, true, false, null]))
      .toBe('SELECT 42, 1, 0, NULL;');
  });

  it('refuses a type it cannot render rather than interpolating it', () => {
    // The rule that makes the rest of this safe: anything not recognised is an
    // error, not a `String(value)`.
    expect(() => bindSqliteQuery('SELECT ?', [{ nested: 'object' }]))
      .toThrow(/Unsupported SQLite parameter type/);
    expect(() => bindSqliteQuery('SELECT ?', [Number.NaN]))
      .toThrow(/Unsupported SQLite parameter type/);
  });

  it('refuses a query whose placeholders and parameters disagree', () => {
    expect(() => bindSqliteQuery('SELECT ?, ?', ['one']))
      .toThrow(/more placeholders than parameters/);
    expect(() => bindSqliteQuery('SELECT ?', ['one', 'two']))
      .toThrow(/more parameters than placeholders/);
  });
});
