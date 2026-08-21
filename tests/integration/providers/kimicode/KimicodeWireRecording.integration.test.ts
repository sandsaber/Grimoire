import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * What `kimi acp` actually says on the wire.
 *
 * A wire recording is the precondition the migration plan puts before a flip:
 * the shapes a provider really sends, taken from the provider rather than
 * guessed from a sibling's adapter. Kimi Code had none — MiMoCode's is partial
 * and Kimi's was absent — which is what blocked wave 6 from starting on it.
 *
 * Off by default, because it starts the CLI. Run it with
 * `GRIMOIRE_KIMICODE_RECORD=1`, and it rewrites the fixture in place.
 *
 * **Redaction is part of recording, not a step after it.** The first Grok
 * capture carried a live API key, and two fixtures carried the recorder's home
 * directory into everyone's clone. Everything written here goes through
 * `redact` first, and `wireFixtureRedaction.test.ts` refuses the file if
 * anything got past it.
 */
const record = process.env.GRIMOIRE_KIMICODE_RECORD === '1' ? describe : describe.skip;

const FIXTURE = resolve(
  process.cwd(),
  'tests/fixtures/provider-traces/wire/kimicode-wire.json',
);

/** One line on the wire, in the shape the other recordings already use. */
interface Exchange {
  readonly seq: number;
  readonly direction: 'client->server' | 'server->client';
  readonly message: Record<string, unknown>;
}

/** Strings this long are content, and a recording is evidence of shape. */
const MAX_STRING = 200;

/**
 * Replaces anything that identifies the machine or authorises anything.
 *
 * Home directories become a placeholder, and credential-shaped strings a
 * marker: a recording is published to everyone who clones the repository, and
 * what it is *for* is the shape of the traffic, which neither of those carries.
 */
function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    const scrubbed = value
      .replaceAll(/\/home\/[A-Za-z0-9._-]+/g, '/home/grimoire')
      .replaceAll(/\/Users\/[A-Za-z0-9._-]+/g, '/Users/grimoire')
      .replaceAll(/\b(?:sk|xai|ghp)-[A-Za-z0-9_-]{16,}\b/g, '<redacted-credential>');
    return scrubbed.length > MAX_STRING
      ? `${scrubbed.slice(0, MAX_STRING)}… (elided)`
      : scrubbed;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, redact(nested)]),
    );
  }
  return value;
}

record('Kimi Code wire recording', () => {
  jest.setTimeout(180_000);

  it('records what the CLI answers, redacted', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-kimicode-wire-'));
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const exchanges: Exchange[] = [];
    const child = spawn(process.env.GRIMOIRE_KIMICODE_CLI ?? 'kimi', ['acp'], {
      cwd: vault,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffered = '';
    child.stdout.on('data', chunk => {
      buffered += String(chunk);
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          try {
            exchanges.push({
              seq: exchanges.length + 1,
              direction: 'server->client',
              message: JSON.parse(line) as Record<string, unknown>,
            });
          } catch {
            // A line that is not JSON is the CLI talking to a human, and a
            // recording is about the protocol.
          }
        }
        newline = buffered.indexOf('\n');
      }
    });

    const send = (message: Record<string, unknown>): void => {
      exchanges.push({ seq: exchanges.length + 1, direction: 'client->server', message });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const settle = (ms: number): Promise<void> => new Promise(done => {
      setTimeout(done, ms);
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      },
    });
    await settle(3_000);
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: vault, mcpServers: [] },
    });
    await settle(5_000);

    child.stdin.end();
    child.kill();
    rmSync(vault, { force: true, recursive: true });

    const agentPayloads = exchanges.filter(exchange => exchange.direction === 'server->client');
    // A recording of nothing would be worse than none: it would look taken.
    expect(agentPayloads.length).toBeGreaterThan(0);

    const methods = new Set<string>();
    const updates = new Set<string>();
    for (const { message: payload } of agentPayloads) {
      if (typeof payload.method === 'string') {
        methods.add(payload.method);
        const params = payload.params as { update?: { sessionUpdate?: unknown } } | undefined;
        if (typeof params?.update?.sessionUpdate === 'string') {
          updates.add(params.update.sessionUpdate);
        }
      }
    }

    const version = agentPayloads
      .map(({ message: payload }) => (payload.result as { agentInfo?: { version?: unknown } } | undefined)
        ?.agentInfo?.version)
      .find((value): value is string => typeof value === 'string');

    // Whether the account this ran under could open a session at all. An
    // unauthenticated CLI answers `session/new` with an error, and that is a
    // real shape a flip meets — but it is not the prompt traffic, so the
    // recording says which half it holds rather than looking complete.
    const authenticated = !agentPayloads.some(({ message: payload }) => (
      /authentication/i.test(String((payload.error as { message?: unknown } | undefined)?.message))
    ));

    writeFileSync(FIXTURE, `${JSON.stringify(redact({
      schemaVersion: 1,
      providerId: 'kimicode',
      kind: 'wire-recording',
      recordedAgainst: `kimi ${version ?? 'unknown'}`,
      transport: 'stdio JSON-RPC 2.0 (`kimi acp`)',
      coverage: authenticated ? 'complete' : 'unauthenticated',
      note: authenticated
        ? undefined
        : 'Recorded on a machine where `kimi` is installed but not logged in: '
          + '`initialize` is complete and `session/new` is the refusal an '
          + 'unauthenticated CLI gives. Prompt-level cases need an account.',
      cases: ['initialize', 'session/new'],
      sessionUpdatesObserved: [...updates].sort(),
      serverMethodsObserved: [...methods].sort(),
      payloadPolicy:
        'Strings over 200 characters are elided: the recording is evidence of '
        + 'protocol shape, not of content.',
      exchange: exchanges,
    }), null, 2)}\n`);
  });
});
