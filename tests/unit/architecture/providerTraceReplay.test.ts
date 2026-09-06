import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import type { StreamChunk } from '@/core/types';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  ManagedAcpExecutionBackend,
  ManagedAcpExecutionBackendContext,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type { AcpPromptResponse, AcpSessionNotification } from '@/providers/acp/types';
import { GeminiContentPresenter } from '@/providers/gemini/execution/GeminiContentPresenter';
import { GeminiExecutionBackend } from '@/providers/gemini/execution/GeminiExecutionBackend';
import { GrokContentPresenter } from '@/providers/grok/execution/GrokContentPresenter';
import { GrokExecutionBackend } from '@/providers/grok/execution/GrokExecutionBackend';
import { KimicodeContentPresenter } from '@/providers/kimicode/execution/KimicodeContentPresenter';
import { KimicodeExecutionBackend } from '@/providers/kimicode/execution/KimicodeExecutionBackend';
import { MimocodeContentPresenter } from '@/providers/mimocode/execution/MimocodeContentPresenter';
import { MimocodeExecutionBackend } from '@/providers/mimocode/execution/MimocodeExecutionBackend';
import { OpencodeContentPresenter } from '@/providers/opencode/execution/OpencodeContentPresenter';
import { OpencodeExecutionBackend } from '@/providers/opencode/execution/OpencodeExecutionBackend';
import { QwenContentPresenter } from '@/providers/qwen/execution/QwenContentPresenter';
import { QwenExecutionBackend } from '@/providers/qwen/execution/QwenExecutionBackend';

/**
 * The sanitized recordings, run through the composition rather than read.
 *
 * M6 asks for every accepted trace to reach the final composition. Two gates
 * stood next to that and neither was it: `wireVocabularyCoverage` replays a
 * recording through a *presenter*, which says a message type is understood, and
 * `defineExecutionBackendConformance` drives a backend through the *registry*
 * on events somebody typed. What neither answers is the question a flip is
 * accepted on — whether the traffic a real CLI actually sent produces a turn
 * this product can draw.
 *
 * So this replays each recorded exchange end to end: the recorded `session/new`
 * answer opens the session, the recorded notifications arrive in the order they
 * arrived, the recorded `session/prompt` answer ends the turn, and the whole of
 * it goes through the real managed-ACP backend into a real lifecycle registry —
 * then through the provider's own presenter, which is what a tab draws.
 *
 * **Six of the nine recordings carry a prompt exchange, since 2026-08-30.** Kimi
 * Code's and Qwen's used to stop at `session/new` because both machines were
 * logged out; both accounts answer now, both recordings were retaken against a
 * turn, and the count asserted below is what made them impossible to leave out
 * quietly. Antigravity speaks no ACP, and MiMoCode's turn returns without
 * content — its recording carries the exchange, which is what this replays.
 */

const WIRE_DIRECTORY = 'tests/fixtures/provider-traces/wire';
const SESSION_ID = executionSessionId(`es-${'d'.repeat(32)}`);
const RUN_ID = runId(`run-${'c'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'trace-replay' };
/** Stands in for a session id a recording redacted; see `readTurn`. */
const REPLAY_SESSION_ID = 'replayed-native-session';

interface RecordedExchange {
  readonly seq?: number;
  readonly direction?: string;
  readonly message?: {
    readonly id?: number;
    readonly method?: string;
    readonly params?: unknown;
    readonly result?: unknown;
  };
}

interface Recording {
  readonly providerId: string;
  readonly exchange: readonly RecordedExchange[];
}

interface ReplaySubject {
  readonly providerId: string;
  createBackend(context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>):
  ManagedAcpExecutionBackend;
  present(event: unknown): readonly StreamChunk[];
}

const SUBJECTS: readonly ReplaySubject[] = [
  {
    providerId: 'gemini',
    createBackend: context => new GeminiExecutionBackend(context),
    present: event => new GeminiContentPresenter({ displayModel: () => 'model' })
      .present(event),
  },
  {
    providerId: 'grok',
    createBackend: context => new GrokExecutionBackend(context),
    present: event => new GrokContentPresenter({ displayModel: () => 'model' })
      .present(event),
  },
  {
    providerId: 'kimicode',
    createBackend: context => new KimicodeExecutionBackend(context),
    present: event => new KimicodeContentPresenter({ displayModel: () => 'model' })
      .present(event),
  },
  {
    providerId: 'mimocode',
    createBackend: context => new MimocodeExecutionBackend(context),
    present: event => new MimocodeContentPresenter({ displayModel: () => 'model' })
      .present(event),
  },
  {
    providerId: 'opencode',
    createBackend: context => new OpencodeExecutionBackend(context),
    present: event => new OpencodeContentPresenter({ displayModel: () => 'model' })
      .present(event),
  },
  {
    providerId: 'qwen',
    createBackend: context => new QwenExecutionBackend(context),
    present: event => new QwenContentPresenter({ displayModel: () => 'model' })
      .present(event),
  },
];

function readRecording(providerId: string): Recording {
  const path = resolve(process.cwd(), WIRE_DIRECTORY, `${providerId}-wire.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Recording;
}

/** The turn a recording holds: what opened the session, what it sent, how it ended. */
function readTurn(recording: Recording): {
  readonly sessionId: string;
  readonly notifications: readonly AcpSessionNotification[];
  readonly response: AcpPromptResponse;
  readonly messageId?: string;
} {
  const promptRequest = recording.exchange.find(entry => entry.message?.method === 'session/prompt');
  if (!promptRequest?.message) {
    throw new Error(`${recording.providerId} recorded no session/prompt.`);
  }
  const newSession = recording.exchange.find(entry => entry.message?.method === 'session/new');
  const sessionResult = recording.exchange.find(entry => (
    entry.message?.id === newSession?.message?.id && entry.message?.result !== undefined
  ))?.message?.result as { sessionId?: string } | undefined;
  const promptResult = recording.exchange.find(entry => (
    entry.message?.id === promptRequest.message?.id && entry.message?.result !== undefined
  ))?.message?.result as AcpPromptResponse | undefined;
  if (!sessionResult?.sessionId || !promptResult) {
    throw new Error(`${recording.providerId} recorded no session id or no prompt answer.`);
  }
  const promptSeq = promptRequest.seq ?? 0;
  const notifications = recording.exchange
    .filter(entry => (entry.seq ?? 0) > promptSeq)
    .filter(entry => entry.message?.method === 'session/update'
      || entry.message?.method === '_x.ai/session_notification')
    .map(entry => entry.message?.params as AcpSessionNotification);
  // The id the agent echoes on its own chunks, which is the id Grimoire minted
  // and sent with the prompt. Replaying without it dispatches a turn whose
  // native run ref does not match the one the notifications carry, and the
  // backend correctly fences its own reply.
  const messageId = notifications
    .map(notification => (notification.update as { messageId?: string } | undefined)?.messageId)
    .find((value): value is string => typeof value === 'string' && value.length > 0);
  // **A redaction marker is not a session id.** Two of the four recordings were
  // sanitized by replacing the id with `<session-id>`, and a replay that feeds
  // that back gives the composition a native session ref it will not accept —
  // the turn then never binds and stalls until its run timeout. Substituted
  // consistently, marker for marker, so what is replayed is the recorded
  // *shape* with an id the product can hold. The recordings that carry a real
  // id are used as they are.
  const placeholder = /^<.*>$/.test(sessionResult.sessionId);
  const sessionId = placeholder ? REPLAY_SESSION_ID : sessionResult.sessionId;
  return {
    sessionId,
    notifications: placeholder
      ? notifications.map(notification => ({ ...notification, sessionId }))
      : notifications,
    response: promptResult,
    ...(messageId ? { messageId } : {}),
  };
}

/** A client that answers from the recording and sends what the recording sent. */
class RecordedAcpClient implements ManagedAcpClient {
  promptRequests = 0;
  private readonly listeners = new Set<(notification: AcpSessionNotification) => void>();

  constructor(private readonly turn: ReturnType<typeof readTurn>) {}

  async initialize(): Promise<void> {}
  async newSession() {
    return { sessionId: this.turn.sessionId };
  }
  async loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    return { sessionId: request.sessionId };
  }
  async prompt(): Promise<AcpPromptResponse> {
    this.promptRequests += 1;
    // Yielded first, then in the order the recording carried them, then the
    // answer. Both orderings matter and neither is decoration: a notification
    // sent before the dispatch has finished wiring arrives with no run to
    // belong to, and an answer that resolved first would end the turn before
    // its own content — which is the one ordering a real transport cannot
    // produce.
    await Promise.resolve();
    await Promise.resolve();
    for (const notification of this.turn.notifications) {
      for (const listener of this.listeners) {
        listener(notification);
      }
      await new Promise(resolve => { globalThis.setTimeout(resolve, 0); });
    }
    await new Promise(resolve => { globalThis.setTimeout(resolve, 0); });
    return this.turn.response;
  }
  async setMode() {
    return {};
  }
  async setModel() {
    return {};
  }
  async setConfigOption() {
    return { configOptions: [] };
  }
  cancel(): void {}
  onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onConnectionLost() {
    return () => undefined;
  }
  async close(): Promise<'confirmed'> {
    return 'confirmed';
  }
}

/**
 * Real timers, for both halves.
 *
 * A replay is the one test here that must not decide when the composition gets
 * to run: the backend's own timeouts and the registry's recovery scheduling are
 * part of what a recorded turn exercises, and a scheduler that never fires
 * makes a stalled turn look like a passing one.
 */
class RealScheduler implements ExecutionLifecycleScheduler {
  setTimeout(callback: () => void, delayMs?: number): unknown {
    return globalThis.setTimeout(callback, delayMs ?? 0);
  }
  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
}

async function settleUntilTerminal(
  registry: ExecutionLifecycleRegistry,
  envelopes: readonly ExecutionEventEnvelope[],
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await registry.waitForIdle();
    if (envelopes.some(envelope => envelope.event.kind === 'terminal')) {
      return;
    }
    await new Promise(resolve => { globalThis.setTimeout(resolve, 5); });
  }
  throw new Error(`The replayed turn never reached a terminal: ${JSON.stringify(
    envelopes.map(envelope => envelope.event.kind),
  )}`);
}

describe('provider trace replay', () => {
  it('replays every recording that carries a turn', () => {
    // The count, asserted rather than assumed: a recording that grows a
    // `session/prompt` — Kimi Code's or Qwen Code's, once those machines are
    // logged in — has to be added here rather than silently left out.
    const withTurns = ['antigravity', 'claude', 'codex', 'gemini', 'grok', 'kimicode',
      'mimocode', 'opencode', 'qwen']
      .filter(providerId => {
        const path = resolve(process.cwd(), WIRE_DIRECTORY, `${providerId}-wire.json`);
        const recording = JSON.parse(readFileSync(path, 'utf8')) as Recording;
        return (recording.exchange ?? []).some(entry => entry.message?.method === 'session/prompt');
      });

    expect(withTurns).toEqual(SUBJECTS.map(subject => subject.providerId));
  });

  it.each(SUBJECTS.map(subject => [subject.providerId, subject] as const))(
    '%s carries its recorded turn through the composition to one terminal',
    async (providerId, subject) => {
      const turn = readTurn(readRecording(providerId));
      const client = new RecordedAcpClient(turn);
      const storage = new TestDurableStorage();
      let clock = 1;
      const now = () => clock++;
      const repositories = new ExecutionControlRepositories(storage, now);
      let transactionOrdinal = 0;
      const registry = new ExecutionLifecycleRegistry({
        repositories,
        controlTransactions: new ExecutionControlTransactionCoordinator(
          storage,
          repositories,
          { now },
        ),
        nextTransactionId: () => `tx-${(++transactionOrdinal).toString(16).padStart(32, '0')}`,
        now,
        scheduler: new RealScheduler(),
        shutdownGracePeriodMs: 50,
      });
      const backend = subject.createBackend({
        clientFactory: {
          create: async (_input: ManagedAcpClientFactoryInput) => client,
        },
        requestResolver: {
          resolve: async () => ({
            startupRef: 'startup-ref',
            restartFingerprint: 'replay-v1',
            cwd: '/vault',
            // The recording's own prompt would carry the person's words; the
            // turn's content is what the *agent* sent back, which is what this
            // replays. D2 keeps a prompt out of a fixture either way.
            prompt: [{ type: 'text', text: 'replayed turn' }],
            mcpServers: [],
            ...(turn.messageId ? { messageId: turn.messageId } : {}),
          }),
        },
        dynamicApplier: { apply: async () => undefined },
        interactionBridge: { prepare: async () => { throw new Error('No interaction.'); } },
        resultSink: {
          storeResult: async () => ({
            kind: 'committed',
            result: { resultId: 'result-1', storage: 'projection' },
          }),
        },
        reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
        auxiliaryQueries: { execute: async () => '' },
        scheduler: new RealScheduler(),
        sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
        interactionIdFactory: () => interactionId(`ix-${'b'.repeat(32)}`),
        now,
        controlTimeoutMs: 500,
        resultCommitTimeoutMs: 500,
        recoveryTimeoutMs: 500,
        runTimeoutMs: 5_000,
        maxResultBytes: 1_000_000,
      });
      // **The backend is its own recovery and interaction port**, which is how
      // every provider's composition registers it. A stub recovery port here
      // answered `stopped-safe` to a question the backend answers `running` —
      // so a stream that paused between two recorded notifications was
      // reconciled as a run that had stopped, and the replay reported
      // `interrupted` for a turn the provider completed. The harness was the
      // defect, and it looked exactly like a product one.
      registry.registerBackend({ backend, recovery: backend, interactions: backend });
      await registry.start();
      await registry.createSession({
        backendId: backend.descriptor.backendId,
        executionSessionId: SESSION_ID,
        owner: OWNER,
      });
      const envelopes: ExecutionEventEnvelope[] = [];
      registry.observe(SESSION_ID, envelope => envelopes.push(envelope));

      await registry.startRun(SESSION_ID, {
        runId: RUN_ID,
        owner: OWNER,
        resultExpectation: 'optional',
        requestRef: 'replayed-request',
      });
      await settleUntilTerminal(registry, envelopes);

      // One terminal, and the provider's own, which is the claim every accepted
      // trace has to support: real traffic, through this composition, ends the
      // turn once and says how.
      const terminals = envelopes.filter(envelope => envelope.event.kind === 'terminal');
      expect(terminals).toHaveLength(1);
      expect(terminals[0]?.event).toMatchObject({ terminal: 'succeeded' });

      // And the tab has something to draw from it. Asserted through the
      // provider's own presenter rather than on the envelopes, because a
      // payload nothing renders is not content.
      const chunks = envelopes.flatMap(({ event }) => (
        event.kind === 'provider-content' ? [...subject.present(event.payload)] : []
      ));
      expect(chunks.length).toBeGreaterThan(0);

      await registry.shutdown(`sd-${'e'.repeat(32)}`);
    },
  );
});
