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
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import type { CodexProviderSettings } from '@/providers/codex/settings';
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

  it('releases the session on cleanup, preserving today\'s tab-close behaviour', async () => {
    const harness = await createHarness({ ownSession: true });
    const adapter = createAdapter(harness);
    await adapter.ensureReady();

    await adapter.cleanup();

    expect(adapter.isReady()).toBe(false);
  });
});
