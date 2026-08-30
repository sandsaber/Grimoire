import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { StreamChunk } from '@/core/types';
import { isChatContent } from '@/features/chat/rendering/chatContentChunks';
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';
import type { AcpSessionNotification } from '@/providers/acp/types';
import { ClaudePlanUsageStore } from '@/providers/claude/app/ClaudePlanUsageStore';
import { ClaudeContentPresenter } from '@/providers/claude/execution/ClaudeContentPresenter';
import { CODEX_EXECUTION_NOTIFICATION_METHODS } from '@/providers/codex/runtime/CodexExecutionConnection';
import { GeminiContentPresenter } from '@/providers/gemini/execution/GeminiContentPresenter';
import { GrokContentPresenter } from '@/providers/grok/execution/GrokContentPresenter';
import { GROK_SESSION_NOTIFICATION_METHODS } from '@/providers/grok/runtime/GrokSessionNotifications';
import { KimicodeContentPresenter } from '@/providers/kimicode/execution/KimicodeContentPresenter';
import { MimocodeContentPresenter } from '@/providers/mimocode/execution/MimocodeContentPresenter';
import { OpencodeContentPresenter } from '@/providers/opencode/execution/OpencodeContentPresenter';
import { QwenContentPresenter } from '@/providers/qwen/execution/QwenContentPresenter';

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
  /**
   * What a Claude turn sends that no surface is drawn from.
   *
   * `system/hook_started` and `system/hook_response` are Grimoire's own hooks
   * reporting themselves, and `system/thinking_tokens` is a budget notice; none
   * of the three is content. `system/init` is here for a different reason — its
   * session id *is* read, but from the `session_id` field every message carries,
   * so this row cannot tell it apart from a message that was ignored.
   * `rate_limit_event` and `result/success` are absent because the plan store
   * takes something from both.
   */
  claude: [
    'system/hook_response',
    'system/hook_started',
    'system/init',
    'system/thinking_tokens',
  ],
  // Empty since wave 4's content surface: the commands update and the usage
  // update are both consumed now, by the presenter rather than the backend —
  // which is why the check below replays the recording through it instead of
  // grepping for the wire name the normalizer already renamed.
  opencode: [],
  /**
   * Empty since wave 5's content surface.
   *
   * Grok's own three — `model_changed`, `response_completed`, `turn_completed`
   * — arrive on `_x.ai/session_notification` rather than `session/update`, and
   * the legacy runtime dropped all three: its wrapped-notification parser
   * wanted an inner `method` field the CLI does not send, and the update types
   * are not in the ACP set it admitted. The flip consumes them, so a regression
   * that dropped one again turns this row red.
   */
  grok: [],
  /**
   * Filled by whichever of Gemini's three the presenter does not draw.
   *
   * The recording carries `agent_message_chunk`, `agent_thought_chunk` and
   * `available_commands_update`; the first two are the shared ACP vocabulary
   * and the third is the one Gemini's ports have no callback for.
   */
  gemini: [],
  /** MiMoCode's two, both of which wave 7's content surface consumes. */
  mimocode: [],
  /**
   * Kimi Code's six, all drawn from once the recording had a turn in it.
   *
   * Its first recording was a handshake refusal, so this row measured nothing
   * until the account was found to be authenticated on 2026-08-30 and the wire
   * was retaken. `session_info_update` and `config_option_update` are the two
   * the shared ACP vocabulary does not have and the fork does.
   */
  kimicode: [],
  /** Qwen's four, likewise, from the recording retaken the same day. */
  qwen: [],
};

/**
 * The providers whose recorded session-update vocabulary is replayed below.
 *
 * Six of them since 2026-08-30: Kimi Code's and Qwen's recordings used to
 * observe no vocabulary at all, because both machines were logged out and
 * `session/new` was refused before a turn. Both accounts answer now, both
 * recordings were retaken against a turn, and the vocabulary they brought is
 * replayed here rather than sitting in a fixture nothing reads. Antigravity
 * stays off the list because it speaks no ACP at all. That is an answer, and
 * the assertion that reads this list is what turns the next recording arriving
 * with a vocabulary into a failure rather than a silence.
 */
const SESSION_UPDATE_REPLAYS: readonly string[] = [
  'gemini', 'grok', 'kimicode', 'mimocode', 'opencode', 'qwen',
];

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

/**
 * Whether anything in the adapter draws a surface from this update.
 *
 * Three questions, because the answer arrives by three routes and asking only
 * the first was wrong in both directions. **Chunks are counted only if the
 * surface keeps them** — a presenter whose whole output is turn framing draws
 * nothing, because `isChatContent` filters framing out of the content channel,
 * and counting it called such an update consumed. **And the normalizer is asked
 * separately**, because for an ACP provider the answer's text never comes
 * through the presenter at all: `GrokContentPresenter` given an
 * `agent_message_chunk` returns `assistant_message_start` and nothing else, and
 * nothing for the chunks after it, since the backend mirrors that text as
 * `output-delta` and letting both through would print every sentence twice. So
 * dropping the framing without asking the normalizer would file the assistant's
 * own message under "nothing draws the surface from this".
 *
 * `unsupported` is the normalizer's own word for an update it has no meaning
 * for, which is exactly this gate's question asked on the kernel's side.
 */
function drawsASurface(
  chunks: readonly StreamChunk[],
  effects: readonly string[],
  modelled: boolean,
): boolean {
  return chunks.some(isChatContent) || effects.length > 0 || modelled;
}

describe('wire vocabulary coverage', () => {
  const recordings = readRecordings();

  it('has a recording for each provider that has reached the kernel', () => {
    // The four proof providers, Grok — whose recording was taken at the start
    // of its own wave, which is the order the plan asks for and the one the
    // first four did not always get — the two of wave 6, and the two of wave 7,
    // each taken when its CLI arrived. Three are partial and say so in the file
    // rather than by being thin: MiMoCode's account cannot generate, so the turn
    // it recorded answered nothing, and Kimi Code's and Qwen Code's machines are
    // not logged in, so `session/new` is the refusal an unauthenticated CLI
    // gives. All of it is real traffic; only some of it is the prompt traffic a
    // flip finally needs.
    expect(recordings.map(recording => recording.providerId).sort())
      .toEqual([
        'antigravity', 'claude', 'codex', 'gemini', 'grok', 'kimicode', 'mimocode',
        'opencode', 'qwen',
      ]);
  });

  it('says which recordings are partial rather than letting them look whole', () => {
    // A thin recording and a complete one are the same shape on disk. The
    // difference has to be written down, or a flip reads "we have a recording"
    // and plans against traffic nobody captured.
    //
    // Read as a *value*, not as a presence. The first version of this asked
    // whether `coverage` was truthy, which was right only while the field
    // appeared on partial recordings alone: the shared recorder writes it
    // either way, so the first complete recording it produced — Gemini CLI's —
    // was reported as partial by a gate whose whole job is telling the two
    // apart.
    const partial = recordings
      .filter(recording => {
        const entry = recording as { coverage?: unknown; limitations?: unknown };
        return entry.coverage === 'partial' || Array.isArray(entry.limitations);
      })
      .map(recording => recording.providerId)
      .sort();

    // **Two left this list on 2026-08-30**, when both accounts turned out to be
    // authenticated: Kimi Code's and Qwen's recordings were handshake refusals
    // taken while they were blocked, and both were retaken against a turn that
    // answered. MiMoCode's stays partial because its account still cannot
    // generate — the recorder writes that limitation rather than a coverage it
    // did not reach.
    expect(partial).toEqual(['mimocode']);
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
      readAcpSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new OpencodeContentPresenter({
          displayModel: () => 'model',
          onCommands: () => effects.push('commands'),
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        const modelled = new AcpSessionUpdateNormalizer()
          .normalize(notification.update).type !== 'unsupported';
        return drawsASurface(chunks, effects, modelled)
          ? [notification.update.sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.opencode].sort());
  });

  it('records every Gemini session update nothing draws the surface from', () => {
    const recording = recordings.find(entry => entry.providerId === 'gemini');
    const observed = recording?.sessionUpdatesObserved ?? [];
    const consumed = new Set<string>(
      readAcpSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new GeminiContentPresenter({
          displayModel: () => 'model',
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
          onSessionOpened: () => effects.push('session'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        const modelled = new AcpSessionUpdateNormalizer()
          .normalize(notification.update).type !== 'unsupported';
        return drawsASurface(chunks, effects, modelled)
          ? [notification.update.sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.gemini].sort());
  });

  it('records every MiMoCode session update nothing draws the surface from', () => {
    const recording = recordings.find(entry => entry.providerId === 'mimocode');
    const observed = recording?.sessionUpdatesObserved ?? [];
    const consumed = new Set<string>(
      readAcpSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new MimocodeContentPresenter({
          displayModel: () => 'model',
          onCommands: () => effects.push('commands'),
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
          onSessionOpened: () => effects.push('session'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        const modelled = new AcpSessionUpdateNormalizer()
          .normalize(notification.update).type !== 'unsupported';
        return drawsASurface(chunks, effects, modelled)
          ? [notification.update.sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.mimocode].sort());
  });

  it('records every Kimi Code session update nothing draws the surface from', () => {
    const recording = recordings.find(entry => entry.providerId === 'kimicode');
    const observed = recording?.sessionUpdatesObserved ?? [];
    const consumed = new Set<string>(
      readAcpSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new KimicodeContentPresenter({
          displayModel: () => 'model',
          onCommands: () => effects.push('commands'),
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
          onSessionOpened: () => effects.push('session'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        const modelled = new AcpSessionUpdateNormalizer()
          .normalize(notification.update).type !== 'unsupported';
        return drawsASurface(chunks, effects, modelled)
          ? [notification.update.sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.kimicode].sort());
  });

  it('records every Qwen session update nothing draws the surface from', () => {
    const recording = recordings.find(entry => entry.providerId === 'qwen');
    const observed = recording?.sessionUpdatesObserved ?? [];
    const consumed = new Set<string>(
      readAcpSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new QwenContentPresenter({
          displayModel: () => 'model',
          onCommands: () => effects.push('commands'),
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
          onSessionOpened: () => effects.push('session'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        const modelled = new AcpSessionUpdateNormalizer()
          .normalize(notification.update).type !== 'unsupported';
        return drawsASurface(chunks, effects, modelled)
          ? [notification.update.sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.qwen].sort());
  });

  it('replays every recording that observed session updates', () => {
    // **The gate that says what this file covers.** Four providers are replayed
    // above, and a fifth recording arriving with a vocabulary and no block
    // would otherwise be filed as covered by nothing at all — which is the
    // failure mode this whole file exists to prevent, one level up.
    const withVocabulary = recordings
      .filter(recording => (recording.sessionUpdatesObserved ?? []).length > 0)
      .map(recording => recording.providerId)
      .sort();

    expect(withVocabulary).toEqual([...SESSION_UPDATE_REPLAYS].sort());
  });

  it('records every Grok session update nothing draws the surface from', () => {
    const recording = recordings.find(candidate => candidate.providerId === 'grok');
    const observed = recording?.sessionUpdatesObserved ?? [];
    // Replayed through the presenter rather than tested against the legacy
    // runtime's ACP predicate: that predicate rejects Grok's own three by
    // definition — they are not ACP updates — so it answered the same before
    // and after the flip consumed them. What matters is whether anything draws
    // a surface from each one.
    const consumed = new Set(
      readGrokSessionUpdates(recording).flatMap(notification => {
        const effects: string[] = [];
        const presenter = new GrokContentPresenter({
          displayModel: () => 'model',
          onCommands: () => effects.push('commands'),
          onConfigOptions: () => effects.push('config'),
          onCost: () => effects.push('cost'),
          onCurrentMode: () => effects.push('mode'),
          onModelChanged: () => effects.push('model'),
        });
        const chunks = presenter.present({ kind: 'session-update', notification });
        const modelled = new AcpSessionUpdateNormalizer()
          .normalize(notification.update).type !== 'unsupported';
        return drawsASurface(chunks, effects, modelled)
          ? [(notification.update as { sessionUpdate: string }).sessionUpdate]
          : [];
      }),
    );
    const missing = observed.filter(update => !consumed.has(update)).sort();

    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.grok].sort());
  });

  it('records every Claude message type nothing draws the surface from', () => {
    const recording = recordings.find(candidate => candidate.providerId === 'claude');
    const observed = (recording as { messageTypesObserved?: readonly string[] })
      ?.messageTypesObserved ?? [];
    const consumed = new Set(
      ((recording?.exchange ?? []) as readonly Record<string, unknown>[]).flatMap(message => {
        const effects: string[] = [];
        const usage = new ClaudePlanUsageStore();
        const presenter = new ClaudeContentPresenter({
          settings: () => ({ intendedModel: 'claude-opus-5' }),
          onPlanModeEntered: () => effects.push('plan'),
          // Asked whether the store *took* something rather than whether the
          // port was called: every message passes through it by design, so
          // counting the call would call every message consumed.
          onUsageMessage: next => {
            if (usage.recordSdkMessage(next)) effects.push('usage');
          },
        });
        const chunks = presenter.present(message);
        // Claude has no ACP normalizer: its SDK messages reach the kernel by a
        // different route, so the third question has no source here.
        return drawsASurface(chunks, effects, false) ? [messageTypeOf(message)] : [];
      }),
    );
    const missing = observed.filter(type => !consumed.has(type)).sort();

    // The row this file was missing: the recording has been here since M0b and
    // nothing asserted anything about it, which is how a provider's whole
    // vocabulary can go unread without a gate noticing.
    expect(missing).toEqual([...UNMODELLED_BY_PROVIDER.claude].sort());
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

/** How a recorded Claude message is named in `messageTypesObserved`. */
function messageTypeOf(message: Record<string, unknown>): string {
  const type = typeof message.type === 'string' ? message.type : '';
  const subtype = typeof message.subtype === 'string' ? message.subtype : '';
  return subtype ? `${type}/${subtype}` : type;
}

/** Every session update Grok's recording carried, on either channel. */
function readGrokSessionUpdates(
  recording: { readonly exchange?: readonly unknown[] } | undefined,
): AcpSessionNotification[] {
  return (recording?.exchange ?? []).flatMap(entry => {
    const message = (entry as { message?: { method?: string; params?: unknown } }).message;
    return message?.method === 'session/update' || message?.method === '_x.ai/session_notification'
      ? [message.params as AcpSessionNotification]
      : [];
  });
}

/** The `session/update` notifications a recording actually carried. */
function readAcpSessionUpdates(
  recording: WireRecording | undefined,
): AcpSessionNotification[] {
  return (recording?.exchange ?? []).flatMap(entry => {
    const message = (entry as { message?: { method?: string; params?: unknown } }).message;
    return message?.method === 'session/update'
      ? [message.params as AcpSessionNotification]
      : [];
  });
}
