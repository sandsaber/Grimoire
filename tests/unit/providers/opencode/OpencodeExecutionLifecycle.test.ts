import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
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
import type {
  ManagedAcpClient,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpPromptResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';
import { OpencodeExecutionBackend } from '@/providers/opencode/execution/OpencodeExecutionBackend';

const SESSION_ID = executionSessionId(`es-${'4'.repeat(32)}`);
const RUN_ID = runId(`run-${'5'.repeat(32)}`);
const OWNER = { kind: 'conversation' as const, ownerId: 'opencode-lifecycle' };

describe('OpenCode execution lifecycle integration', () => {
  it('persists one stable native run identity through result and terminal ingestion', async () => {
    const storage = new TestDurableStorage();
    let clock = 0;
    const now = () => ++clock;
    const repositories = new ExecutionControlRepositories(storage, now);
    const transactions = new ExecutionControlTransactionCoordinator(storage, repositories, { now });
    const client = new LifecycleClient();
    const scheduler = new PassiveScheduler();
    const backend = new OpencodeExecutionBackend({
      clientFactory: {
        create: async (input: ManagedAcpClientFactoryInput) => {
          client.permissionHandler = input.requestPermission;
          return client;
        },
      },
      requestResolver: {
        resolve: async () => ({
          startupRef: 'opencode-startup',
          restartFingerprint: 'opencode-v1',
          cwd: '/vault',
          prompt: [{ type: 'text', text: 'Execute opaque work' }],
          mcpServers: [],
          messageId: 'message-1',
        }),
      },
      dynamicApplier: { apply: async () => undefined },
      interactionBridge: { prepare: async () => { throw new Error('No interaction.'); } },
      resultSink: {
        storeResult: async () => ({
          kind: 'committed',
          result: { resultId: 'opencode-result', storage: 'projection' },
        }),
      },
      reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
      auxiliaryQueries: { execute: async () => '' },
      scheduler,
      sessionInstanceIdFactory: () => sessionInstanceId(`si-${'6'.repeat(32)}`),
      interactionIdFactory: () => interactionId(`ix-${'7'.repeat(32)}`),
      now,
      controlTimeoutMs: 500,
      resultCommitTimeoutMs: 500,
      recoveryTimeoutMs: 500,
      runTimeoutMs: 60_000,
      maxResultBytes: 1_024,
    });
    const registry = new ExecutionLifecycleRegistry({
      repositories,
      controlTransactions: transactions,
      nextTransactionId: transactionIds(),
      now,
      scheduler,
    });
    registry.registerBackend({ backend });
    await registry.start();
    await registry.createSession({
      backendId: backend.descriptor.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    await registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      resultExpectation: 'required',
      requestRef: 'opencode-request',
    });
    await waitFor(() => client.promptRequests === 1);

    client.emit(agentText('native-session', 'result'));
    client.complete({ stopReason: 'end_turn', userMessageId: 'message-1' });
    await registry.waitForRunStream(RUN_ID);

    expect(registry.getRun(RUN_ID)).toMatchObject({
      state: 'succeeded',
      nativeRunRef: 'message-1',
      resultRef: { resultId: 'opencode-result', storage: 'projection' },
      terminal: { kind: 'succeeded', reason: 'completed' },
      lastSequence: 3,
    });
  });
});

class LifecycleClient implements ManagedAcpClient {
  promptRequests = 0;
  permissionHandler?: ManagedAcpClientFactoryInput['requestPermission'];
  private readonly notifications = new Set<(notification: AcpSessionNotification) => void>();
  private readonly completion = deferred<AcpPromptResponse>();

  async initialize(): Promise<void> {}
  async newSession() { return { sessionId: 'native-session' }; }
  async loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    return { sessionId: request.sessionId };
  }
  prompt(): Promise<AcpPromptResponse> {
    this.promptRequests += 1;
    return this.completion.promise;
  }
  async setConfigOption() { return { configOptions: [] }; }
  cancel(): void {}
  onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onConnectionLost(): () => void { return () => undefined; }
  async close(): Promise<'confirmed'> { return 'confirmed'; }
  emit(notification: AcpSessionNotification): void {
    for (const listener of this.notifications) listener(notification);
  }
  complete(response: AcpPromptResponse): void { this.completion.resolve(response); }
}

class PassiveScheduler implements ExecutionLifecycleScheduler {
  setTimeout(callback: () => void): unknown { return callback; }
  clearTimeout(): void {}
}

function agentText(sessionId: string, text: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId: 'assistant-1',
    },
  };
}

function transactionIds(): () => string {
  let ordinal = 0;
  return () => `tx-${(++ordinal).toString(16).padStart(32, '0')}`;
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
  throw new Error('Timed out waiting for OpenCode dispatch.');
}
