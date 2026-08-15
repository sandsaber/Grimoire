/* eslint-disable jest/no-export -- Provider drivers import this shared contract suite. */
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionRun,
  ExecutionSessionConfig,
  ResultExpectation,
} from '@/core/execution/ExecutionContracts';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import {
  ExecutionLifecycleRegistry,
  type ExecutionLifecycleScheduler,
} from '@/core/execution/ExecutionLifecycleRegistry';

export interface ExecutionBackendConformanceOptions {
  readonly requestResolution?: 'pending' | 'ready';
  readonly termination?: 'confirmed' | 'unconfirmed';
}

export interface ExecutionBackendConformanceDriver {
  readonly backend: ExecutionBackend;
  readonly request: ExecutionRequest;
  readonly sessionConfig: ExecutionSessionConfig;
  completeEmpty(): void;
  completeSuccess(): void;
  fireAllTimers(): void;
  fireNextTimer(): void;
  releaseRequest(): void;
  signalOutputLimit(): void;
  startCount(): number;
  storedResultCount(): number;
  waitForDispatch(): Promise<void>;
}

export function defineExecutionBackendConformance(
  name: string,
  createDriver: (options?: ExecutionBackendConformanceOptions) => ExecutionBackendConformanceDriver,
): void {
  describe(`${name} execution backend conformance`, () => {
    it('cancels before dispatch without waiting for request resolution', async () => {
      const driver = createDriver({ requestResolution: 'pending' });
      const session = await driver.backend.createSession(driver.sessionConfig);
      const run = session.createRun(driver.request);
      const events = collectEvents(run);

      await expect(run.cancel()).resolves.toBeUndefined();
      driver.releaseRequest();
      await flushPromises();

      expect(driver.startCount()).toBe(0);
      expect(await events).toEqual([
        expect.objectContaining({
          event: {
            kind: 'terminal',
            terminal: 'cancelled',
            reason: 'cancellation-confirmed',
            sideEffectFree: true,
          },
        }),
      ]);
    });

    // eslint-disable-next-line jest/expect-expect -- expectTerminals owns the shared assertions.
    it('cancels an owned native run exactly once', async () => {
      const driver = createDriver();
      const session = await driver.backend.createSession(driver.sessionConfig);
      const run = session.createRun(driver.request);
      const events = collectEvents(run);
      await driver.waitForDispatch();

      await run.cancel();
      await run.cancel();

      expectTerminals(await events, 'cancelled', 'cancellation-confirmed');
    });

    it('classifies timeout and output-limit termination without storing a result', async () => {
      const timeoutDriver = createDriver();
      const timeoutSession = await timeoutDriver.backend.createSession(timeoutDriver.sessionConfig);
      const timeoutEvents = collectEvents(timeoutSession.createRun(timeoutDriver.request));
      await timeoutDriver.waitForDispatch();
      timeoutDriver.fireNextTimer();
      await flushPromises();
      expectTerminals(await timeoutEvents, 'failed', 'timeout');

      const outputDriver = createDriver();
      const outputSession = await outputDriver.backend.createSession(outputDriver.sessionConfig);
      const outputEvents = collectEvents(outputSession.createRun(outputDriver.request));
      await outputDriver.waitForDispatch();
      outputDriver.signalOutputLimit();
      await flushPromises();
      expectTerminals(await outputEvents, 'failed', 'output-limit');
      expect(outputDriver.storedResultCount()).toBe(0);
    });

    it('keeps unload ownership and ignores late completion after terminal', async () => {
      const driver = createDriver();
      const session = await driver.backend.createSession(driver.sessionConfig);
      const events = collectEvents(session.createRun(driver.request));
      await driver.waitForDispatch();

      await driver.backend.dispose();
      driver.completeSuccess();
      await flushPromises();

      expectTerminals(await events, 'cancelled', 'cancellation-confirmed');
      expect(driver.storedResultCount()).toBe(0);
    });

    // eslint-disable-next-line jest/expect-expect -- expectTerminals owns the shared assertions.
    it('fails when a required provider result is absent', async () => {
      const driver = createDriver();
      const session = await driver.backend.createSession(driver.sessionConfig);
      const events = collectEvents(session.createRun(driver.request));
      await driver.waitForDispatch();
      driver.completeEmpty();

      expectTerminals(await events, 'failed', 'missing-required-result');
    });

    it.each(['optional', 'none'] as const)(
      'allows an empty provider result when expectation is %s',
      async (resultExpectation: ResultExpectation) => {
        const driver = createDriver();
        const session = await driver.backend.createSession(driver.sessionConfig);
        const events = collectEvents(session.createRun({
          ...driver.request,
          resultExpectation,
        }));
        await driver.waitForDispatch();
        driver.completeEmpty();

        expectTerminals(await events, 'succeeded', 'completed');
        expect(driver.storedResultCount()).toBe(0);
      },
    );

    it('keeps one result and terminal under duplicate completion and late cancellation', async () => {
      const driver = createDriver();
      const session = await driver.backend.createSession(driver.sessionConfig);
      const run = session.createRun(driver.request);
      const events = collectEvents(run);
      await driver.waitForDispatch();

      driver.completeSuccess();
      driver.completeSuccess();
      const captured = await events;
      await run.cancel();

      expect(captured.filter(event => event.event.kind === 'result')).toHaveLength(1);
      expectTerminals(captured, 'succeeded', 'completed');
      expect(driver.storedResultCount()).toBe(1);
    });

    // eslint-disable-next-line jest/expect-expect -- expectTerminals owns the shared assertions.
    it('reports indeterminate when process-tree termination cannot be proven', async () => {
      const driver = createDriver({ termination: 'unconfirmed' });
      const session = await driver.backend.createSession(driver.sessionConfig);
      const run = session.createRun(driver.request);
      const events = collectEvents(run);
      await driver.waitForDispatch();

      const cancellation = run.cancel();
      await flushPromises();
      driver.fireAllTimers();
      await flushPromises();
      driver.fireAllTimers();
      await cancellation;

      expectTerminals(await events, 'indeterminate', 'cancellation-unknown');
    });

    it('persists one provider envelope across duplicate ingress and fences stale delivery', async () => {
      const driver = createDriver();
      const registry = await createRegistry(driver);
      await registry.createSession({
        backendId: driver.backend.descriptor.backendId,
        executionSessionId: driver.sessionConfig.executionSessionId,
        owner: driver.sessionConfig.owner,
      });
      await registry.startRun(driver.sessionConfig.executionSessionId, driver.request);
      await driver.waitForDispatch();
      await waitForRegistryRun(registry, driver.request.runId, state => state === 'running');

      const session = registry.getSession(driver.sessionConfig.executionSessionId);
      if (!session) throw new Error('Expected a live conformance session.');
      const baseDelivery: ProviderExecutionEvent = {
        backendId: driver.backend.descriptor.backendId,
        backendGeneration: driver.sessionConfig.backendGeneration,
        executionSessionId: driver.sessionConfig.executionSessionId,
        sessionInstanceId: sessionInstanceId(session.sessionInstanceId),
        deliveryId: 'conformance-stale-delivery',
        occurredAt: 2,
        scope: { kind: 'run', runId: driver.request.runId },
        event: { kind: 'thinking-activity' },
      };

      await expect(registry.ingest({
        ...baseDelivery,
        backendGeneration: driver.sessionConfig.backendGeneration + 1,
      })).resolves.toEqual({ kind: 'stale-generation' });
      await expect(registry.ingest({
        ...baseDelivery,
        deliveryId: 'conformance-stale-instance',
        sessionInstanceId: sessionInstanceId(`si-${'f'.repeat(32)}`),
      })).resolves.toEqual({ kind: 'stale-instance' });
      await expect(registry.ingest({
        ...baseDelivery,
        deliveryId: 'conformance-wrong-session',
        executionSessionId: executionSessionId(`es-${'e'.repeat(32)}`),
      })).resolves.toEqual({ kind: 'unknown-session' });

      driver.completeSuccess();
      await waitForRegistryRun(registry, driver.request.runId, state => state === 'succeeded');
      expect(registry.getRun(driver.request.runId)).toMatchObject({
        state: 'succeeded',
        lastSequence: 3,
        resultRef: expect.objectContaining({ storage: 'projection' }),
      });
      const terminalRun = registry.getRun(driver.request.runId);
      await expect(registry.ingest({
        ...baseDelivery,
        deliveryId: 'conformance-post-terminal',
        scope: {
          kind: 'run',
          runId: driver.request.runId,
          ...(terminalRun?.nativeRunRef
            ? { nativeRunRef: terminalRun.nativeRunRef }
            : {}),
        },
      })).resolves.toEqual({ kind: 'ignored-post-terminal' });
      expect(registry.getRun(driver.request.runId)?.lastSequence).toBe(3);
      await driver.backend.dispose();
    });

    it('fences dispatch while a provider settings generation changes', async () => {
      const driver = createDriver();
      const registry = await createRegistry(driver);
      await registry.createSession({
        backendId: driver.backend.descriptor.backendId,
        executionSessionId: driver.sessionConfig.executionSessionId,
        owner: driver.sessionConfig.owner,
      });
      const transitionId = `st-${'d'.repeat(32)}`;

      await registry.beginSettingsTransition({
        transitionId,
        backendId: driver.backend.descriptor.backendId,
        settingsFingerprint: 'c'.repeat(64),
      });
      await expect(registry.startRun(
        driver.sessionConfig.executionSessionId,
        driver.request,
      )).rejects.toThrow('draining');
      expect(driver.startCount()).toBe(0);

      await registry.markSettingsTransitionApplying(transitionId);
      await registry.completeSettingsTransition(transitionId);
      expect(registry.getBackendGeneration(driver.backend.descriptor.backendId)).toBe(2);
      expect(registry.getSession(driver.sessionConfig.executionSessionId)).toBeNull();
      await driver.backend.dispose();
    });
  });
}
/* eslint-enable jest/no-export */

function expectTerminals(
  events: readonly ProviderExecutionEvent[],
  terminal: string,
  reason: string,
): void {
  const terminals = events.filter(event => event.event.kind === 'terminal');
  expect(terminals).toEqual([
    expect.objectContaining({
      event: expect.objectContaining({ kind: 'terminal', terminal, reason }),
    }),
  ]);
}

async function collectEvents(run: ExecutionRun): Promise<ProviderExecutionEvent[]> {
  const events: ProviderExecutionEvent[] = [];
  for await (const event of run.events) {
    events.push(event);
  }
  return events;
}

async function flushPromises(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

async function createRegistry(
  driver: ExecutionBackendConformanceDriver,
): Promise<ExecutionLifecycleRegistry> {
  let clock = 10;
  let transactionOrdinal = 0;
  const now = () => ++clock;
  const storage = new TestDurableStorage();
  const repositories = new ExecutionControlRepositories(storage, now);
  const controlTransactions = new ExecutionControlTransactionCoordinator(
    storage,
    repositories,
    { now },
  );
  const registry = new ExecutionLifecycleRegistry({
    repositories,
    controlTransactions,
    nextTransactionId: () => (
      `tx-${(++transactionOrdinal).toString(16).padStart(32, '0')}`
    ),
    now,
    scheduler: new PassiveRegistryScheduler(),
  });
  registry.registerBackend({ backend: driver.backend });
  await registry.start();
  return registry;
}

async function waitForRegistryRun(
  registry: ExecutionLifecycleRegistry,
  targetRunId: ExecutionRequest['runId'],
  predicate: (state: string | undefined) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await flushPromises(2);
    await registry.waitForIdle();
    if (predicate(registry.getRun(targetRunId)?.state)) {
      return;
    }
  }
  throw new Error(`Timed out waiting for registry run "${targetRunId}".`);
}

class PassiveRegistryScheduler implements ExecutionLifecycleScheduler {
  private readonly tasks = new Set<() => void>();

  setTimeout(callback: () => void): unknown {
    this.tasks.add(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as () => void);
  }
}
