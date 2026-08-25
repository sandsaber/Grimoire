import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import antigravityTrace from '@test/fixtures/provider-traces/antigravity-execution.json';
import claudeTrace from '@test/fixtures/provider-traces/claude-execution.json';
import codexTrace from '@test/fixtures/provider-traces/codex-execution.json';
import opencodeTrace from '@test/fixtures/provider-traces/opencode-execution.json';
import {
  ANTIGRAVITY_PROVIDER_CAPABILITIES,
  CLAUDE_PROVIDER_CAPABILITIES,
  CODEX_PROVIDER_CAPABILITIES,
  GEMINI_PROVIDER_CAPABILITIES,
  GROK_PROVIDER_CAPABILITIES,
  KIMICODE_PROVIDER_CAPABILITIES,
  MIMOCODE_PROVIDER_CAPABILITIES,
  OPENCODE_PROVIDER_CAPABILITIES,
  QWEN_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ExecutionOwner,
  ExecutionRequest,
  RunTerminalReason,
} from '@/core/execution/ExecutionContracts';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import type {
  ExecutionEvent,
  ExecutionEventEnvelope,
  ProviderExecutionEvent,
} from '@/core/execution/ExecutionEvents';
import {
  type ExecutionSessionId,
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
import { toLegacyCapabilities } from '@/core/providers/legacyCapabilities';
import type { ProviderCapabilities } from '@/core/providers/types';
import {
  classifyForPresentation,
  dispatchCancellation,
  ExecutionAdapterSession,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeAdapterContext,
  type ExecutionChatRuntimeHostPorts,
  ExecutionRunStream,
  startExecutionRun,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { AutoTurnResult } from '@/core/runtime/types';
import type {
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types/chat';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import type { CodexProviderSettings } from '@/providers/codex/settings';
import { geminiProviderModule } from '@/providers/gemini/GeminiProviderModule';
import { grokProviderModule } from '@/providers/grok/GrokProviderModule';
import { kimicodeProviderModule } from '@/providers/kimicode/KimicodeProviderModule';
import { mimocodeProviderModule } from '@/providers/mimocode/MimocodeProviderModule';
import { opencodeProviderModule } from '@/providers/opencode/OpencodeProviderModule';
import { qwenProviderModule } from '@/providers/qwen/QwenProviderModule';

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
  readonly backend: DeterministicFakeBackend;
  readonly context: ExecutionChatRuntimeAdapterContext;
  emit(runId: RunId, event: ExecutionEvent, deliveryId: string): Promise<unknown>;
  dispatched(runId: RunId): ExecutionRequest | undefined;
  steeredRefs(): readonly string[];
  /** The owner the last established session was recorded under. */
  sessionOwner(): { readonly kind: string; readonly ownerId: string } | null;
  /** What the composition would answer for the conversation a tab is showing. */
  bindConversation(conversationId: string): void;
  /** What a composition answers for a tab that has no conversation yet. */
  bindNoConversation(): void;
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
  let currentOwner: ExecutionOwner = { kind: 'conversation', ownerId: 'adapter-conformance' };
  let sessionOrdinal = 0;
  const established: ExecutionSessionId[] = [];
  const owner = currentOwner;
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
    backend,
    context: {
      registry,
      backendId: backend.descriptor.backendId,
      capabilities: codexProviderModule.capabilities,
      owner: () => currentOwner,
      // The first is the id the harness's own emissions are addressed to; a
      // tab that moves to another conversation establishes a second.
      nextExecutionSessionId: () => {
        const next = sessionOrdinal === 0
          ? SESSION_ID
          : executionSessionId(`es-${(sessionOrdinal + 1).toString().repeat(32).slice(0, 32)}`);
        sessionOrdinal += 1;
        established.push(next);
        return next;
      },
      nextRunId: () => toRunId(`run-${(++runOrdinal).toString().padStart(32, '0')}`),
    },
    /** The owner the last established session was recorded under. */
    sessionOwner: () => registry.getSession(established[established.length - 1])?.owner ?? null,
    bindConversation(conversationId: string) {
      currentOwner = { kind: 'conversation' as const, ownerId: conversationId };
    },
    bindNoConversation() {
      currentOwner = { kind: 'internal-service' as const, ownerId: 'grimoiretab-1' };
    },
    dispatched: runId => backend.dispatchedRequests.get(runId),
    steeredRefs: () => [...backend.sessions.values()].flatMap(session => session.steeredRefs),
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

/** What the registry hands a session observer for a run it is watching. */
function sideChannel(
  runId: RunId,
  event: ExecutionEvent,
  sequence: number,
): ExecutionEventEnvelope {
  return {
    schemaVersion: 1,
    backendId: executionBackendId('provider-fake'),
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: INSTANCE_ID,
    eventId: `side-${sequence}`,
    sequence,
    occurredAt: sequence,
    scope: { kind: 'run', runId },
    event,
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

  it('closes on an acknowledged cancellation, which the registry treats as terminal', async () => {
    // The registry reduces `cancellation-acknowledged` to a `cancelled`
    // terminal, and then drops the explicit `terminal` the backend sends next
    // as post-terminal. A stream that waited only for `terminal` therefore
    // waited forever: the generator never closed and the turn never ended.
    // Observed as a hung cancel on the first flipped provider; Claude's
    // recorded trace has the same shape, so it would have hit that flip too.
    const harness = await createHarness();
    const { runId, stream, release } = await startExecutionRun(
      harness.context,
      SESSION_ID,
      { requestRef: 'opaque-request' },
    );
    const collected = drain(stream.chunks());

    await harness.emit(runId, { kind: 'run-started' }, 'd-1');
    dispatchCancellation(harness.context, runId, stream);
    await harness.emit(runId, { kind: 'cancellation-acknowledged' }, 'd-2');

    // Closes, and renders nothing: the controller's cancel path already says
    // the turn was interrupted.
    expect(await collected).toEqual([]);
    expect(stream.settled()).toBe(true);
    expect(stream.consumeTurnMetadata().wasSent).toBe(true);
    release();
  });

  it('renders a turn that never reached the provider, in its words where it has them', async () => {
    // Two claims, both found by the first flip.
    //
    // An `invalidated` terminal used to render nothing at all — the turn ended
    // with an empty assistant message and no explanation, which is the silent
    // empty answer this adapter exists to prevent, one terminal over. For print
    // mode it is the *default* first turn: the permission mode ships as
    // `normal` and `agy --print` cannot ask for approvals.
    //
    // And the neutral sentence for that classification cannot name the setting
    // to change, so a provider with a better one supplies it. Provider error
    // *text* still never travels; this is a translation of a cause the kernel
    // already decided, which is why it can be localized and acted on.
    const rejected = async (present?: (reason: RunTerminalReason) => string | undefined) => {
      const harness = await createHarness();
      const started = await startExecutionRun(
        harness.context,
        SESSION_ID,
        { requestRef: 'opaque-request' },
        undefined,
        present,
      );
      const collected = drain(started.stream.chunks());
      await harness.emit(
        started.runId,
        {
          kind: 'terminal',
          terminal: 'invalidated',
          reason: 'pre-dispatch-rejected',
          sideEffectFree: true,
        },
        'd-1',
      );
      const chunks = await collected;
      started.release();
      return chunks;
    };

    expect(await rejected(
      reason => (reason === 'pre-dispatch-rejected' ? 'Switch the permission mode.' : undefined),
    )).toEqual([{ type: 'error', content: 'Switch the permission mode.' }]);
    expect(await rejected(() => undefined)).toEqual([{
      type: 'error',
      content: 'The turn was rejected before it started, so nothing ran.',
    }]);
    // A presenter reads live settings, so it can throw — and it is called while
    // a terminal is being recorded. Letting that escape abandons the terminal
    // mid-flight and the generator never closes: the turn simply never ends,
    // which is worse than any wording. Observed as a hung turn.
    expect(await rejected(() => {
      throw new Error('settings are not available');
    })).toEqual([{
      type: 'error',
      content: 'The turn was rejected before it started, so nothing ran.',
    }]);
  });

  describe('capability projection over every shipped provider', () => {
    // All nine, not the four proof topologies. The four-provider version was
    // written when only four modules existed, and it stayed that way after the
    // other five landed — so five providers' UI gating could have drifted from
    // the record the UI actually reads with nothing to say so.
    const modules = [
      antigravityProviderModule,
      codexProviderModule,
      claudeProviderModule,
      opencodeProviderModule,
      geminiProviderModule,
      grokProviderModule,
      kimicodeProviderModule,
      mimocodeProviderModule,
      qwenProviderModule,
    ];

    const liveRecords = {
      antigravity: ANTIGRAVITY_PROVIDER_CAPABILITIES,
      codex: CODEX_PROVIDER_CAPABILITIES,
      claude: CLAUDE_PROVIDER_CAPABILITIES,
      opencode: OPENCODE_PROVIDER_CAPABILITIES,
      gemini: GEMINI_PROVIDER_CAPABILITIES,
      grok: GROK_PROVIDER_CAPABILITIES,
      kimicode: KIMICODE_PROVIDER_CAPABILITIES,
      mimocode: MIMOCODE_PROVIDER_CAPABILITIES,
      qwen: QWEN_PROVIDER_CAPABILITIES,
    } as const;

    /**
     * Where a module's descriptor deliberately differs from the live record,
     * and what the difference means the day the UI gating moves onto it.
     *
     * Two entries, both found by widening this test from four providers to
     * nine. An empty table would be the goal; an unexplained failure is the
     * thing this replaces.
     */
    const DECLARED_DIVERGENCES: Record<string, Partial<ProviderCapabilities>> = {
      // Declared at Grok's flip: the legacy record says Grok can rewind, while
      // its runtime answered `canRewind: false` for every input, so every
      // assistant message carried a rewind button whose menu could only fail.
      // A live tab already reads the descriptor and has no button; a tab with
      // no service yet still reads the record. Moving the gating finishes the
      // removal.
      grok: { supportsRewind: false },
    };

    it.each(modules)('$manifest.id projects to its live record field for field', module => {
      // Every field, not a chosen few. The three-field version of this passed
      // while the projection reported `supportsProviderCommands: true` for
      // Codex against a live `false` — a UI change nobody had decided, which is
      // exactly what the preservation boundary forbids and what a partial
      // comparison cannot catch.
      const providerId = module.manifest.id;
      const live = liveRecords[providerId as keyof typeof liveRecords];

      expect(toLegacyCapabilities(module.capabilities))
        .toEqual({ ...live, ...DECLARED_DIVERGENCES[providerId] });
    });

    it('declares a divergence only for a provider that has one', () => {
      // Keeps the table from outliving its reason: an entry that no longer
      // differs is an exemption nobody removed.
      const stale = Object.entries(DECLARED_DIVERGENCES).filter(([providerId, difference]) => {
        const module = modules.find(entry => entry.manifest.id === providerId);
        const live = liveRecords[providerId as keyof typeof liveRecords];
        const projected = toLegacyCapabilities(module!.capabilities) as ProviderCapabilities;
        return Object.entries(difference).every(([field, value]) => (
          projected[field as keyof ProviderCapabilities] === live[
            field as keyof ProviderCapabilities
          ] || value === live[field as keyof ProviderCapabilities]
        ));
      });

      expect(stale).toEqual([]);
    });

    it.each(modules)('projects $manifest.id onto the record the UI reads', module => {
      const legacy = toLegacyCapabilities(module.capabilities);

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
          prefix: toLegacyCapabilities(module.capabilities).planPathPrefix,
        }))
        .filter(entry => entry.prefix !== undefined);

      expect(withPrefix).toEqual([{ id: 'claude', prefix: '/.claude/plans/' }]);
    });
  });
});

describe('the assembled ChatRuntime adapter', () => {
  /**
   * What a host mints, and where the payload it stands for is kept.
   *
   * Opaque on purpose: the registry accepts only a constrained identifier, so a
   * reference built out of the prompt is one space away from throwing. Real
   * hosts mint an id and keep the turn in a store, which is what this imitates.
   */
  const refPayloads = new Map<string, string>();

  function mintRef(prefix: string, turn: PreparedChatTurn): string {
    const ref = `${prefix}-${refPayloads.size + 1}`;
    refPayloads.set(ref, turn.prompt);
    return ref;
  }

  function readRef(ref: string | undefined): string | undefined {
    return ref === undefined ? undefined : refPayloads.get(ref);
  }

  function createAdapter(
    harness: Harness,
    ports: Partial<ExecutionChatRuntimeHostPorts> = {},
  ): ExecutionChatRuntimeAdapter<CodexProviderSettings> {
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
        encodeRequestRef: (turn: PreparedChatTurn) => mintRef('req', turn),
        encodeSteerRef: (turn: PreparedChatTurn) => mintRef('steer', turn),
        presentProviderContent: (payload: unknown) => {
          const item = payload as { tool?: string; result?: string };
          if (item.tool) {
            return [{ type: 'tool_use', id: 'call-1', name: item.tool, input: {} }];
          }
          return item.result ? [{ type: 'tool_result', id: 'call-1', content: item.result }] : [];
        },
        currentSessionId: () => 'native-session',
        delay: immediately,
        ...ports,
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

  it('reads its owner when the session is established, not when the tab is built', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    // A tab is built before it knows which conversation it is showing, so an
    // owner captured at construction is the tab's identity and not the
    // conversation's — and a control record keyed that way cannot be found
    // when the conversation is deleted (D4).
    harness.bindConversation('conversation-1');
    adapter.syncConversationState(
      { id: 'conversation-1', providerState: {}, sessionId: null },
    );

    await adapter.ensureReady();

    expect(harness.sessionOwner()).toEqual({ kind: 'conversation', ownerId: 'conversation-1' });
  });

  it('leaves the first conversation session behind when the tab moves to another', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    harness.bindConversation('conversation-1');
    adapter.syncConversationState(
      { id: 'conversation-1', providerState: {}, sessionId: null },
    );
    await adapter.ensureReady();

    harness.bindConversation('conversation-2');
    adapter.syncConversationState(
      { id: 'conversation-2', providerState: {}, sessionId: null },
    );

    // A tab is not a conversation: the session the first one was working in
    // must not carry on under the second's name, or one conversation's records
    // are owned by another — and deleting either takes the wrong ones.
    expect(adapter.isReady()).toBe(false);
    await adapter.ensureReady();
    expect(harness.sessionOwner()).toEqual({ kind: 'conversation', ownerId: 'conversation-2' });
  });

  it('does not keep a session it opened before it had a conversation', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    // A blank tab warms up before the user has sent anything: it establishes a
    // session, and that session is the tab's own.
    harness.bindNoConversation();
    await adapter.ensureReady();
    expect(harness.sessionOwner()).toMatchObject({ kind: 'internal-service' });

    harness.bindConversation('conversation-1');
    adapter.syncConversationState(
      { id: 'conversation-1', providerState: {}, sessionId: null },
    );

    // Carried forward, that session's records name an owner no conversation
    // deletion will ever look for — so they outlive the chat that produced
    // them with nothing able to remove them (D4). The next turn opens one under
    // the conversation instead.
    expect(adapter.isReady()).toBe(false);
    await adapter.ensureReady();
    expect(harness.sessionOwner()).toEqual({ kind: 'conversation', ownerId: 'conversation-1' });
  });

  it('follows the session it moved to, not the one it left', async () => {
    const harness = await createHarness({ ownSession: true });
    const observed: string[] = [];
    let released = 0;
    const observe = harness.registry.observe.bind(harness.registry);
    jest.spyOn(harness.registry, 'observe').mockImplementation((id, listener) => {
      observed.push(String(id));
      const stop = observe(id, listener);
      return () => {
        released += 1;
        stop();
      };
    });
    const adapter = createAdapter(harness);
    harness.bindConversation('conversation-1');
    adapter.syncConversationState(
      { id: 'conversation-1', providerState: {}, sessionId: null },
    );
    await adapter.ensureReady();

    harness.bindConversation('conversation-2');
    adapter.syncConversationState(
      { id: 'conversation-2', providerState: {}, sessionId: null },
    );
    await adapter.ensureReady();

    // Approvals, questions and backend-initiated turns all arrive on one
    // session-scoped observer, and only one is ever installed. A tab that kept
    // the observer for the conversation it left would stream the new one's
    // answer — the per-run observer is separate — and never show the approval
    // that turn is blocked on. New Chat and a history switch both take this
    // path, so it is the ordinary one.
    expect(observed).toHaveLength(2);
    expect(observed[1]).not.toBe(observed[0]);
    expect(released).toBe(1);
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
    expect(readRef(harness.dispatched(runId)?.requestRef)).toBe('hello');
    expect(adapter.consumeTurnMetadata()).toEqual({ wasSent: true });
  });

  it('leaves an in-flight turn the native ids the provider is holding for it', async () => {
    const harness = await createHarness({ ownSession: true });
    const side: Array<(envelope: ExecutionEventEnvelope) => void> = [];
    const observe = harness.registry.observe.bind(harness.registry);
    jest.spyOn(harness.registry, 'observe').mockImplementation((id, listener) => {
      side.push(listener);
      return observe(id, listener);
    });
    let consumed = 0;
    const adapter = createAdapter(harness, {
      consumeProviderTurnMetadata: () => {
        consumed += 1;
        return { userMessageId: 'provider-message' };
      },
    });
    const turns: AutoTurnResult[] = [];
    adapter.setAutoTurnCallback((result: AutoTurnResult) => {
      turns.push(result);
    });
    const userRun = toRunId(`run-${'1'.padStart(32, '0')}`);
    const collected = drain(adapter.query(adapter.prepareTurn({ text: 'hello' })));
    for (let attempt = 0; attempt < 200 && !harness.dispatched(userRun); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    // A run this adapter did not start, settling while the tab's own turn is
    // still going. The provider's metadata port is per tab and consuming it is
    // destructive, so reading it here hands the user's turn's native ids to a
    // turn nobody asked for — and rewind refuses to run without them.
    const backendRun = toRunId(`run-${'9'.repeat(32)}`);
    side[0]?.(sideChannel(backendRun, { kind: 'run-started' }, 1));
    side[0]?.(sideChannel(
      backendRun,
      { kind: 'output-delta', channel: 'assistant', text: 'unbidden' },
      2,
    ));
    side[0]?.(sideChannel(
      backendRun,
      { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      3,
    ));
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(turns).toHaveLength(1);
    expect(consumed).toBe(0);
    expect(turns[0]?.metadata.userMessageId).toBeUndefined();
    expect(turns[0]?.chunks).toEqual([{ type: 'text', content: 'unbidden' }]);

    await harness.emit(userRun, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }, 'd-9');
    await collected;
    // Still there for the turn that earned it.
    expect(adapter.consumeTurnMetadata().userMessageId).toBe('provider-message');
  });

  it('cancels the run it is dropping before it disposes the session', async () => {
    const harness = await createHarness({ ownSession: true });
    const failures: unknown[] = [];
    const adapter = createAdapter(harness, {
      reportCleanupFailure: (error: unknown) => { failures.push(error); },
    });
    const userRun = toRunId(`run-${'1'.padStart(32, '0')}`);
    const collected = drain(adapter.query(adapter.prepareTurn({ text: 'hello' })));
    for (let attempt = 0; attempt < 200 && !harness.dispatched(userRun); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const disposed: string[] = [];
    const disposeSession = harness.registry.disposeSession.bind(harness.registry);
    jest.spyOn(harness.registry, 'disposeSession').mockImplementation(async id => {
      disposed.push(String(id));
      return disposeSession(id);
    });

    // A tab moving to another conversation while its turn is still streaming.
    // Disposing a session with a live run is refused by the registry, and the
    // rejection used to be swallowed into `reportCleanupFailure` with the
    // session id already forgotten — the kernel session and its provider
    // process then had nothing left holding a reference to them.
    adapter.syncConversationState({
      id: 'another-conversation',
      messages: [],
      providerState: {},
      sessionId: null,
    } as never);
    await collected;
    for (let attempt = 0; attempt < 200 && disposed.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    expect(disposed).toHaveLength(1);
    expect(failures).toEqual([]);
  });

  it('does not follow its own run as a backend turn', async () => {
    const harness = await createHarness({ ownSession: true });
    const side: Array<(envelope: ExecutionEventEnvelope) => void> = [];
    const observe = harness.registry.observe.bind(harness.registry);
    jest.spyOn(harness.registry, 'observe').mockImplementation((id, listener) => {
      side.push(listener);
      return observe(id, listener);
    });
    const adapter = createAdapter(harness);
    const turns: AutoTurnResult[] = [];
    adapter.setAutoTurnCallback((result: AutoTurnResult) => {
      turns.push(result);
    });
    await adapter.ensureReady();

    const userRun = toRunId(`run-${'1'.padStart(32, '0')}`);
    // The tab's own `run-started`, delivered while `startRun` is still in
    // flight — the window `startExecutionRun`'s own docstring warns about, and
    // the only way to reach it is from inside that call. Unrecognised, the
    // adapter opens a second stream for the turn it is already streaming and
    // the surface renders it twice: once from the generator, once as an
    // auto-turn nobody asked for.
    const startRun = harness.registry.startRun.bind(harness.registry);
    jest.spyOn(harness.registry, 'startRun').mockImplementation(async (id, request) => {
      side[0]?.(sideChannel(request.runId, { kind: 'run-started' }, 1));
      return startRun(id, request);
    });
    const collected = drain(adapter.query(adapter.prepareTurn({ text: 'hello' })));
    for (let attempt = 0; attempt < 200 && !harness.dispatched(userRun); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await harness.emit(
      userRun,
      { kind: 'output-delta', channel: 'assistant', text: 'answer' },
      'd-1',
    );
    await harness.emit(userRun, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }, 'd-2');

    await expect(collected).resolves.toEqual([{ type: 'text', content: 'answer' }]);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(turns).toEqual([]);
  });

  it('drops a backend turn the tab stopped following', async () => {
    const harness = await createHarness({ ownSession: true });
    const side: Array<(envelope: ExecutionEventEnvelope) => void> = [];
    const observe = harness.registry.observe.bind(harness.registry);
    jest.spyOn(harness.registry, 'observe').mockImplementation((id, listener) => {
      side.push(listener);
      return observe(id, listener);
    });
    const adapter = createAdapter(harness);
    const turns: AutoTurnResult[] = [];
    adapter.setAutoTurnCallback((result: AutoTurnResult) => {
      turns.push(result);
    });
    await adapter.ensureReady();

    const backendRun = toRunId(`run-${'8'.repeat(32)}`);
    side[0]?.(sideChannel(backendRun, { kind: 'run-started' }, 1));
    side[0]?.(sideChannel(
      backendRun,
      { kind: 'output-delta', channel: 'assistant', text: 'unbidden' },
      2,
    ));
    // The conversation moves on before the turn nobody asked for finishes.
    // Delivering it now would render one conversation's turn into another's
    // transcript; leaving it collecting would hold the closure for good.
    adapter.resetSession();
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(turns).toEqual([]);
  });

  it('projects the capability record the UI reads', async () => {
    const adapter = createAdapter(await createHarness({ ownSession: true }));

    expect(adapter.getCapabilities().providerId).toBe('codex');
    expect(adapter.getCapabilities().supportsTurnSteer).toBe(true);
  });

  it('exposes steer only where the provider steers and the host can encode input', async () => {
    const harness = await createHarness({ ownSession: true });

    expect(createAdapter(harness).steer).toBeDefined();
    // A steering provider whose host cannot encode an input has no steer
    // either: the controller offers the affordance by testing for the member,
    // so one that is present and always fails reads to the user as a capability.
    expect(new ExecutionChatRuntimeAdapter(
      harness.context,
      {
        prepareTurn: (request: ChatTurnRequest) => ({
          request,
          persistedContent: request.text,
          prompt: request.text,
          isCompact: false,
          mcpMentions: new Set<string>(),
        }),
        encodeRequestRef: () => 'encoded',
        currentSessionId: () => null,
        delay: immediately,
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
    ).steer).toBeUndefined();
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
        currentSessionId: () => null,
        delay: immediately,
      },
      antigravityProviderModule.features({
        resolveCliPath: async () => null,
        listModels: async () => [],
        refreshModels: async () => [],
      }),
    ).steer).toBeUndefined();
  });

  it('steers a running turn through the registry, and declines when it cannot', async () => {
    // The first thing Codex needs that Antigravity did not, and the kernel had
    // no path for it at all: `steer` was a stub that threw. It answers `false`
    // rather than throwing for every reason an input cannot land, because the
    // caller is a button the user pressed and the controller falls back to
    // queueing the message instead.
    const harness = await createHarness();
    const adapter = createAdapter(harness);
    const steer = adapter.steer;
    if (!steer) {
      throw new Error('Codex capabilities declare steering.');
    }
    const turn: PreparedChatTurn = {
      request: { text: 'meanwhile' },
      persistedContent: 'meanwhile',
      prompt: 'meanwhile',
      isCompact: false,
      mcpMentions: new Set<string>(),
    };

    // Nothing running: nothing to add input to, and no throw on the way out.
    expect(await steer(turn)).toBe(false);

    const started = await startExecutionRun(harness.context, SESSION_ID, {
      requestRef: 'opaque-request',
    });
    // The adapter steers its own active run, so it has to be the one that
    // started it; this drives the same registry path the adapter uses.
    const accepted = await harness.registry.steerRun(started.runId, 'steer:meanwhile');
    await harness.emit(
      started.runId,
      { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      'd-1',
    );
    started.release();

    expect(accepted).toBe(true);
    expect(harness.steeredRefs()).toEqual(['steer:meanwhile']);
    // And once the run is terminal the same input is declined rather than
    // handed to a provider that has nothing left to add it to.
    expect(await harness.registry.steerRun(started.runId, 'steer:too-late')).toBe(false);
    expect(harness.steeredRefs()).toEqual(['steer:meanwhile']);
  });

  it('declines input for a backend that cannot take it mid-turn', async () => {
    // The registry decides by whether the session has a `steer` at all. That
    // branch had no test, because the double always had one — a double that
    // cannot represent the provider it stands for proves less than it appears.
    const harness = await createHarness();
    harness.backend.steerMode = 'unsupported';
    const started = await startExecutionRun(harness.context, SESSION_ID, {
      requestRef: 'opaque-request',
    });

    const accepted = await harness.registry.steerRun(started.runId, 'steer:anything');

    await harness.emit(
      started.runId,
      { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
      'd-1',
    );
    started.release();

    expect(accepted).toBe(false);
    expect(harness.steeredRefs()).toEqual([]);
  });

  it('renders provider content through the host, and nothing without one', async () => {
    // Core does not model a tool call. It carries the provider's item and the
    // host turns it into the chunks the surface already reads — which is the
    // only way a provider whose turn is more than text can be rendered at all.
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    const collected = drain(adapter.query(adapter.prepareTurn({ text: 'build it' })));
    const runId = toRunId(`run-${'1'.padStart(32, '0')}`);
    for (let attempt = 0; attempt < 200 && !harness.dispatched(runId); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    await harness.emit(runId, { kind: 'provider-content', payload: { tool: 'Bash' } }, 'd-1');
    await harness.emit(runId, { kind: 'provider-content', payload: { result: 'ok' } }, 'd-2');
    // An item the host has nothing to say about is dropped rather than guessed.
    await harness.emit(runId, { kind: 'provider-content', payload: {} }, 'd-3');
    await harness.emit(runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }, 'd-4');

    expect(await collected).toEqual([
      { type: 'tool_use', id: 'call-1', name: 'Bash', input: {} },
      { type: 'tool_result', id: 'call-1', content: 'ok' },
    ]);
  });

  it('adds input to the run it started, through its own steer', async () => {
    // The production path, which the registry-level test above does not reach:
    // `adapter.steer` finds its own active run, asks the host to encode the
    // input, and hands the reference to the registry. The prompt has a space in
    // it because a real queued message does, and the reference the host mints
    // has to survive the registry's identifier rule either way.
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    const collected = drain(adapter.query(adapter.prepareTurn({ text: 'hello' })));
    const runId = toRunId(`run-${'1'.padStart(32, '0')}`);
    for (let attempt = 0; attempt < 200 && !harness.dispatched(runId); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    const steered = await adapter.steer?.(adapter.prepareTurn({ text: 'do this instead' }));

    await harness.emit(runId, { kind: 'terminal', terminal: 'succeeded', reason: 'completed' }, 'd-1');
    await collected;

    expect(steered).toBe(true);
    expect(harness.steeredRefs().map(readRef)).toEqual(['do this instead']);
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

  it('classifies exactly two kinds as content and two as terminals', () => {
    const byPresentation = KERNEL_EVENT_KINDS.reduce<Record<string, string[]>>((totals, kind) => {
      const presentation = classifyForPresentation(kind);
      totals[presentation] = [...(totals[presentation] ?? []), kind];
      return totals;
    }, {});

    // Two, because a turn says two kinds of thing: text, and the items a
    // surface renders as tool calls, results, plans and boundaries. The second
    // is opaque to core and reaches the surface through the host's presenter.
    expect([...byPresentation.chunk].sort()).toEqual(['output-delta', 'provider-content']);
    // Two, because the registry reduces an acknowledged cancellation into a
    // terminal and then drops the explicit one that follows. This list said
    // `['terminal']` while `accept` had already been taught otherwise, and a
    // classifier that disagrees with the code it describes is how the hung
    // cancel would come back through the next refactor that trusts it.
    expect([...byPresentation.terminal].sort())
      .toEqual(['cancellation-acknowledged', 'terminal']);
    expect(byPresentation.ignored.length).toBeGreaterThan(0);
  });

  it('classifies every kind the stream closes on as a terminal', () => {
    // The agreement itself, rather than a list that has to be kept in step by
    // hand: whatever `accept` settles on must classify as `terminal`.
    const terminalKinds = KERNEL_EVENT_KINDS
      .filter(kind => classifyForPresentation(kind) === 'terminal');

    for (const kind of KERNEL_EVENT_KINDS) {
      const stream = new ExecutionRunStream(CLASSIFIER_RUN_ID);
      stream.accept(envelopeFor(kind));

      expect(stream.settled()).toBe(terminalKinds.includes(kind));
    }
  });
});

/**
 * Every kind the union declares, read from the source rather than restated.
 *
 * A hand-written copy would silently stop covering the next kind someone adds,
 * which is the exact failure the classification exists to prevent — the list
 * would still pass while the adapter had no answer for the new event.
 */
const CLASSIFIER_RUN_ID = toRunId(`run-${'e'.repeat(32)}`);

/** A minimal accepted envelope for one kind, so the stream can be fed each one. */
function envelopeFor(kind: ExecutionEvent['kind']): ExecutionEventEnvelope {
  const payloads: Partial<Record<ExecutionEvent['kind'], Record<string, unknown>>> = {
    'output-delta': { channel: 'assistant', text: 'x' },
    'tool-activity': { toolCallId: 'tool-1' },
    progress: { progressId: 'progress-1' },
    result: { result: { resultId: 'result-1', storage: 'projection' } },
    'interaction-opened': {
      interaction: { interactionId: 'ix-1', kind: 'approval', options: [] },
    },
    'interaction-resolved': { interactionId: 'ix-1', responseId: 'allow' },
    recovered: { state: 'running' },
    terminal: { terminal: 'failed', reason: 'provider-failure' },
    'native-agent-observed': { nativeAgentKey: 'agent-1' },
    'native-agent-result': {
      nativeAgentKey: 'agent-1',
      result: { resultId: 'result-1', storage: 'projection' },
    },
    'native-agent-activity': { nativeAgentKey: 'agent-1', activity: 'input-sent' },
    'native-agent-status': { nativeAgentKey: 'agent-1', status: 'running' },
  };
  return {
    schemaVersion: 1,
    backendId: executionBackendId('internal-deterministic-fake'),
    backendGeneration: 1,
    executionSessionId: SESSION_ID,
    sessionInstanceId: INSTANCE_ID,
    eventId: `${CLASSIFIER_RUN_ID}:1`,
    sequence: 1,
    occurredAt: 1,
    scope: { kind: 'run', runId: CLASSIFIER_RUN_ID },
    event: { kind, ...(payloads[kind] ?? {}) } as ExecutionEvent,
  };
}

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
        currentSessionId: () => null,
        delay: immediately,
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

/**
 * The host's timer, for suites that only need the wait to end.
 *
 * Required rather than optional on the port, because core owns no timer: the
 * adapter must not touch `window`, and Obsidian's review wants the browser's
 * own `setTimeout` where a popped-out view can see it.
 */
function immediately(): Promise<void> {
  return Promise.resolve();
}
