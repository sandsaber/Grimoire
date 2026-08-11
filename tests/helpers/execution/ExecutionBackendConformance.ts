/* eslint-disable jest/no-export -- Provider drivers import this shared contract suite. */
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionRun,
  ExecutionSessionConfig,
} from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';

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
