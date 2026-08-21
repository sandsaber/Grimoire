import { spawn } from 'node:child_process';

const SQLITE_READ_TIMEOUT_MS = 10_000;
const SQLITE_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

const NODE_SQLITE_READER_SCRIPT = String.raw`
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const request = JSON.parse(input);
    db = new DatabaseSync(request.databasePath, { readonly: true });
    const rows = request.queries.map(query => db.prepare(query.sql).all(...query.params));
    process.stdout.write(JSON.stringify(rows));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (db) db.close();
  }
});
`;

export interface AcpSqliteQuery {
  params?: unknown[];
  sql: string;
}

export async function readAcpSqliteRows<Row extends Record<string, unknown>>(
  databasePath: string,
  queries: AcpSqliteQuery[],
): Promise<Row[][] | null> {
  if (!databasePath || queries.length === 0) {
    return null;
  }

  const normalizedQueries = queries.map(query => ({
    params: query.params ?? [],
    sql: query.sql,
  }));
  const nodeOutput = await runBufferedProcess(
    process.execPath,
    ['-e', NODE_SQLITE_READER_SCRIPT],
    JSON.stringify({ databasePath, queries: normalizedQueries }),
    {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  );
  const nodeRows = parseRowSets<Row>(nodeOutput, queries.length);
  if (nodeRows) {
    return nodeRows;
  }

  let cliOutputs: Array<string | null>;
  try {
    cliOutputs = await Promise.all(normalizedQueries.map(query => runBufferedProcess(
      'sqlite3',
      ['-json', databasePath, bindSqliteQuery(query.sql, query.params)],
    )));
  } catch {
    return null;
  }
  const cliRows = cliOutputs.map(output => parseRows<Row>(output));
  return cliRows.every((rows): rows is Row[] => rows !== null) ? cliRows : null;
}

function runBufferedProcess(
  command: string,
  args: string[],
  stdin = '',
  env?: NodeJS.ProcessEnv,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    let output = '';
    let outputBytes = 0;
    const finish = (value: string | null, terminate = false): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (terminate && child.exitCode === null) {
        child.kill();
      }
      resolve(value);
    };
    const timeoutId = window.setTimeout(
      () => finish(null, true),
      SQLITE_READ_TIMEOUT_MS,
    );

    child.on('error', () => finish(null, true));
    child.on('close', code => finish(code === 0 ? output : null));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > SQLITE_MAX_OUTPUT_BYTES) {
        finish(null, true);
        return;
      }
      output += chunk;
    });
    child.stdin.on('error', () => finish(null, true));
    child.stdin.end(stdin);
  });
}

function parseRowSets<Row extends Record<string, unknown>>(
  output: string | null,
  expectedCount: number,
): Row[][] | null {
  if (output === null) return null;
  try {
    const parsed = JSON.parse(output || '[]') as unknown;
    if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;
    const rowSets = parsed.map(value => normalizeRows<Row>(value));
    return rowSets.every((rows): rows is Row[] => rows !== null) ? rowSets : null;
  } catch {
    return null;
  }
}

function parseRows<Row extends Record<string, unknown>>(output: string | null): Row[] | null {
  if (output === null) return null;
  try {
    return normalizeRows<Row>(JSON.parse(output || '[]') as unknown);
  } catch {
    return null;
  }
}

function normalizeRows<Row extends Record<string, unknown>>(value: unknown): Row[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((row): row is Row => (
    row !== null && typeof row === 'object' && !Array.isArray(row)
  ));
}

/**
 * The query the sqlite3 CLI is given, with parameters inlined.
 *
 * Exported for the gate below it rather than for a caller: the primary reader
 * binds parameters through `node:sqlite`, and this fallback cannot — the CLI
 * takes a statement and nothing else. So the escaping *is* the safety, and it
 * is asserted directly instead of trusted: strings have their quotes doubled,
 * every non-string is a type this function recognises, and anything else
 * throws rather than being interpolated.
 */
export function bindSqliteQuery(sql: string, params: unknown[]): string {
  let parameterIndex = 0;
  const bound = sql.replaceAll('?', () => {
    if (parameterIndex >= params.length) {
      throw new Error('SQLite query has more placeholders than parameters');
    }
    const value = params[parameterIndex];
    parameterIndex += 1;
    return toSqliteLiteral(value);
  });
  if (parameterIndex !== params.length) {
    throw new Error('SQLite query has more parameters than placeholders');
  }
  return `${bound};`;
}

function toSqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') return `'${value.replaceAll('\'', '\'\'')}'`;
  throw new Error(`Unsupported SQLite parameter type: ${typeof value}`);
}
