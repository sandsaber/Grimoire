import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { SETTINGS_TRANSITIONS_PATH } from '@/core/bootstrap/StoragePaths';
import type { ResultRef } from '@/core/execution/ExecutionContracts';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import type { RunId } from '@/core/execution/ExecutionIds';
import {
  executionSessionId,
  interactionId,
  lifecycleLeaseId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import type { DurableStorage } from '@/core/persistence/DurableStorage';
import type { TransactionCrashPoint } from '@/core/persistence/TransactionIntentCoordinator';

const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
const SESSION_ID_2 = executionSessionId(`es-${'2'.repeat(32)}`);
const RUN_ID = runId(`run-${'3'.repeat(32)}`);
const RUN_ID_2 = runId(`run-${'4'.repeat(32)}`);
const INTERACTION_ID = interactionId(`ix-${'5'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'conversation-1' };
const RESULT: ResultRef = { resultId: 'result-1', storage: 'projection' };

describe('ExecutionLifecycleRegistry', () => {
  it('keeps startup fail-closed and accepts a backend with no provider association', async () => {
    const fixture = createFixture();

    expect(fixture.backend.descriptor.association).toEqual({
      kind: 'internal',
      service: 'deterministic-test',
    });
    await expect(fixture.registry.createSession(sessionCommand())).rejects.toThrow(
      'not accepting new work',
    );

    await fixture.registry.start();
    await expect(fixture.registry.createSession(sessionCommand())).resolves.toBe(SESSION_ID);
  });

  it('deduplicates cross-stream delivery and persists exactly one terminal', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);

    fixture.backend.emit(RUN_ID, { kind: 'result', result: RESULT }, {
      deliveryId: 'native-result-1',
      destination: 'both',
    });
    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    }, { deliveryId: 'native-terminal-1', destination: 'both' });
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)).toMatchObject({
      state: 'succeeded',
      resultRef: RESULT,
      terminal: { kind: 'succeeded', reason: 'completed', resultRef: RESULT },
      lastSequence: 2,
    });
    const beforeRun = await currentRecord(fixture.repositories.runs.read(RUN_ID));
    const beforeSession = await currentRecord(fixture.repositories.sessions.read(SESSION_ID));

    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'failed',
      reason: 'provider-failure',
    }, { deliveryId: 'late-terminal-2', destination: 'session' });
    await settle(fixture.registry);

    const afterRun = await currentRecord(fixture.repositories.runs.read(RUN_ID));
    const afterSession = await currentRecord(fixture.repositories.sessions.read(SESSION_ID));
    expect(afterRun.revision).toBe(beforeRun.revision);
    expect(afterSession.revision).toBe(beforeSession.revision);
    expect(afterRun.payload.terminal).toEqual(beforeRun.payload.terminal);
  });

  it('accepts the identical delivery after persistence fails before an intent exists', async () => {
    let failNextIntent = false;
    const fixture = await startedFixture(undefined, {
      crashInjector: point => {
        if (failNextIntent && point === 'before-intent') {
          failNextIntent = false;
          throw new Error('injected before-intent failure');
        }
      },
    });
    await startDefaultRun(fixture);
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const delivery = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'thinking-activity' },
      { deliveryId: 'retry-after-storage-failure' },
    );

    failNextIntent = true;
    await expect(fixture.registry.ingest(delivery)).rejects.toThrow('before-intent');
    await expect(fixture.registry.ingest(delivery)).resolves.toMatchObject({
      kind: 'accepted',
      envelopes: [{ eventId: 'retry-after-storage-failure', sequence: 1 }],
    });

    expect(fixture.registry.getRun(RUN_ID)?.lastSequence).toBe(1);
  });

  it('fences later ingress until a partially applied event transaction converges', async () => {
    let failAfterSessionWrite = false;
    const fixture = await startedFixture(undefined, {
      crashInjector: point => {
        if (failAfterSessionWrite && point === 'after-step-effect:step-0') {
          throw new Error('injected partial event transaction');
        }
      },
    });
    await startDefaultRun(fixture);
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const first = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'thinking-activity' },
      { deliveryId: 'partial-event-1' },
    );
    const second = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'progress', progressId: 'after-partial' },
      { deliveryId: 'partial-event-2' },
    );

    failAfterSessionWrite = true;
    await expect(fixture.registry.ingest(first)).rejects.toThrow('partial event transaction');
    expect((await currentRecord(fixture.repositories.sessions.read(SESSION_ID))).payload)
      .toMatchObject({ lastSequence: 1, acceptedEventIds: ['partial-event-1'] });
    expect((await currentRecord(fixture.repositories.runs.read(RUN_ID))).payload.lastSequence)
      .toBe(0);
    await expect(fixture.registry.ingest(second)).rejects.toThrow('partial event transaction');
    expect((await currentRecord(fixture.repositories.runs.read(RUN_ID))).payload.lastSequence)
      .toBe(0);

    failAfterSessionWrite = false;
    await expect(fixture.registry.ingest(second)).resolves.toMatchObject({
      kind: 'accepted',
      envelopes: [{ eventId: 'partial-event-2', sequence: 2 }],
    });
    expect(fixture.registry.getRun(RUN_ID)?.lastSequence).toBe(2);
  });

  it('proactively completes a final partial terminal and runs its lifecycle hooks', async () => {
    let failuresRemaining = 0;
    const fixture = await startedFixture(undefined, {
      crashInjector: point => {
        if (failuresRemaining > 0 && point === 'after-step-effect:step-0') {
          failuresRemaining -= 1;
          throw new Error('injected recoverable terminal boundary');
        }
      },
    });
    await startDefaultRun(fixture);
    fixture.backend.emit(RUN_ID, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: INTERACTION_ID,
        runId: RUN_ID,
        kind: 'approval',
        presentationRef: 'approval-partial-terminal',
        responseIds: ['allow', 'deny'],
      },
    });
    await settle(fixture.registry);
    const transitionId = `st-${'1'.repeat(32)}`;
    await fixture.registry.beginSettingsTransition({
      transitionId,
      backendId: fixture.backend.descriptor.backendId,
      settingsFingerprint: '1'.repeat(64),
    });
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const terminal = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'terminal', terminal: 'failed', reason: 'provider-failure' },
      { deliveryId: 'final-partial-terminal' },
    );

    failuresRemaining = 2;
    await expect(fixture.registry.ingest(terminal))
      .rejects.toThrow('recoverable terminal boundary');
    await fixture.registry.waitForIdle();

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'failed',
      reason: 'provider-failure',
    });
    expect(fixture.backend.cancelledInteractions).toEqual([INTERACTION_ID]);
    expect(fixture.registry.getInteraction(INTERACTION_ID)?.status).toBe('cancelled');
    expect((await currentRecord(
      fixture.repositories.settingsTransitions.read(transitionId),
    )).payload.status).toBe('quiescent');
  });

  it('proactively schedules recovery for a final partial connection loss', async () => {
    let failuresRemaining = 0;
    const fixture = await startedFixture(undefined, {
      crashInjector: point => {
        if (failuresRemaining > 0 && point === 'after-step-effect:step-0') {
          failuresRemaining -= 1;
          throw new Error('injected recoverable disconnect boundary');
        }
      },
    });
    await startDefaultRun(fixture);
    fixture.backend.nativeStatusRecovery.setEvidence(RUN_ID, { kind: 'stopped-safe' });
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const disconnect = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'connection-lost' },
      { deliveryId: 'final-partial-disconnect' },
    );

    failuresRemaining = 2;
    await expect(fixture.registry.ingest(disconnect))
      .rejects.toThrow('recoverable disconnect boundary');
    await fixture.registry.waitForIdle();

    expect(fixture.backend.nativeStatusRecovery.queries).toHaveLength(1);
    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'interrupted',
      reason: 'recovery-exhausted-safe',
    });
  });

  it('fails every session mutation closed while a partial event cannot converge', async () => {
    let failRecovery = false;
    const fixture = await startedFixture(undefined, {
      crashInjector: point => {
        if (failRecovery && point === 'after-step-effect:step-0') {
          throw new Error('persistent partial event boundary');
        }
      },
    });
    await startDefaultRun(fixture);
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const delivery = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'thinking-activity' },
      { deliveryId: 'persistently-partial-event' },
    );

    failRecovery = true;
    await expect(fixture.registry.ingest(delivery))
      .rejects.toThrow('persistent partial event boundary');
    await expect(fixture.registry.cancelRun(RUN_ID))
      .rejects.toThrow('persistent partial event boundary');
    await expect(fixture.registry.shutdown(`sd-${'2'.repeat(32)}`))
      .rejects.toThrow('persistent partial event boundary');

    expect(fixture.registry.getRun(RUN_ID)).toMatchObject({
      cancellationRequested: false,
      lastSequence: 0,
    });
    expect(fixture.backend.disposeCount).toBe(0);
  });

  it('does not treat thinking, tools, or progress as a required result', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture, 'required');

    fixture.backend.emit(RUN_ID, { kind: 'thinking-activity' });
    fixture.backend.emit(RUN_ID, { kind: 'tool-activity', toolCallId: 'tool-1' });
    fixture.backend.emit(RUN_ID, { kind: 'progress', progressId: 'progress-1' });
    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'failed',
      reason: 'missing-required-result',
    });
  });

  it('classifies an omitted terminal through recovery instead of stream completion', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.nativeStatusRecovery.setEvidence(RUN_ID, {
      kind: 'unknown',
      effectsPossible: true,
    });

    fixture.backend.closeRunStream(RUN_ID);
    await fixture.registry.waitForRunStream(RUN_ID);

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'indeterminate',
      reason: 'effects-unknown',
    });
    expect(fixture.backend.nativeStatusRecovery.queries).toHaveLength(1);
  });

  it('rotates the live incarnation only after recovery evidence', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    const nextInstance = sessionInstanceId(`si-${'a'.repeat(32)}`);
    fixture.backend.nativeStatusRecovery.setEvidence(RUN_ID, {
      kind: 'running',
      sessionInstanceId: nextInstance,
    });

    fixture.backend.emit(RUN_ID, { kind: 'connection-lost' }, {
      deliveryId: 'disconnect-1',
      destination: 'session',
    });
    fixture.backend.reconnectSession(SESSION_ID, nextInstance);
    await settle(fixture.registry, 12);

    expect(fixture.registry.getRun(RUN_ID)?.state).toBe('running');
    expect(fixture.registry.getSession(SESSION_ID)).toMatchObject({
      status: 'active',
      sessionInstanceId: nextInstance,
    });
  });

  it('persists native run identity, fences mismatches, and supplies both native refs to recovery', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.emit(RUN_ID, { kind: 'run-started' }, {
      deliveryId: 'native-turn-started',
      scope: { kind: 'run', runId: RUN_ID, turnId: 'native-turn-1' },
    });
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)?.nativeRunRef).toBe('native-turn-1');
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const mismatched = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID, turnId: 'native-turn-2' },
      { kind: 'thinking-activity' },
      { deliveryId: 'mismatched-native-turn' },
    );
    await expect(fixture.registry.ingest(mismatched)).resolves.toEqual({
      kind: 'ignored-invalid-scope',
    });
    expect(fixture.registry.getRun(RUN_ID)?.nativeRunRef).toBe('native-turn-1');

    fixture.backend.nativeStatusRecovery.setEvidence(RUN_ID, {
      kind: 'running',
      sessionInstanceId: nativeSession.sessionInstanceId,
    });
    fixture.backend.emit(RUN_ID, { kind: 'connection-lost' }, {
      deliveryId: 'native-turn-disconnected',
      scope: { kind: 'run', runId: RUN_ID, turnId: 'native-turn-1' },
    });
    await settle(fixture.registry, 12);

    expect(fixture.backend.nativeStatusRecovery.queries).toEqual([
      expect.objectContaining({
        nativeSessionRef: `fake-session-${SESSION_ID}`,
        nativeRunRef: 'native-turn-1',
      }),
    ]);
  });

  it('reconciles a causal gap through the snapshot port without applying across it', async () => {
    const fixture = await startedFixture(undefined, { recovery: 'snapshot' });
    await startDefaultRun(fixture);
    fixture.backend.snapshotRecovery.setEvidence(RUN_ID, { kind: 'stopped-safe' });
    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    }, {
      deliveryId: 'causal-terminal-2',
      destination: 'session',
      causal: { streamId: 'native-run-1', sequence: 2 },
    });
    await settle(fixture.registry);

    await fixture.registry.flushGaps(SESSION_ID);
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'interrupted',
      reason: 'recovery-exhausted-safe',
    });
    expect(fixture.backend.snapshotRecovery.queries).toHaveLength(1);
  });

  it('discards both occupants of a causal conflict before waiting-interaction recovery rebases', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.nativeStatusRecovery.setEvidence(RUN_ID, {
      kind: 'waiting-interaction',
      interactionId: INTERACTION_ID,
    });
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const firstOccupant = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'terminal', terminal: 'failed', reason: 'provider-failure' },
      {
        deliveryId: 'conflict-terminal-a',
        causal: { streamId: 'conflicted-native-stream', sequence: 2 },
      },
    );
    const secondOccupant = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'thinking-activity' },
      {
        deliveryId: 'conflict-thinking-b',
        causal: { streamId: 'conflicted-native-stream', sequence: 2 },
      },
    );

    await expect(fixture.registry.ingest(firstOccupant)).resolves.toEqual({ kind: 'buffered' });
    await expect(fixture.registry.ingest(secondOccupant)).resolves.toMatchObject({
      kind: 'causal-conflict',
    });
    await settle(fixture.registry);
    const predecessor = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'thinking-activity' },
      {
        deliveryId: 'conflict-predecessor',
        causal: { streamId: 'conflicted-native-stream', sequence: 1 },
      },
    );
    await expect(fixture.registry.ingest(predecessor)).resolves.toMatchObject({
      kind: 'accepted',
      envelopes: [{ eventId: 'conflict-predecessor', sequence: 1 }],
    });

    expect(fixture.registry.getRun(RUN_ID)).toMatchObject({
      state: 'running',
      lastSequence: 1,
    });
    expect(fixture.registry.getRun(RUN_ID)?.terminal).toBeUndefined();
  });

  it('turns rejected cancellation with unknown effects into indeterminate', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.cancellationMode = 'reject';
    fixture.backend.nativeStatusRecovery.setEvidence(RUN_ID, {
      kind: 'unknown',
      effectsPossible: true,
    });

    await fixture.registry.cancelRun(RUN_ID);
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'indeterminate',
      reason: 'cancellation-unknown',
    });
  });

  it('keeps one cancellation terminal when acknowledgement races explicit completion', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);

    const cancellation = fixture.registry.cancelRun(RUN_ID);
    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'cancelled',
      reason: 'cancellation-confirmed',
    }, { deliveryId: 'cancel-terminal-race', destination: 'session' });
    await cancellation;
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'cancelled',
      reason: 'cancellation-confirmed',
    });
    expect(fixture.registry.getRun(RUN_ID)?.lastSequence).toBe(1);
  });

  it('distinguishes side-effect-free dispatch rejection from lost acknowledgement', async () => {
    const fixture = await startedFixture();
    await fixture.registry.createSession(sessionCommand());

    fixture.backend.dispatchMode = 'reject-side-effect-free';
    await fixture.registry.startRun(SESSION_ID, request(RUN_ID));
    fixture.backend.dispatchMode = 'lose-acknowledgement';
    await fixture.registry.startRun(SESSION_ID, request(RUN_ID_2));

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'invalidated',
      reason: 'pre-dispatch-rejected',
    });
    expect(fixture.registry.getRun(RUN_ID_2)?.terminal).toMatchObject({
      kind: 'indeterminate',
      reason: 'dispatch-unknown',
    });
    expect(fixture.backend.getRun(RUN_ID)).toBeNull();
    expect(fixture.backend.getRun(RUN_ID_2)).not.toBeNull();
    expect(fixture.backend.dispatchAttempts.get(RUN_ID_2)).toBe(1);
  });

  it('never relabels an accepted running attempt as invalidated', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.emit(RUN_ID, { kind: 'run-started' });
    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'invalidated',
      reason: 'side-effect-free-rejection',
      sideEffectFree: true,
    });
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)).toMatchObject({ state: 'running' });
    expect(fixture.registry.getRun(RUN_ID)?.terminal).toBeUndefined();
  });

  it('rejects contradictory terminal kind and reason from a backend', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'provider-failure',
    }, { deliveryId: 'contradictory-terminal' });
    await settle(fixture.registry);

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toBeUndefined();
    expect(fixture.registry.getRun(RUN_ID)?.lastSequence).toBe(0);
  });

  it('keeps interactions lifecycle-owned and closes them atomically with the run', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.emit(RUN_ID, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: INTERACTION_ID,
        runId: RUN_ID,
        kind: 'approval',
        presentationRef: 'approval-1',
        responseIds: ['allow', 'deny'],
      },
    });
    await settle(fixture.registry);

    const lease = fixture.registry.acquireLease(
      lifecycleLeaseId(`lease-${'6'.repeat(32)}`),
      SESSION_ID,
      'projection',
    );
    expect(fixture.registry.getInteraction(INTERACTION_ID)?.status).toBe('open');
    expect(fixture.registry.canDisposeSession(SESSION_ID)).toBe(false);
    lease.release();

    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'failed',
      reason: 'provider-failure',
    });
    await settle(fixture.registry);

    expect(fixture.registry.getInteraction(INTERACTION_ID)?.status).toBe('cancelled');
    await expect(fixture.registry.resolveInteraction({
      interactionId: INTERACTION_ID,
      responseId: 'allow',
      resolvedAt: 50,
    })).rejects.toThrow('after its run is terminal');
  });

  it('recovers an interaction resolution through an idempotent resolving intent', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    fixture.backend.emit(RUN_ID, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: INTERACTION_ID,
        runId: RUN_ID,
        kind: 'question',
        presentationRef: 'question-1',
        responseIds: ['yes', 'no'],
      },
    });
    await settle(fixture.registry);
    fixture.backend.interactionResolutionError = new Error('transient resolution failure');

    await expect(fixture.registry.resolveInteraction({
      interactionId: INTERACTION_ID,
      responseId: 'yes',
      resolvedAt: 60,
    })).rejects.toThrow('transient resolution failure');
    expect(fixture.registry.getInteraction(INTERACTION_ID)).toMatchObject({
      status: 'resolving',
      selectedResponseId: 'yes',
    });

    fixture.backend.interactionResolutionError = undefined;
    await fixture.registry.resolveInteraction({
      interactionId: INTERACTION_ID,
      responseId: 'yes',
      resolvedAt: 61,
    });
    expect(fixture.registry.getInteraction(INTERACTION_ID)?.status).toBe('resolved');
    expect(fixture.backend.resolutions).toHaveLength(2);
  });

  it('replays a persisted resolving interaction on a fresh registry', async () => {
    const storage = new TestDurableStorage();
    const first = await startedFixture(storage, { transactionOffset: 0 });
    await startDefaultRun(first);
    first.backend.emit(RUN_ID, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: INTERACTION_ID,
        runId: RUN_ID,
        kind: 'question',
        presentationRef: 'question-restart',
        responseIds: ['yes', 'no'],
      },
    });
    await settle(first.registry);
    first.backend.interactionResolutionError = new Error('crash boundary');
    await expect(first.registry.resolveInteraction({
      interactionId: INTERACTION_ID,
      responseId: 'yes',
      resolvedAt: 60,
    })).rejects.toThrow('crash boundary');

    const restored = createFixture(storage, { transactionOffset: 1_000, instanceOffset: 10 });
    restored.backend.nativeStatusRecovery.setEvidence(RUN_ID, { kind: 'running', sessionInstanceId: sessionInstanceId(`si-${'b'.repeat(32)}`) });
    await restored.registry.start();

    expect(restored.registry.getInteraction(INTERACTION_ID)?.status).toBe('resolved');
    expect(restored.backend.resolutions).toEqual([
      expect.objectContaining({ interactionId: INTERACTION_ID, responseId: 'yes' }),
    ]);
  });

  it('replays native interaction cancellation before declaring it cancelled', async () => {
    const storage = new TestDurableStorage();
    const first = await startedFixture(storage, { transactionOffset: 0 });
    await startDefaultRun(first);
    first.backend.emit(RUN_ID, {
      kind: 'interaction-opened',
      interaction: {
        interactionId: INTERACTION_ID,
        runId: RUN_ID,
        kind: 'approval',
        presentationRef: 'approval-restart',
        responseIds: ['allow', 'deny'],
      },
    });
    await settle(first.registry);
    first.backend.interactionCancellationError = new Error('native cancel unavailable');
    first.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'failed',
      reason: 'provider-failure',
    });
    await settle(first.registry);
    expect(first.registry.getInteraction(INTERACTION_ID)?.status).toBe('cancelling');

    const restored = createFixture(storage, { transactionOffset: 1_000, instanceOffset: 10 });
    await restored.registry.start();

    expect(restored.backend.cancelledInteractions).toEqual([INTERACTION_ID]);
    expect(restored.registry.getInteraction(INTERACTION_ID)?.status).toBe('cancelled');
  });

  it('appends reconciliation without rewriting the indeterminate terminal', async () => {
    const fixture = await startedFixture();
    await fixture.registry.createSession(sessionCommand());
    fixture.backend.dispatchMode = 'lose-acknowledgement';
    await fixture.registry.startRun(SESSION_ID, request(RUN_ID));
    const terminal = fixture.registry.getRun(RUN_ID)?.terminal;
    const hiddenAttempt = fixture.backend.getRun(RUN_ID);
    expect(hiddenAttempt).not.toBeNull();
    expect(fixture.backend.dispatchAttempts.get(RUN_ID)).toBe(1);
    hiddenAttempt?.emit({ kind: 'result', result: RESULT }, {
      deliveryId: 'late-hidden-result',
      destination: 'session',
    });
    await settle(fixture.registry);
    expect(fixture.registry.getRun(RUN_ID)?.terminal).toEqual(terminal);
    expect(fixture.backend.dispatchAttempts.get(RUN_ID)).toBe(1);

    await fixture.registry.appendReconciliation({
      reconciliationId: `rec-${'7'.repeat(32)}`,
      runId: RUN_ID,
      originalTerminal: 'indeterminate',
      observedOutcome: 'succeeded',
      observedResult: RESULT,
      evidence: { kind: 'native-history', evidenceRef: 'history-1' },
      recordedAt: 70,
    });

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toEqual(terminal);
    await expect(fixture.repositories.reconciliations.read(`rec-${'7'.repeat(32)}`))
      .resolves.toMatchObject({ kind: 'current', record: { revision: 1 } });
  });

  it('fences a backend generation until accepted work is terminal and settings are applied', async () => {
    const fixture = await startedFixture();
    await startDefaultRun(fixture);
    const transitionId = `st-${'8'.repeat(32)}`;

    await fixture.registry.beginSettingsTransition({
      transitionId,
      backendId: fixture.backend.descriptor.backendId,
      settingsFingerprint: '9'.repeat(64),
    });
    await expect(fixture.registry.startRun(SESSION_ID, request(RUN_ID_2)))
      .rejects.toThrow('draining');
    expect((await currentRecord(
      fixture.repositories.settingsTransitions.read(transitionId),
    )).payload.status).toBe('draining');

    fixture.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await settle(fixture.registry);
    await fixture.registry.markSettingsTransitionApplying(transitionId);
    await fixture.registry.completeSettingsTransition(transitionId);

    expect(fixture.registry.getBackendGeneration(fixture.backend.descriptor.backendId)).toBe(2);
    expect((await currentRecord(
      fixture.repositories.settingsTransitions.read(transitionId),
    )).payload.status).toBe('completed');
    expect(fixture.registry.getSession(SESSION_ID)).toBeNull();
  });

  it('fails closed when startup finds settings in an unknown applying boundary', async () => {
    const fixture = createFixture();
    const transitionId = `st-${'c'.repeat(32)}`;
    await fixture.repositories.settingsTransitions.create(transitionId, {
      transitionId,
      backendId: fixture.backend.descriptor.backendId,
      fromGeneration: 1,
      toGeneration: 2,
      status: 'applying',
      settingsFingerprint: 'd'.repeat(64),
      createdAt: 1,
      updatedAt: 1,
    });

    await fixture.registry.start();

    expect((await currentRecord(
      fixture.repositories.settingsTransitions.read(transitionId),
    )).payload.status).toBe('restart-required');
    await expect(fixture.registry.createSession(sessionCommand()))
      .rejects.toThrow('not accepting sessions');
  });

  it('keeps a settings transition admitted until its durable write completes', async () => {
    const storage = new GatedDurableStorage(SETTINGS_TRANSITIONS_PATH);
    const fixture = await startedFixture(storage);
    const transitionId = `st-${'e'.repeat(32)}`;
    const checkpointId = `sd-${'f'.repeat(32)}`;

    const transition = fixture.registry.beginSettingsTransition({
      transitionId,
      backendId: fixture.backend.descriptor.backendId,
      settingsFingerprint: 'a'.repeat(64),
    });
    await storage.waitUntilBlocked();
    const shutdown = fixture.registry.shutdown(checkpointId);
    await Promise.resolve();
    expect(await fixture.repositories.shutdownCheckpoints.read(checkpointId))
      .toEqual({ kind: 'absent' });

    storage.release();
    await transition;
    await shutdown;
    expect((await currentRecord(
      fixture.repositories.shutdownCheckpoints.read(checkpointId),
    )).payload.status).toBe('completed');
  });

  it('closes admission synchronously and classifies unconfirmed work during bounded shutdown', async () => {
    const scheduler = new ImmediateScheduler();
    const fixture = await startedFixture(undefined, { scheduler });
    await startDefaultRun(fixture);
    fixture.backend.cancellationMode = 'silent';
    const checkpointId = `sd-${'a'.repeat(32)}`;

    const shutdown = fixture.registry.shutdown(checkpointId);
    await expect(fixture.registry.createSession({
      ...sessionCommand(),
      executionSessionId: SESSION_ID_2,
    })).rejects.toThrow('not accepting new work');
    await shutdown;

    expect(fixture.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'indeterminate',
      reason: 'shutdown-unknown',
    });
    expect(fixture.backend.disposeCount).toBe(1);
    expect((await currentRecord(
      fixture.repositories.shutdownCheckpoints.read(checkpointId),
    )).payload).toMatchObject({
      status: 'completed',
      unresolvedRunIds: [RUN_ID],
    });
  });

  it('persists a shutdown checkpoint before a hung recovery port can settle', async () => {
    const scheduler = new ManualScheduler();
    const fixture = await startedFixture(undefined, { scheduler });
    await startDefaultRun(fixture);
    fixture.backend.nativeStatusRecovery.setNeverResolve(RUN_ID);
    const nativeSession = fixture.backend.sessions.get(SESSION_ID);
    if (!nativeSession) {
      throw new Error('Expected a fake native session.');
    }
    const disconnect = fixture.backend.createDelivery(
      nativeSession,
      { kind: 'run', runId: RUN_ID },
      { kind: 'connection-lost' },
      { deliveryId: 'hung-recovery-disconnect' },
    );
    await fixture.registry.ingest(disconnect);
    await waitUntil(() => fixture.backend.nativeStatusRecovery.queries.length === 1);
    expect(fixture.backend.nativeStatusRecovery.queries).toHaveLength(1);

    const checkpointId = `sd-${'9'.repeat(32)}`;
    const shutdown = fixture.registry.shutdown(checkpointId);
    await flushPromises(12);
    expect((await currentRecord(
      fixture.repositories.shutdownCheckpoints.read(checkpointId),
    )).payload.status).toBe('started');

    for (let turn = 0; turn < 5; turn += 1) {
      scheduler.fireAll();
      await flushPromises(12);
    }
    await shutdown;
    expect((await currentRecord(
      fixture.repositories.shutdownCheckpoints.read(checkpointId),
    )).payload.status).toBe('completed');
  });

  it('restores completed results without dispatching the run again', async () => {
    const storage = new TestDurableStorage();
    const first = await startedFixture(storage, { transactionOffset: 0 });
    await startDefaultRun(first, 'required');
    first.backend.emit(RUN_ID, { kind: 'result', result: RESULT });
    first.backend.emit(RUN_ID, {
      kind: 'terminal',
      terminal: 'succeeded',
      reason: 'completed',
    });
    await settle(first.registry);

    const restored = createFixture(storage, { transactionOffset: 1_000, instanceOffset: 10 });
    await restored.registry.start();

    expect(restored.registry.getRun(RUN_ID)).toMatchObject({
      terminal: { kind: 'succeeded' },
      resultRef: RESULT,
    });
    expect(restored.backend.sessions.get(SESSION_ID)?.config.nativeSessionRef)
      .toBe(`fake-session-${SESSION_ID}`);
    expect(restored.backend.getRun(RUN_ID)).toBeNull();
  });

  it('reconciles an incomplete shutdown checkpoint before accepting restored work', async () => {
    const storage = new TestDurableStorage();
    const first = await startedFixture(storage, { transactionOffset: 0 });
    await startDefaultRun(first);
    const checkpointId = `sd-${'b'.repeat(32)}`;
    await first.repositories.shutdownCheckpoints.create(checkpointId, {
      checkpointId,
      status: 'started',
      sessionIds: [SESSION_ID],
      runIds: [RUN_ID],
      unresolvedRunIds: [RUN_ID],
      startedAt: 100,
    });

    const restored = createFixture(storage, {
      transactionOffset: 1_000,
      instanceOffset: 10,
    });
    restored.backend.nativeStatusRecovery.setEvidence(RUN_ID, { kind: 'stopped-safe' });
    await restored.registry.start();

    expect(restored.registry.getRun(RUN_ID)?.terminal).toMatchObject({
      kind: 'interrupted',
      reason: 'recovery-exhausted-safe',
    });
    expect((await currentRecord(
      restored.repositories.shutdownCheckpoints.read(checkpointId),
    )).payload).toMatchObject({ status: 'completed', unresolvedRunIds: [] });
    await expect(restored.registry.createSession({
      ...sessionCommand(),
      executionSessionId: SESSION_ID_2,
    })).resolves.toBe(SESSION_ID_2);
  });
});

async function startedFixture(
  storage?: DurableStorage,
  options: FixtureOptions = {},
) {
  const fixture = createFixture(storage, options);
  await fixture.registry.start();
  return fixture;
}

interface FixtureOptions {
  readonly transactionOffset?: number;
  readonly instanceOffset?: number;
  readonly recovery?: 'native' | 'snapshot';
  readonly scheduler?: ExecutionLifecycleScheduler;
  readonly crashInjector?: (point: TransactionCrashPoint) => void;
}

function createFixture(
  storage: DurableStorage = new TestDurableStorage(),
  options: FixtureOptions = {},
) {
  let clock = 1;
  let instanceOrdinal = options.instanceOffset ?? 1;
  let transactionOrdinal = options.transactionOffset ?? 0;
  const now = () => clock++;
  const repositories = new ExecutionControlRepositories(storage, now);
  const controlTransactions = new ExecutionControlTransactionCoordinator(
    storage,
    repositories,
    { now, crashInjector: options.crashInjector },
  );
  const backend = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => sessionInstanceId(
      `si-${(instanceOrdinal++).toString(16).padStart(32, '0')}`,
    ),
    now,
  });
  const registry = new ExecutionLifecycleRegistry({
    repositories,
    controlTransactions,
    nextTransactionId: () => `tx-${(++transactionOrdinal).toString(16).padStart(32, '0')}`,
    now,
    scheduler: options.scheduler ?? new PassiveScheduler(),
    shutdownGracePeriodMs: 10,
  });
  registry.registerBackend({
    backend,
    recovery: options.recovery === 'snapshot'
      ? backend.snapshotRecovery
      : backend.nativeStatusRecovery,
    interactions: backend,
  });
  return { storage, repositories, controlTransactions, backend, registry };
}

async function startDefaultRun(
  fixture: ReturnType<typeof createFixture>,
  resultExpectation: 'required' | 'optional' | 'none' = 'none',
): Promise<void> {
  await fixture.registry.createSession(sessionCommand());
  await fixture.registry.startRun(SESSION_ID, request(RUN_ID, resultExpectation));
}

function sessionCommand() {
  return {
    backendId: new DeterministicFakeBackend({
      sessionInstanceIdFactory: () => sessionInstanceId(`si-${'f'.repeat(32)}`),
    }).descriptor.backendId,
    executionSessionId: SESSION_ID,
    owner: OWNER,
  };
}

function request(
  id: RunId,
  resultExpectation: 'required' | 'optional' | 'none' = 'none',
) {
  return {
    runId: id,
    owner: OWNER,
    resultExpectation,
    requestRef: `request-${id}`,
  };
}

async function settle(registry: ExecutionLifecycleRegistry, turns = 6): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
  await registry.waitForIdle();
}

async function currentRecord<T>(read: Promise<{
  readonly kind: string;
  readonly record?: { readonly revision: number; readonly payload: T };
}>): Promise<{ readonly revision: number; readonly payload: T }> {
  const result = await read;
  if ((result.kind !== 'current' && result.kind !== 'migrated') || !result.record) {
    throw new Error(`Expected current record, received ${result.kind}.`);
  }
  return result.record;
}

class ImmediateScheduler implements ExecutionLifecycleScheduler {
  setTimeout(callback: () => void): unknown {
    const handle = { cancelled: false };
    void Promise.resolve().then(() => {
      if (!handle.cancelled) {
        callback();
      }
    });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }
}

class PassiveScheduler implements ExecutionLifecycleScheduler {
  private readonly callbacks = new Set<() => void>();

  setTimeout(callback: () => void): unknown {
    this.callbacks.add(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as () => void);
  }
}

class ManualScheduler implements ExecutionLifecycleScheduler {
  private readonly callbacks = new Set<() => void>();

  setTimeout(callback: () => void): unknown {
    this.callbacks.add(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as () => void);
  }

  fireAll(): void {
    const callbacks = [...this.callbacks];
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback();
    }
  }
}

class GatedDurableStorage implements DurableStorage {
  private readonly delegate = new TestDurableStorage();
  private readonly blocked = deferred<void>();
  private readonly released = deferred<void>();
  private didBlock = false;

  constructor(private readonly gatedPrefix: string) {}

  read(path: string): Promise<string | null> {
    return this.delegate.read(path);
  }

  writeAtomic(path: string, content: string): Promise<void> {
    return this.delegate.writeAtomic(path, content);
  }

  async compareAndSwap(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
  ): Promise<boolean> {
    if (!this.didBlock && path.startsWith(`${this.gatedPrefix}/`)) {
      this.didBlock = true;
      this.blocked.resolve();
      await this.released.promise;
    }
    return this.delegate.compareAndSwap(path, expectedContent, nextContent);
  }

  remove(path: string): Promise<void> {
    return this.delegate.remove(path);
  }

  list(prefix: string): Promise<string[]> {
    return this.delegate.list(prefix);
  }

  waitUntilBlocked(): Promise<void> {
    return this.blocked.promise;
  }

  release(): void {
    this.released.resolve();
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function flushPromises(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Condition did not become true.');
}
