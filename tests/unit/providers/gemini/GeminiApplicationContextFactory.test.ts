import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import type { AcpManagedOwnedProcess, AcpManagedProcessLauncher } from '@/providers/acp/execution/AcpManagedClientAdapter';
import {
  GEMINI_EXECUTION_REQUEST_KIND,
  GeminiApplicationContextFactory,
} from '@/providers/gemini/app/GeminiApplicationContextFactory';
import type { GeminiExecutionInvocation } from '@/providers/gemini/execution/GeminiExecutionBackend';

function fakeLauncher(): AcpManagedProcessLauncher {
  return { async launch(): Promise<AcpManagedOwnedProcess> { throw new Error('no launch'); } };
}

describe('GeminiApplicationContextFactory', () => {
  it('composes a managed ACP backend context with history replay and usage', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(new EphemeralExecutionRequestStore(), identities);
    const factory = new GeminiApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: { initialize: async () => ({ dispose: async () => undefined }) },
      processLauncher: fakeLauncher(),
      reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
      historyReplay: {
        begin: async () => undefined,
        observe: () => false,
        settle: async () => undefined,
        clear: () => undefined,
      },
      usage: { attach: () => undefined, detach: () => undefined, recordNotification: () => undefined, recordTurn: async () => undefined },
      clientInfo: { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 60_000,
      maxResultBytes: 1_048_576,
    });

    const backendContext = await factory.createBackendContext();
    expect(backendContext.historyReplay).toBeDefined();
    expect(backendContext.usage).toBeDefined();

    const invocation: GeminiExecutionInvocation = {
      startupRef: 'startup-1',
      restartFingerprint: 'fp-1',
      cwd: '/vault',
      prompt: [{ type: 'text', text: 'Hello' }],
      mcpServers: [],
    };
    const requestRef = requests.register(GEMINI_EXECUTION_REQUEST_KIND, invocation);
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toEqual(invocation);
  });
});
