import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AcpSessionNotification } from '@/providers/acp/types';
import { CODEX_EXECUTION_NOTIFICATION_METHODS } from '@/providers/codex/runtime/CodexExecutionConnection';
import {
  GROK_SESSION_NOTIFICATION_METHODS,
  isSupportedAcpSessionUpdate,
} from '@/providers/grok/runtime/GrokSessionNotifications';
import { OpencodeContentPresenter } from '@/providers/opencode/execution/OpencodeContentPresenter';

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
  // Six left, down from nine: the flip took `account/rateLimits/updated`,
  // `rawResponseItem/completed` and `thread/tokenUsage/updated`, which the
  // connection now delivers because the renderer it kept knows what to do with
  // them. What remains is hooks, MCP startup status, remote control, the whole
  // raw response, and a thread-start notification the backend learns from its
  // own RPC results.
  codex: [
    'hook/completed',
    'hook/started',
    'mcpServer/startupStatus/updated',
    'rawResponse/completed',
    'remoteControl/status/changed',
    'thread/started',
  ],
  // Empty since wave 4's content surface: the commands update and the usage
  // update are both consumed now, by the presenter rather than the backend —
  // which is why the check below replays the recording through it instead of
  // grepping for the wire name the normalizer already renamed.
  opencode: [],
  /**
   * Grok's own three, none of which ACP defines.
   *
   * They arrive on `_x.ai/session_notification` rather than `session/update`,
   * and the runtime drops every one of them twice over: the wrapped-notification
   * parser wants an inner `method` field the CLI does not send, and the update
   * types are not in the ACP set the handler admits. `response_completed`
   * carries the turn's token usage and `turn_completed` its stop reason and
   * cost — which is why the runtime reads both off Grok's own session log
   * instead. Owner: wave 5's backend.
   */
  grok: ['model_changed', 'response_completed', 'turn_completed'],
};

/**
 * Grok's vendor methods, beside the one ACP method it also speaks.
 *
 * Eleven of the twelve server methods in the recording are `_x.ai/*`, and the
 * runtime subscribes to one of them. The rest carry MCP startup progress, the
 * model list, the prompt queue, settings, announcements and the session list —
 * a whole second protocol beside ACP. Recorded so wave 5 chooses what to
 * consume rather than discovering it.
 */
const GROK_UNSUBSCRIBED_METHODS = [
  '_x.ai/announcements/update',
  '_x.ai/mcp/init_progress',
  '_x.ai/mcp/server_status',
  '_x.ai/mcp/servers_updated',
  // `_x.ai/mcp_initialized` is a twelfth, seen in a first capture and not in
  // the committed one: whether it lands before the turn ends is MCP startup
  // timing. Listed here rather than asserted, because the assertion measures
  // the recording and the recording is what it saw.
  '_x.ai/models/update',
  '_x.ai/queue/changed',
  '_x.ai/session/prompt_complete',
  '_x.ai/sessions/changed',
  '_x.ai/settings/update',
];

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

  it('has a recording for each provider that has reached the kernel', () => {
    // The four proof providers, and Grok — whose recording was taken at the
    // start of its own wave, which is the order the plan asks for and the one
    // the first four did not always get.
    expect(recordings.map(recording => recording.providerId).sort())
      .toEqual(['antigravity', 'claude', 'codex', 'grok', 'opencode']);
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

  it('records every OpenCode session update nothing draws the surface from', () => {
    const recording = recordings.find(entry => entry.providerId === 'opencode');
    const observed = recording?.sessionUpdatesObserved ?? [];
    // Replayed rather than grepped: the normalizer renames every wire update
    // before anything consumes it, so a source search for `usage_update` would
    // report a gap that is closed and would miss one that opens.
    const consumed = new Set<string>(
      readOpencodeSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new OpencodeContentPresenter({
          displayModel: () => 'model',
          onCommands: () => effects.push('commands'),
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        return chunks.length > 0 || effects.length > 0
          ? [notification.update.sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.opencode].sort());
  });

  it('records every Grok session update the runtime does not admit', () => {
    const observed = recordings.find(recording => recording.providerId === 'grok')
      ?.sessionUpdatesObserved ?? [];
    const missing = observed.filter(update => !isSupportedAcpSessionUpdate({
      sessionUpdate: update,
    })).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.grok].sort());
  });

  it('records every Grok notification method nothing subscribes to', () => {
    const observed = recordings.find(recording => recording.providerId === 'grok')
      ?.serverMethodsObserved ?? [];
    const subscribed = new Set<string>([...GROK_SESSION_NOTIFICATION_METHODS, 'session/update']);
    const missing = observed.filter(method => !subscribed.has(method)).sort();

    expect(missing).toEqual([...GROK_UNSUBSCRIBED_METHODS].sort());
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
/**
 * The list the connection actually subscribes with.
 *
 * Read as a value rather than scraped out of the source: the list is composed
 * from the renderer's own now, and a scraper saw four literals and called the
 * other fifteen unmodelled. A gate that reads text instead of meaning is the
 * defect this file exists to prevent, recorded once already at M2-adapter.
 */
function readModelledCodexNotifications(): readonly string[] {
  return CODEX_EXECUTION_NOTIFICATION_METHODS;
}

/** The `session/update` notifications the recording actually carried. */
function readOpencodeSessionUpdates(
  recording: WireRecording | undefined,
): AcpSessionNotification[] {
  return (recording?.exchange ?? []).flatMap(entry => {
    const message = (entry as { message?: { method?: string; params?: unknown } }).message;
    return message?.method === 'session/update'
      ? [message.params as AcpSessionNotification]
      : [];
  });
}
