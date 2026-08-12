import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import type { AcpManagedOwnedProcess, AcpManagedProcessLauncher } from '@/providers/acp/execution/AcpManagedClientAdapter';
import {
  MIMOCODE_EXECUTION_REQUEST_KIND,
  MimocodeApplicationContextFactory,
} from '@/providers/mimocode/app/MimocodeApplicationContextFactory';
import type { MimocodeEmptyResultOutcome } from '@/providers/mimocode/execution/MimocodeExecutionBackend';
import type { MimocodeExecutionInvocation } from '@/providers/mimocode/execution/MimocodeExecutionBackend';

function fakeLauncher(): AcpManagedProcessLauncher {
  return {
    async launch(): Promise<AcpManagedOwnedProcess> {
      throw new Error('not expected during composition');
    },
  };
}

describe('MimocodeApplicationContextFactory', () => {
  it('composes a managed ACP backend context with the MiMoCode empty-result policy', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const outcomes: MimocodeEmptyResultOutcome[] = [{ kind: 'no-provider-error' }];
    const factory = new MimocodeApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: { initialize: async () => ({ dispose: async () => undefined }) },
      processLauncher: fakeLauncher(),
      reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
      clientInfo: { name: 'grimoire', version: '0.0.0' },
      emptyResultPolicy: { resolve: async () => outcomes[0] },
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 60_000,
      maxResultBytes: 1_048_576,
    });

    const backendContext = await factory.createBackendContext();
    expect(backendContext.emptyResultPolicy).toBeDefined();
    expect(typeof backendContext.clientFactory.create).toBe('function');

    const invocation: MimocodeExecutionInvocation = {
      startupRef: 'startup-1',
      restartFingerprint: 'fp-1',
      cwd: '/vault',
      prompt: [{ type: 'text', text: 'Hello' }],
      mcpServers: [],
      databasePath: '/vault/.mimocode/db.sqlite',
      availableRawModelIds: ['mimo-1'],
    };
    const requestRef = requests.register(MIMOCODE_EXECUTION_REQUEST_KIND, invocation);
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toEqual(invocation);
  });
});
