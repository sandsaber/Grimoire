import {
  defineExecutionBackendConformance,
  type ExecutionBackendConformanceDriver,
  type ExecutionBackendConformanceOptions,
} from '@test/helpers/execution/ExecutionBackendConformance';

import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  ManagedAcpExecutionInvocation,
  ManagedAcpExecutionScheduler,
} from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type {
  AcpPromptResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';
import { GrokExecutionBackend } from '@/providers/grok/execution/GrokExecutionBackend';

/**
 * Grok over the shared managed-ACP backend, against the same invariants every
 * flipped provider answers.
 *
 * The backend is shared, so this is not a second proof of it: it is the proof
 * that *this provider's* descriptor, ids and timeouts compose into one that
 * still keeps exactly one terminal, refuses a second run, and bounds what a
 * turn may answer with. Grok had no such suite while every other flipped
 * provider did.
 */
defineExecutionBackendConformance('Grok managed ACP', createDriver);

function createDriver(
  options: ExecutionBackendConformanceOptions = {},
): ExecutionBackendConformanceDriver {
  const scheduler = new ConformanceScheduler();
  const client = new ConformanceClient();
  const resolution = deferred<ManagedAcpExecutionInvocation>();
  let stored = 0;
  if (options.requestResolution !== 'pending') resolution.resolve(invocation());
  const backend = new GrokExecutionBackend({
    clientFactory: {
      create: async (input: ManagedAcpClientFactoryInput) => {
        client.permissionHandler = input.requestPermission;
        return client;
      },
    },
    requestResolver: { resolve: () => resolution.promise },
    dynamicApplier: { apply: async () => undefined },
    interactionBridge: { prepare: async () => { throw new Error('No interaction.'); } },
    resultSink: {
      storeResult: async () => ({
        kind: 'committed',
        result: { resultId: `result-${++stored}`, storage: 'projection' },
      }),
    },
    reconciler: {
      reconcile: async () => options.termination === 'unconfirmed'
        ? { kind: 'unknown', effectsPossible: true }
        : { kind: 'stopped-safe' },
    },
    auxiliaryQueries: { execute: async () => '' },
    scheduler,
    sessionInstanceIdFactory: () => sessionInstanceId(`si-${'a'.repeat(32)}`),
    interactionIdFactory: () => interactionId(`ix-${'b'.repeat(32)}`),
    now: () => 1,
    controlTimeoutMs: 500,
    resultCommitTimeoutMs: 500,
    recoveryTimeoutMs: 500,
    runTimeoutMs: 5_000,
    maxResultBytes: 8,
  });
  return {
    backend,
    request: {
      runId: runId(`run-${'c'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'grok-conformance' },
      resultExpectation: 'required',
      requestRef: 'opaque-request',
    },
    sessionConfig: {
      executionSessionId: executionSessionId(`es-${'d'.repeat(32)}`),
      owner: { kind: 'conversation', ownerId: 'grok-conformance' },
      backendGeneration: 1,
      nativeSessionRef: 'native-session',
    },
    // The ACP user message id, supplied at dispatch and confirmed by the prompt
    // response; a mismatch between the two is what fences a stale native run.
    expectedNativeRunRef: () => 'message-1',
    completeEmpty: () => client.completePrompt({ stopReason: 'end_turn' }),
    completeSuccess: () => {
      client.emit(agentText('done'));
      client.completePrompt({ stopReason: 'end_turn', userMessageId: 'message-1' });
    },
    fireAllTimers: () => scheduler.fireAll(),
    fireNextTimer: () => scheduler.fireNext(),
    releaseRequest: () => resolution.resolve(invocation()),
    signalOutputLimit: () => client.emit(agentText('output exceeds bound')),
    startCount: () => client.promptRequests,
    storedResultCount: () => stored,
    waitForDispatch: () => waitFor(() => client.promptRequests === 1),
  };
}

class ConformanceClient implements ManagedAcpClient {
  promptRequests = 0;
  permissionHandler?: ManagedAcpClientFactoryInput['requestPermission'];
  private readonly notifications = new Set<(notification: AcpSessionNotification) => void>();
  private readonly losses = new Set<(error?: Error) => void>();
  private promptCompletion = deferred<AcpPromptResponse>();

  async initialize(): Promise<void> {}
  async newSession() { return { sessionId: 'native-session' }; }
  async loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    return { sessionId: request.sessionId };
  }
  prompt(): Promise<AcpPromptResponse> {
    this.promptRequests += 1;
    return this.promptCompletion.promise;
  }
  async setMode() { return {}; }
  async setModel() { return {}; }
  async setConfigOption() { return { configOptions: [] }; }
  cancel(): void {
    // What a real agent does with `session/cancel`: it ends the turn it was
    // asked about and answers the prompt saying so. A fake that swallowed the
    // notification modelled an agent that never replies, which is the case the
    // control timeout covers rather than the ordinary one.
    this.promptCompletion.resolve({ stopReason: 'cancelled' });
  }
  onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onConnectionLost(listener: (error?: Error) => void) {
    this.losses.add(listener);
    return () => this.losses.delete(listener);
  }
  async close(): Promise<'confirmed'> { return 'confirmed'; }
  emit(notification: AcpSessionNotification): void {
    for (const listener of this.notifications) listener(notification);
  }
  completePrompt(response: AcpPromptResponse): void { this.promptCompletion.resolve(response); }
}

function invocation(): ManagedAcpExecutionInvocation {
  return {
    startupRef: 'startup-ref',
    restartFingerprint: 'startup-v1',
    cwd: '/vault',
    prompt: [{ type: 'text', text: 'Execute bounded work' }],
    mcpServers: [],
    messageId: 'message-1',
  };
}

function agentText(text: string): AcpSessionNotification {
  return {
    sessionId: 'native-session',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId: 'assistant-1',
    },
  };
}

class ConformanceScheduler implements ManagedAcpExecutionScheduler {
  private readonly tasks = new Map<object, () => void>();
  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) this.tasks.delete(handle);
  }
  fireNext(): void {
    const task = this.tasks.entries().next().value;
    if (!task) return;
    this.tasks.delete(task[0]);
    task[1]();
  }
  fireAll(): void {
    for (const [handle, callback] of [...this.tasks]) {
      this.tasks.delete(handle);
      callback();
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for ACP dispatch.');
}
