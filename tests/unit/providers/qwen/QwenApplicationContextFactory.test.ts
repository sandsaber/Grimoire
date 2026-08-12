import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import type { AcpManagedOwnedProcess, AcpManagedProcessLauncher } from '@/providers/acp/execution/AcpManagedClientAdapter';
import {
  QWEN_EXECUTION_REQUEST_KIND,
  QwenApplicationContextFactory,
} from '@/providers/qwen/app/QwenApplicationContextFactory';
import type { QwenExecutionInvocation } from '@/providers/qwen/execution/QwenExecutionBackend';

function fakeLauncher(): AcpManagedProcessLauncher {
  return { async launch(): Promise<AcpManagedOwnedProcess> { throw new Error('no launch'); } };
}

describe('QwenApplicationContextFactory', () => {
  it('composes a managed ACP backend context with commands and usage', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(new EphemeralExecutionRequestStore(), identities);
    const factory = new QwenApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: { initialize: async () => ({ dispose: async () => undefined }) },
      processLauncher: fakeLauncher(),
      reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
      commands: { replace: () => undefined, clear: () => undefined },
      usage: { attach: () => undefined, detach: () => undefined, recordNotification: () => undefined, recordTurn: async () => undefined },
      clientInfo: { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 60_000,
      maxResultBytes: 1_048_576,
    });

    const backendContext = await factory.createBackendContext();
    expect(backendContext.commands).toBeDefined();
    expect(backendContext.usage).toBeDefined();

    const invocation: QwenExecutionInvocation = {
      startupRef: 'startup-1',
      restartFingerprint: 'fp-1',
      cwd: '/vault',
      prompt: [{ type: 'text', text: 'Hello' }],
      mcpServers: [],
    };
    const requestRef = requests.register(QWEN_EXECUTION_REQUEST_KIND, invocation);
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toEqual(invocation);
  });
});
