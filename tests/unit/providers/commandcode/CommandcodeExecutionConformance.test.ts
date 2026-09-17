import { defineExecutionBackendConformance, type ExecutionBackendConformanceDriver,
  type ExecutionBackendConformanceOptions } from '@test/helpers/execution/ExecutionBackendConformance';

import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import { CommandcodeExecutionBackend } from '@/providers/commandcode/execution/CommandcodeExecutionBackend';
import type { CommandcodeInvocation, CommandcodeProcessHandle } from '@/providers/commandcode/runtime/CommandcodeProcess';
import { CommandcodeOutputLimitError } from '@/providers/commandcode/runtime/CommandcodeStream';

defineExecutionBackendConformance('Command Code', createDriver);

function createDriver(options: ExecutionBackendConformanceOptions = {}): ExecutionBackendConformanceDriver {
  const invocation: CommandcodeInvocation = { command: '/provider/command-code', cwd: '/vault',
    environment: {}, prompt: 'Prompt', permissionMode: 'normal' };
  let release!: (value: CommandcodeInvocation) => void;
  const pendingRequest = new Promise<CommandcodeInvocation>(resolve => { release = resolve; });
  let complete!: (value: Awaited<CommandcodeProcessHandle['completed']>) => void;
  let reject!: (error: Error) => void;
  const completed = new Promise<Awaited<CommandcodeProcessHandle['completed']>>((yes, no) => { complete = yes; reject = no; });
  let starts = 0;
  let results = 0;
  const timers = new Set<() => void>();
  const backend = new CommandcodeExecutionBackend({
    resolve: async () => options.requestResolution === 'pending' ? pendingRequest : { ...invocation },
    runner: { start: () => {
      starts++;
      return { started: Promise.resolve(), completed,
        confirmTerminated: async () => options.termination !== 'unconfirmed',
        terminate: async () => options.termination ?? 'confirmed' };
    } },
    sessionInstanceId: () => sessionInstanceId(`si-${'1'.repeat(32)}`),
    delay: async () => undefined,
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: handle => { timers.delete(handle as () => void); },
  });
  // A print result is a projection reference; count the references actually accepted by the backend.
  const createSession = backend.createSession.bind(backend);
  backend.createSession = async config => {
    const session = await createSession(config);
    session.subscribe(event => { if (event.event.kind === 'result') results++; });
    return session;
  };
  const fire = () => { const next = timers.values().next().value; if (next) { timers.delete(next); next(); } };
  return {
    backend,
    request: { runId: runId(`run-${'2'.repeat(32)}`), owner: { kind: 'conversation', ownerId: 'conformance-owner' },
      requestRef: 'opaque-request', resultExpectation: 'required' },
    sessionConfig: { executionSessionId: executionSessionId(`es-${'3'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'conformance-owner' }, backendGeneration: 1 },
    expectedNativeRunRef: () => null,
    completeEmpty: () => complete({ code: 0, result: { subtype: 'success', finalText: '' } }),
    completeSuccess: () => complete({ code: 0, result: { subtype: 'success', finalText: 'Result' } }),
    fireNextTimer: fire,
    fireAllTimers: () => { for (const callback of [...timers]) { timers.delete(callback); callback(); } },
    releaseRequest: () => release(invocation),
    signalOutputLimit: () => reject(new CommandcodeOutputLimitError()),
    startCount: () => starts,
    storedResultCount: () => results,
    waitForDispatch: async () => {
      for (let i = 0; i < 50 && !starts; i++) await Promise.resolve();
      if (!starts) throw new Error('Command Code was not dispatched.');
    },
  };
}
