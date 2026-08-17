import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import antigravityTrace from '@test/fixtures/provider-traces/antigravity-execution.json';
import claudeTrace from '@test/fixtures/provider-traces/claude-execution.json';
import codexTrace from '@test/fixtures/provider-traces/codex-execution.json';
import opencodeTrace from '@test/fixtures/provider-traces/opencode-execution.json';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type { ExecutionRequest } from '@/core/execution/ExecutionContracts';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import type { ExecutionEvent, ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  type RunId,
  runId as toRunId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import {
  classifyForPresentation,
  dispatchCancellation,
  ExecutionAdapterSession,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeAdapterContext,
  startExecutionRun,
  toLegacyCapabilities,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type {
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types/chat';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/capabilities';
import { CLAUDE_PROVIDER_CAPABILITIES } from '@/providers/claude/capabilities';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { CODEX_PROVIDER_CAPABILITIES } from '@/providers/codex/capabilities';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import type { CodexProviderSettings } from '@/providers/codex/settings';
import { OPENCODE_PROVIDER_CAPABILITIES } from '@/providers/opencode/capabilities';
import { opencodeProviderModule } from '@/providers/opencode/OpencodeProviderModule';

/**
 * The adapter as a client of the registry, over the real lifecycle.
 *
 * The target suite pins one turn's semantics against the stream in isolation.
 * This one proves the other half of the M2-adapter gate: that the adapter
 * acquires a session and a run **through the registry**, sees what the registry
 * accepted, and never touches a backend to do it — which is the property that
 * would silently rot if the adapter grew its own subscription.
 */

const SESSION_ID = executionSessionId(`es-${'b'.repeat(32)}`);
const INSTANCE_ID = sessionInstanceId(`si-${'b'.repeat(32)}`);

interface Harness {
  readonly registry: ExecutionLifecycleRegistry;
  readonly context: ExecutionChatRuntimeAdapterContext;
  emit(runId: RunId, event: ExecutionEvent, deliveryId: string): Promise<unknown>;
  dispatched(runId: RunId): ExecutionRequest | undefined;
}

async function createHarness(options: { ownSession?: boolean } = {}): Promise<Harness> {
  let clock = 100;
  let ordinal = 0;
  let runOrdinal = 0;
  const now = (): number => ++clock;
  const storage = new TestDurableStorage();
  const repositories = new ExecutionControlRepositories(storage, now);
  const scheduler: ExecutionLifecycleScheduler = {
    setTimeout: () => undefined,
    clearTimeout: () => undefined,
  };
  const registry = new ExecutionLifecycleRegistry({
    repositories,
    controlTransactions: new ExecutionControlTransactionCoordinator(storage, repositories, { now }),
    nextTransactionId: () => `tx-${(++ordinal).toString(16).padStart(32, '0')}`,
    now,
    scheduler,
  });
  const backend = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => INSTANCE_ID,
    now,
  });
  registry.registerBackend({ backend });
  await registry.start();
  const owner = { kind: 'conversation' as const, ownerId: 'adapter-conformance' };
  if (!options.ownSession) {
    // The assembled adapter creates its own session through `ensureReady`; the
    // lower-level cases need one to already exist.
    await registry.createSession({
      backendId: backend.descriptor.backendId,
      executionSessionId: SESSION_ID,
      owner,
    });
  }
  return {
    registry,
    context: {
      registry,
      backendId: backend.descriptor.backendId,
      capabilities: codexProviderModule.capabilities,
      owner,
      nextExecutionSessionId: () => SESSION_ID,
      nextRunId: () => toRunId(`run-${(++runOrdinal).toString().padStart(32, '0')}`),
    },
    dispatched: runId => backend.dispatchedRequests.get(runId),
    emit(runId, event, deliveryId) {
      const delivery: ProviderExecutionEvent = {
        backendId: backend.descriptor.backendId,
        backendGeneration: 1,
        executionSessionId: SESSION_ID,
        sessionInstanceId: INSTANCE_ID,
        deliveryId,
        occurredAt: 1,
        scope: { kind: 'run', runId },
        event,
      };
      return registry.ingest(delivery);
    },
  };
}

async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const collected: StreamChunk[] = [];
  for await (const chunk of chunks) {
    collected.push(chunk);
  }
  return collected;
}

describe('execution adapter over the registry', () => {
  it('streams what the registry accepted and closes on its terminal', async () => {
    const harness = await createHarness();
    const { runId, stream, release } = await startExecutionRun(
      harness.context,
      SESSION_ID,
      { requestRef: 'opaque-request', resultExpectation: 'optional' },
    );
    const collected = drain(stream.chunks());

    await harness.emit(runId, { kind: 'run-started' }, 'd-1');
    await harness.emit(
      runId,
      { kind: 'output-delta', channel: 'assistant', text: 'partial' },
      'd-2',
    );
    await harness.emit(
      runId,
      { kind: 'output-delta', channel: 'reasoning', text: 'thinking aloud' },
      'd-3',
    );
    await harness.emit(runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }, 'd-4');

    expect(await collected).toEqual([
      { type: 'text', content: 'partial' },
      { type: 'thinking', content: 'thinking aloud' },
    ]);
    expect(stream.consumeTurnMetadata()).toEqual({ wasSent: true });
    release();
  });

  it('observes from before dispatch, so a fast first event cannot be missed', async () => {
    // The ordering hazard worth a test: a run that emits before `startRun`
    // resolves would be invisible to a subscription established afterwards, and
    // an event observed one line too late is indistinguishable from one that
    // never happened.
    const harness = await createHarness();
    const observed: string[] = [];
    harness.registry.observe(SESSION_ID, envelope => observed.push(envelope.event.kind));

    const { runId, release } = await startExecutionRun(
      harness.context,
      SESSION_ID,
      { requestRef: 'opaque-request', resultExpectation: 'optional' },
    );
    await harness.emit(runId, { kind: 'run-started' }, 'd-1');

    expect(observed).toContain('run-started');
    release();
  });

  it('ignores another run\'s events on the same session', async () => {
    const harness = await createHarness();
    const first = await startExecutionRun(harness.context, SESSION_ID, {
      requestRef: 'first',
      resultExpectation: 'optional',
    });
    const second = await startExecutionRun(harness.context, SESSION_ID, {
      requestRef: 'second',
      resultExpectation: 'optional',
    });
    const collected = drain(first.stream.chunks());

    await harness.emit(
      second.runId,
      { kind: 'output-delta', channel: 'assistant', text: 'not yours' },
      'd-1',
    );
    await harness.emit(
      first.runId,
      { kind: 'output-delta', channel: 'assistant', text: 'yours' },
      'd-2',
    );
    await harness.emit(
      first.runId,
      { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      'd-3',
    );

    expect(await collected).toEqual([{ type: 'text', content: 'yours' }]);
    first.release();
    second.release();
  });

  it('dispatches cancellation without waiting for the run to settle', async () => {
    const harness = await createHarness();
    const { runId, stream, release } = await startExecutionRun(
      harness.context,
      SESSION_ID,
      { requestRef: 'opaque-request', resultExpectation: 'optional' },
    );
    const collected = drain(stream.chunks());

    dispatchCancellation(harness.context, runId, stream);

    expect(stream.cancelDispatched()).toBe(true);
    await harness.emit(
      runId,
      { kind: 'terminal', terminal: 'cancelled', reason: 'cancellation-confirmed' },
      'd-1',
    );
    expect(await collected).toEqual([]);
    release();
  });

  it('carries a resume checkpoint into the request and clears it after dispatch', async () => {
    // The field this needed did not exist on `ExecutionRequest`, and the first
    // attempt to set it type-checked anyway because it was added through a
    // conditional spread. This asserts the value actually arrives.
    const harness = await createHarness();
    const session = new ExecutionAdapterSession(codexProviderModule.capabilities);
    session.setResumeCheckpoint('thread-checkpoint-1');

    const { runId, release } = await startExecutionRun(
      harness.context,
      SESSION_ID,
      { requestRef: 'opaque-request', resultExpectation: 'optional' },
      session,
    );

    expect(harness.dispatched(runId)?.resumeCheckpoint).toBe('thread-checkpoint-1');
    expect(session.pendingResumeCheckpoint()).toBeUndefined();
    release();
  });

  it('renders a missing required result as a failure, not an empty answer', async () => {
    // The defect the migration exists to fix, end to end through the registry.
    const harness = await createHarness();
    const { runId, stream, release } = await startExecutionRun(
      harness.context,
      SESSION_ID,
      { requestRef: 'opaque-request' },
    );
    const collected = drain(stream.chunks());

    await harness.emit(
      runId,
      { kind: 'terminal', terminal: 'failed', reason: 'missing-required-result' },
      'd-1',
    );

    expect(await collected).toEqual([{
      type: 'error',
      content: 'The provider ended the turn without producing a result.',
    }]);
    release();
  });

  describe('capability projection over the four proof topologies', () => {
    const modules = [
      antigravityProviderModule,
      codexProviderModule,
      claudeProviderModule,
      opencodeProviderModule,
    ];

    const liveRecords = {
      antigravity: ANTIGRAVITY_PROVIDER_CAPABILITIES,
      codex: CODEX_PROVIDER_CAPABILITIES,
      claude: CLAUDE_PROVIDER_CAPABILITIES,
      opencode: OPENCODE_PROVIDER_CAPABILITIES,
    } as const;

    it.each(modules)('$manifest.id projects to its live record field for field', module => {
      // Every field, not a chosen few. The three-field version of this passed
      // while the projection reported `supportsProviderCommands: true` for
      // Codex against a live `false` — a UI change nobody had decided, which is
      // exactly what the preservation boundary forbids and what a partial
      // comparison cannot catch.
      const live = liveRecords[module.manifest.id as keyof typeof liveRecords];

      expect(toLegacyCapabilities(module.capabilities, live.reasoningControl)).toEqual(live);
    });

    it.each(modules)('projects $manifest.id onto the record the UI reads', module => {
      const legacy = toLegacyCapabilities(module.capabilities, 'effort');

      expect(legacy.providerId).toBe(module.manifest.id);
      expect(legacy.supportsRewind)
        .toBe(module.capabilities.conversation.rewind !== 'unsupported');
      expect(legacy.supportsMcpTools)
        .toBe(module.capabilities.mcp.perRunSelection !== 'unsupported');
      expect(legacy.supportsImageAttachments)
        .toBe(module.capabilities.input.imageAttachments !== 'unsupported');
    });

    it('carries a plan artifact prefix only for the provider that writes one', () => {
      const withPrefix = modules
        .map(module => ({
          id: module.manifest.id,
          prefix: toLegacyCapabilities(module.capabilities, 'effort').planPathPrefix,
        }))
        .filter(entry => entry.prefix !== undefined);

      expect(withPrefix).toEqual([{ id: 'claude', prefix: '/.claude/plans/' }]);
    });
  });
});

describe('the assembled ChatRuntime adapter', () => {
  function createAdapter(harness: Harness): ExecutionChatRuntimeAdapter<CodexProviderSettings> {
    return new ExecutionChatRuntimeAdapter(
      harness.context,
      {
        prepareTurn: (request: ChatTurnRequest) => ({
          request,
          persistedContent: request.text,
          prompt: request.text,
          isCompact: false,
          mcpMentions: new Set<string>(),
        }),
        encodeRequestRef: (turn: PreparedChatTurn) => `encoded:${turn.prompt}`,
        reasoningControl: 'effort',
        currentSessionId: () => 'native-session',
      },
      codexProviderModule.features({
        listSkills: async () => [],
        listAgentMentions: async () => [],
        refreshAgentMentions: async () => undefined,
        resolveCliPath: async () => null,
        listModels: async () => [],
        refreshModels: async () => [],
        readPlanUsage: async () => null,
        shouldKeepWarm: () => false,
        renderSettingsTab: () => undefined,
        hydrateConversation: async () => ({ outcome: 'complete' as const }),
        deleteConversationSession: async () => undefined,
        resolveSessionId: () => 'thread-1',
        isPendingFork: () => false,
        recognizesSubagentTool: () => false,
        parseSubagentDisplay: () => null,
        dispose: async () => undefined,
      }),
    );
  }

  it('establishes a session on first use and reports readiness once', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    const ready: boolean[] = [];
    adapter.onReadyStateChange((state: boolean) => ready.push(state));

    expect(adapter.isReady()).toBe(false);
    expect(await adapter.ensureReady()).toBe(true);
    // Idempotent: a second call must not create a second session for one
    // conversation, which would give the same tab two owners.
    expect(await adapter.ensureReady()).toBe(true);

    expect(adapter.isReady()).toBe(true);
    expect(ready).toEqual([true]);
  });

  it('streams a turn and closes only on the terminal', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    const turn = adapter.prepareTurn({ text: 'hello' });
    const collected = drain(adapter.query(turn));
    const runId = toRunId(`run-${'1'.padStart(32, '0')}`);
    // The generator body runs on the microtask queue, so the run is not
    // dispatched the moment `query` is called. Waiting on the dispatch itself
    // is the only signal that does not race.
    for (let attempt = 0; attempt < 200 && !harness.dispatched(runId); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await harness.emit(
      runId,
      { kind: 'output-delta', channel: 'assistant', text: 'answer' },
      'd-1',
    );
    await harness.emit(runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }, 'd-2');

    expect(await collected).toEqual([{ type: 'text', content: 'answer' }]);
    expect(harness.dispatched(runId)?.requestRef).toBe('encoded:hello');
    expect(adapter.consumeTurnMetadata()).toEqual({ wasSent: true });
  });

  it('projects the capability record the UI reads', async () => {
    const adapter = createAdapter(await createHarness({ ownSession: true }));

    expect(adapter.getCapabilities().providerId).toBe('codex');
    expect(adapter.getCapabilities().supportsTurnSteer).toBe(true);
  });

  it('exposes steer only where the provider steers', async () => {
    const harness = await createHarness({ ownSession: true });

    expect(createAdapter(harness).steer).toBeDefined();
    expect(new ExecutionChatRuntimeAdapter(
      { ...harness.context, capabilities: antigravityProviderModule.capabilities },
      {
        prepareTurn: (request: ChatTurnRequest) => ({
          request,
          persistedContent: request.text,
          prompt: request.text,
          isCompact: false,
          mcpMentions: new Set<string>(),
        }),
        encodeRequestRef: () => 'encoded',
        reasoningControl: 'effort',
        currentSessionId: () => null,
      },
      antigravityProviderModule.features({
        resolveCliPath: async () => null,
        listModels: async () => [],
        refreshModels: async () => [],
      }),
    ).steer).toBeUndefined();
  });

  it('cancels and waits before disposing, because tabs close mid-turn', async () => {
    // disposeSession refuses a session with a live run, and today's destroyTab
    // calls cancel fire-and-forget then cleanup immediately. An adapter that
    // only disposed would reject on the common path, leak the session, and do
    // it as an unhandled rejection, since ChatRuntime.cleanup returns void.
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    const turn = adapter.prepareTurn({ text: 'hello' });
    const collected = drain(adapter.query(turn));
    const runId = toRunId(`run-${'1'.padStart(32, '0')}`);
    for (let attempt = 0; attempt < 200 && !harness.dispatched(runId); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    const cleanup = adapter.cleanup();
    await harness.emit(
      runId,
      { kind: 'terminal', terminal: 'cancelled', reason: 'cancellation-confirmed' },
      'd-1',
    );

    await expect(cleanup).resolves.toBeUndefined();
    await collected;
    expect(adapter.isReady()).toBe(false);
  });

  it('releases the session on cleanup, preserving today\'s tab-close behaviour', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    await adapter.ensureReady();

    await adapter.cleanup();

    expect(adapter.isReady()).toBe(false);
  });
});

describe('coverage over the four proof topologies', () => {
  const traces = [
    { providerId: 'antigravity', trace: antigravityTrace },
    { providerId: 'codex', trace: codexTrace },
    { providerId: 'claude', trace: claudeTrace },
    { providerId: 'opencode', trace: opencodeTrace },
  ];

  /**
   * Kernel event kinds a fixture records.
   *
   * Filtered against the union rather than taken whole: a fixture's `cases` mix
   * two vocabularies — some list protocol steps like `thread/start`, others list
   * emitted events — and separating them properly is fixture surgery this
   * milestone does not need.
   */
  function recordedKinds(trace: {
    cases?: Record<string, readonly string[]>;
    eventCases?: Record<string, readonly string[]>;
  }): ExecutionEvent['kind'][] {
    return [
      ...Object.values(trace.cases ?? {}).flat(),
      ...Object.values(trace.eventCases ?? {}).flat(),
    ]
      .map(entry => entry.split(':')[0])
      .filter((kind): kind is ExecutionEvent['kind'] => (
        KERNEL_EVENT_KINDS.includes(kind as ExecutionEvent['kind'])
      ));
  }

  it.each(traces)('$providerId records events the adapter classifies', ({ trace }) => {
    const kinds = recordedKinds(trace);

    // Not vacuous: a fixture that recorded no kernel events at all would make
    // every per-provider claim below meaningless.
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every(kind => ['chunk', 'terminal', 'ignored']
      .includes(classifyForPresentation(kind)))).toBe(true);
  });

  it.each(traces)('$providerId delivers content the adapter can render', ({ trace }) => {
    // `output-delta` is the only kind the adapter renders as text, so a
    // topology recording none renders every answered turn as an empty one.
    //
    // This assertion used to read the other way for print mode: it required
    // Antigravity to emit no content, on the reasoning that a process-per-run
    // topology cannot stream. Cannot stream *incrementally* is true and stays
    // recorded as the fixture's `topology`; cannot carry content was the wrong
    // conclusion from it, and it survived only while the backend was dark.
    expect(recordedKinds(trace)).toContain('output-delta');
  });

  it('renders exactly one kind as content and one as a terminal', () => {
    const byPresentation = KERNEL_EVENT_KINDS.reduce<Record<string, string[]>>((totals, kind) => {
      const presentation = classifyForPresentation(kind);
      totals[presentation] = [...(totals[presentation] ?? []), kind];
      return totals;
    }, {});

    expect(byPresentation.chunk).toEqual(['output-delta']);
    expect(byPresentation.terminal).toEqual(['terminal']);
    expect(byPresentation.ignored.length).toBeGreaterThan(0);
  });
});

/**
 * Every kind the union declares, read from the source rather than restated.
 *
 * A hand-written copy would silently stop covering the next kind someone adds,
 * which is the exact failure the classification exists to prevent — the list
 * would still pass while the adapter had no answer for the new event.
 */
const KERNEL_EVENT_KINDS = [
  ...new Set(
    [...readFileSync(resolve(process.cwd(), 'src/core/execution/ExecutionEvents.ts'), 'utf8')
      .matchAll(/readonly kind: '([a-z-]+)'/g)]
      .map(match => match[1]),
  ),
]
  // The same file declares the event scopes, whose kinds are not events.
  .filter(kind => !['session', 'run', 'agent'].includes(kind)) as ExecutionEvent['kind'][];

describe('the classification covers the union it claims to', () => {
  it('reads every kind from the source and finds no gap', () => {
    // Guards the guard: if this list stopped matching the union, every
    // per-provider claim above would keep passing while covering less.
    expect(KERNEL_EVENT_KINDS.length).toBeGreaterThan(10);
    expect(KERNEL_EVENT_KINDS).toContain('output-delta');
    expect(KERNEL_EVENT_KINDS).toContain('terminal');
    expect(new Set(KERNEL_EVENT_KINDS).size).toBe(KERNEL_EVENT_KINDS.length);

    // The assertion that actually bites. Exhaustiveness is a compile error only
    // while the switch has no `default`; the first person to add one would turn
    // an unclassified event into `undefined` at runtime, and every claim above
    // would keep passing.
    const unclassified = KERNEL_EVENT_KINDS.filter(kind => !['chunk', 'terminal', 'ignored']
      .includes(classifyForPresentation(kind)));
    expect(unclassified).toEqual([]);
  });
});

describe('concurrent readiness', () => {
  it('establishes one session for overlapping callers', async () => {
    // Two overlapping calls each saw no session, each minted an id, and the
    // first session was orphaned with nothing left holding its id to dispose
    // it. The sequential idempotence test could not see that.
    const harness = await createHarness({ ownSession: true });
    let minted = 0;
    const adapter = new ExecutionChatRuntimeAdapter(
      {
        ...harness.context,
        nextExecutionSessionId: () => {
          minted += 1;
          return executionSessionId(`es-${String(minted).repeat(32).slice(0, 32)}`);
        },
      },
      {
        prepareTurn: (request: ChatTurnRequest) => ({
          request,
          persistedContent: request.text,
          prompt: request.text,
          isCompact: false,
          mcpMentions: new Set<string>(),
        }),
        encodeRequestRef: () => 'encoded',
        reasoningControl: 'effort',
        currentSessionId: () => null,
      },
      antigravityProviderModule.features({
        resolveCliPath: async () => null,
        listModels: async () => [],
        refreshModels: async () => [],
      }),
    );

    await Promise.all([adapter.ensureReady(), adapter.ensureReady(), adapter.ensureReady()]);

    expect(minted).toBe(1);
  });
});
