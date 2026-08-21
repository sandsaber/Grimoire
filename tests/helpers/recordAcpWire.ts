import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Takes a wire recording from a real ACP CLI.
 *
 * A wire recording is the precondition the migration plan puts before a flip:
 * the shapes a provider really sends, taken from the provider rather than
 * guessed from a sibling's adapter. Shared because the two providers of wave 6
 * speak the same protocol and differ only in the command that starts them —
 * writing the recorder twice would be the drift the recordings exist to catch.
 *
 * **Redaction is part of recording, not a step after it.** The first Grok
 * capture carried a live API key, and two fixtures carried the recorder's home
 * directory into everyone's clone. Everything written here goes through
 * `redact` first, and `wireFixtureRedaction.test.ts` refuses the file if
 * anything got past it.
 */
export interface AcpWireRecordingOptions {
  readonly providerId: string;
  readonly command: string;
  readonly args: readonly string[];
  /** How the transport reads in the fixture, for whoever opens it later. */
  readonly transport: string;
}

/** One line on the wire, in the shape every recording already uses. */
interface Exchange {
  readonly seq: number;
  readonly direction: 'client->server' | 'server->client';
  readonly message: Record<string, unknown>;
}

/** Strings this long are content, and a recording is evidence of shape. */
const MAX_STRING = 200;

/**
 * What replaces the tail, counted inside the bound rather than added to it.
 *
 * The first version appended this *after* slicing to the limit, so every
 * elided string came out at 211 characters — over the very bound it was
 * enforcing, and the gate that checks the fixture said so in fifty-four places.
 */
const ELISION = '… (elided)';

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    const scrubbed = value
      .replaceAll(/\/home\/[A-Za-z0-9._-]+/g, '/home/grimoire')
      .replaceAll(/\/Users\/[A-Za-z0-9._-]+/g, '/Users/grimoire')
      .replaceAll(/\b(?:sk|xai|ghp)-[A-Za-z0-9_-]{16,}\b/g, '<redacted-credential>');
    return scrubbed.length > MAX_STRING
      ? `${scrubbed.slice(0, MAX_STRING - ELISION.length)}${ELISION}`
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

function settle(milliseconds: number): Promise<void> {
  return new Promise(done => {
    setTimeout(done, milliseconds);
  });
}

/**
 * Drives the CLI through a handshake and a turn, and writes what it answered.
 *
 * Returns the recording so a caller can assert on it: a recording of nothing
 * would be worse than none, because it would look taken.
 */
export async function recordAcpWire(
  options: AcpWireRecordingOptions,
): Promise<Record<string, unknown>> {
  const vault = mkdtempSync(join(tmpdir(), `grimoire-${options.providerId}-wire-`));
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');

  const exchanges: Exchange[] = [];
  const child = spawn(options.command, [...options.args], {
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
  send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: vault, mcpServers: [] } });
  await settle(6_000);

  const sessionId = exchanges
    .map(({ message }) => (message.result as { sessionId?: unknown } | undefined)?.sessionId)
    .find((value): value is string => typeof value === 'string');
  // The option the session offers, set back to what it already is. A value the
  // agent did not offer answers `Invalid params`, which records the shape of a
  // *malformed* call rather than the round trip a turn makes — the first
  // version of this sent `null` and captured exactly that.
  const configOption = exchanges
    .map(({ message }) => (message.result as {
      configOptions?: { id?: unknown; currentValue?: unknown }[];
    } | undefined)?.configOptions?.[0])
    .find((option): option is { id: string; currentValue: string } => (
      typeof option?.id === 'string' && typeof option.currentValue === 'string'
    ));
  if (sessionId && configOption) {
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: { sessionId, configId: configOption.id, value: configOption.currentValue },
    });
    await settle(2_000);
  }
  if (sessionId) {
    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{ type: 'text', text: 'Reply with exactly: ok' }],
      },
    });
    await settle(30_000);
  }

  child.stdin.end();
  child.kill();
  rmSync(vault, { force: true, recursive: true });

  const fromAgent = exchanges.filter(exchange => exchange.direction === 'server->client');
  const methods = new Set<string>();
  const updates = new Set<string>();
  for (const { message } of fromAgent) {
    if (typeof message.method === 'string') {
      methods.add(message.method);
      const params = message.params as { update?: { sessionUpdate?: unknown } } | undefined;
      if (typeof params?.update?.sessionUpdate === 'string') {
        updates.add(params.update.sessionUpdate);
      }
    }
  }

  const version = fromAgent
    .map(({ message }) => (message.result as { agentInfo?: { version?: unknown } } | undefined)
      ?.agentInfo?.version)
    .find((value): value is string => typeof value === 'string');

  // Which half this account could reach. An unauthenticated CLI refuses
  // `session/new`, and one that cannot generate answers a turn with nothing —
  // both are real shapes a flip meets, and neither is the prompt traffic. The
  // recording says which it holds rather than looking complete.
  const refusal = fromAgent
    .map(({ message }) => (message.error as { message?: unknown } | undefined)?.message)
    .find((value): value is string => typeof value === 'string');
  // Answered means the *turn* produced assistant content. Counting any
  // `session/update` marks a recording complete on the strength of the two
  // updates a session emits when it opens — which is how the first version of
  // this called a turn that returned `end_turn` with zero tokens a whole
  // recording.
  const answered = fromAgent.some(({ message }) => {
    const update = (message.params as { update?: { sessionUpdate?: unknown } } | undefined)?.update;
    return update?.sessionUpdate === 'agent_message_chunk'
      || update?.sessionUpdate === 'agent_thought_chunk';
  });

  const recording: Record<string, unknown> = {
    schemaVersion: 1,
    providerId: options.providerId,
    kind: 'wire-recording',
    recordedAgainst: `${options.command} ${version ?? 'unknown'}`,
    transport: options.transport,
    coverage: answered ? 'complete' : 'partial',
    cases: [
      'initialize',
      'session/new',
      ...(configOption ? ['session/set_config_option'] : []),
      ...(sessionId ? ['session/prompt'] : []),
    ],
    sessionUpdatesObserved: [...updates].sort(),
    serverMethodsObserved: [...methods].sort(),
    payloadPolicy:
      'Strings over 200 characters are elided: the recording is evidence of protocol shape, '
      + 'not of content.',
    exchange: exchanges,
  };
  if (!answered) {
    recording.limitations = [
      // The turn's own outcome, not any error the recording happens to contain:
      // a refused handshake and a turn that returned empty are different
      // limitations, and reporting the first for the second misdescribes what
      // was captured.
      sessionId
        ? 'The turn returned without assistant content: this account cannot generate.'
        : `The CLI refused to open a session: "${refusal ?? 'no reason given'}". `
          + 'That is a real shape a flip meets.',
      'The handshake is evidence; the prompt traffic still needs an account that generates.',
    ];
  }

  const fixture = resolve(
    process.cwd(),
    `tests/fixtures/provider-traces/wire/${options.providerId}-wire.json`,
  );
  writeFileSync(fixture, `${JSON.stringify(redact(recording), null, 2)}\n`);
  return recording;
}
