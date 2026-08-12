import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import type { AcpManagedOwnedProcess, AcpManagedProcessLauncher } from '@/providers/acp/execution/AcpManagedClientAdapter';
import {
  OPENCODE_EXECUTION_REQUEST_KIND,
  OpencodeApplicationContextFactory,
} from '@/providers/opencode/app/OpencodeApplicationContextFactory';
import type { OpencodeExecutionInvocation } from '@/providers/opencode/execution/OpencodeExecutionBackend';

function createFakeLauncher(): AcpManagedProcessLauncher & { launched: number } {
  let launched = 0;
  return {
    launched,
    get launchedCount() { return launched; },
    async launch(): Promise<AcpManagedOwnedProcess> {
      launched += 1;
      throw new Error('not expected during composition');
    },
  } as AcpManagedProcessLauncher & { launched: number };
}

describe('OpencodeApplicationContextFactory', () => {
  it('composes a managed ACP backend context without launching a process', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const launcher = createFakeLauncher();
    const factory = new OpencodeApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: { initialize: async () => ({ dispose: async () => undefined }) },
      processLauncher: launcher,
      reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
      clientInfo: { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 60_000,
      maxResultBytes: 1_048_576,
    });

    const backendContext = await factory.createBackendContext();
    expect(typeof backendContext.clientFactory.create).toBe('function');
    expect(typeof backendContext.sessionInstanceIdFactory()).toBe('string');
    expect(backendContext.resultCommitTimeoutMs).toBe(2_000);

    const invocation: OpencodeExecutionInvocation = {
      startupRef: 'startup-1',
      restartFingerprint: 'fp-1',
      cwd: '/vault',
      prompt: [{ type: 'text', text: 'Hello' }],
      mcpServers: [],
    };
    const requestRef = requests.register(OPENCODE_EXECUTION_REQUEST_KIND, invocation);
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toEqual(invocation);
  });

  it('binds the workspace context to the active generation', async () => {
    const identities = new ApplicationIdentityFactory(() => '2'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const workspaceInputs: Array<{ generation: number }> = [];
    const factory = new OpencodeApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: {
        initialize: async input => {
          workspaceInputs.push({ generation: input.generation });
          return { dispose: async () => undefined };
        },
      },
      processLauncher: createFakeLauncher(),
      reconciler: { reconcile: async () => ({ kind: 'stopped-safe' }) },
      clientInfo: { name: 'grimoire', version: '0.0.0' },
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 60_000,
      maxResultBytes: 1_048_576,
    });

    const workspaceContext = await factory.createWorkspaceContext({ generation: 4 });
    await workspaceContext.initialize(new AbortController().signal);
    expect(workspaceInputs).toEqual([{ generation: 4 }]);
  });
});
