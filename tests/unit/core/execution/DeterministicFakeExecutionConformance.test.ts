import {
  defineExecutionBackendConformance,
  type ExecutionBackendConformanceDriver,
  type ExecutionBackendConformanceOptions,
} from '@test/helpers/execution/ExecutionBackendConformance';

import {
  executionSessionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';

defineExecutionBackendConformance('deterministic fake', createDriver);

function createDriver(
  options: ExecutionBackendConformanceOptions = {},
): ExecutionBackendConformanceDriver {
  const dispatchGate = deferred<void>();
  if (options.requestResolution !== 'pending') {
    dispatchGate.resolve();
  }
  const targetRunId = runId(`run-${'8'.repeat(32)}`);
  const backend = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'9'.repeat(32)}`),
    now: () => 1,
    automaticLifecycle: {
      dispatchGate: dispatchGate.promise,
      termination: options.termination ?? 'confirmed',
    },
  });

  return {
    backend,
    request: {
      runId: targetRunId,
      owner: { kind: 'conversation', ownerId: 'fake-conformance' },
      resultExpectation: 'required',
      requestRef: 'opaque-request',
    },
    sessionConfig: {
      executionSessionId: executionSessionId(`es-${'a'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'fake-conformance' },
      backendGeneration: 1,
    },
    completeEmpty: () => backend.completeRun(targetRunId, false),
    completeSuccess: () => backend.completeRun(targetRunId, true),
    fireAllTimers: () => undefined,
    fireNextTimer: () => backend.signalAutomaticTimeout(targetRunId),
    releaseRequest: () => dispatchGate.resolve(),
    signalOutputLimit: () => backend.signalAutomaticOutputLimit(targetRunId),
    startCount: () => backend.dispatchAttempts.get(targetRunId) ?? 0,
    storedResultCount: () => backend.automaticResultCount,
    waitForDispatch: () => waitFor(
      () => backend.dispatchAttempts.get(targetRunId) === 1,
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for deterministic fake dispatch.');
}
