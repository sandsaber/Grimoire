import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What the providers actually send, against what the code models.
 *
 * The M0b recordings are the first evidence on this branch taken from live
 * CLIs rather than from the archived branch's fixtures, and the first thing
 * they showed is that the gap is large: one trivial Codex turn produced nine
 * notification methods the execution connection does not list, several of
 * which carry the plan indicators and raw items the provider's own
 * documentation says Grimoire depends on.
 *
 * The gap is not a defect to fix here — subscribing to a notification is
 * provider-backend work owned by each flip. It is recorded so it cannot grow
 * unnoticed, and so a flip cannot claim coverage it does not have.
 */

const WIRE_DIRECTORY = 'tests/fixtures/provider-traces/wire';

interface WireRecording {
  readonly providerId: string;
  readonly kind: string;
  readonly recordedAgainst: string;
  readonly serverMethodsObserved?: readonly string[];
  readonly sessionUpdatesObserved?: readonly string[];
  readonly messageTypesObserved?: readonly string[];
  readonly exchange: readonly unknown[];
}

/**
 * Methods observed on the wire that the code does not yet consume.
 *
 * Every entry is a live observation, not a guess. The list may shrink as
 * backends learn them; it must not grow without a recording that justifies it.
 */
const UNMODELLED_BY_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  codex: [
    'account/rateLimits/updated',
    'hook/completed',
    'hook/started',
    'mcpServer/startupStatus/updated',
    'rawResponse/completed',
    'rawResponseItem/completed',
    'remoteControl/status/changed',
    'thread/started',
    'thread/tokenUsage/updated',
  ],
  opencode: ['available_commands_update', 'usage_update'],
};

function readRecordings(): WireRecording[] {
  const directory = resolve(process.cwd(), WIRE_DIRECTORY);
  return readdirSync(directory)
    .filter(entry => entry.endsWith('-wire.json'))
    .map(entry => JSON.parse(
      readFileSync(resolve(directory, entry), 'utf8'),
    ) as WireRecording);
}

describe('wire vocabulary coverage', () => {
  const recordings = readRecordings();

  it('has a recording for each of the four proof providers', () => {
    expect(recordings.map(recording => recording.providerId).sort())
      .toEqual(['antigravity', 'claude', 'codex', 'opencode']);
  });

  it.each(recordings)('$providerId names the CLI version it was taken from', recording => {
    // A recording that does not say what produced it cannot be re-taken, and an
    // undated protocol observation ages into a guess.
    expect(recording.kind).toBe('wire-recording');
    expect(recording.recordedAgainst).toMatch(/\d+\.\d+/);
    expect(recording.exchange.length).toBeGreaterThan(0);
  });

  it('records every Codex notification the execution connection does not consume', () => {
    const observed = recordings.find(recording => recording.providerId === 'codex')
      ?.serverMethodsObserved ?? [];
    const modelled = new Set(readModelledCodexNotifications());
    const missing = observed.filter(method => !modelled.has(method)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.codex].sort());
  });

  it('records every OpenCode session update the backend does not handle', () => {
    const observed = recordings.find(recording => recording.providerId === 'opencode')
      ?.sessionUpdatesObserved ?? [];
    const source = readFileSync(
      resolve(process.cwd(), 'src/providers/opencode/execution/OpencodeExecutionBackend.ts'),
      'utf8',
    );
    const missing = observed
      .filter(update => !source.includes(`'${update}'`))
      .sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.opencode].sort());
  });

  it('carries no content, only shape', () => {
    // The recordings pass through provider prompt material and model output.
    // Long strings are elided at capture; this is the check that keeps it true
    // when a recording is refreshed.
    for (const recording of recordings) {
      const serialized = JSON.stringify(recording);
      const longest = [...serialized.matchAll(/"([^"\\]{201,})"/g)];

      expect([recording.providerId, longest.length]).toEqual([recording.providerId, 0]);
    }
  });
});

/** The notification methods the Codex execution connection subscribes to. */
function readModelledCodexNotifications(): string[] {
  const source = readFileSync(
    resolve(process.cwd(), 'src/providers/codex/runtime/CodexExecutionConnection.ts'),
    'utf8',
  );
  const block = source.slice(
    source.indexOf('NOTIFICATION_METHODS'),
    source.indexOf('] as const', source.indexOf('NOTIFICATION_METHODS')),
  );
  return [...block.matchAll(/'([^']+)'/g)].map(match => match[1]);
}
