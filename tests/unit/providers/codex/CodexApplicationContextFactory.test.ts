import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import {
  CODEX_EXECUTION_REQUEST_KIND,
  CodexApplicationContextFactory,
} from '@/providers/codex/app/CodexApplicationContextFactory';
import type { CodexExecutionInvocation } from '@/providers/codex/execution/CodexExecutionBackend';

describe('CodexApplicationContextFactory', () => {
  it('composes a lazy app-server backend context without launching a process', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requestStore = new EphemeralExecutionRequestStore();
    const requests = new ApplicationExecutionRequestBroker(requestStore, identities);
    let launched = false;
    const factory = new CodexApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: {
        store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }),
      },
      workspace: {
        initialize: async () => ({ dispose: async () => undefined }),
      },
      processFactory: {
        create: () => {
          launched = true;
          throw new Error('not expected during composition');
        },
      },
      defaultResumeParams: { approvalPolicy: 'on-request' },
    });

    const backendContext = await factory.createBackendContext();
    expect(launched).toBe(false);
    expect(backendContext.scheduler).toBeDefined();
    expect(typeof backendContext.connectionFactory.create).toBe('function');
    expect(typeof backendContext.sessionInstanceIdFactory()).toBe('string');
    expect(typeof backendContext.interactionIdFactory()).toBe('string');

    const invocation: CodexExecutionInvocation = {
      thread: {
        kind: 'new',
        params: { model: 'gpt-5', cwd: '/vault', approvalPolicy: 'on-request', sandbox: 'workspace-readonly' },
      },
      turn: { kind: 'start', params: { input: [{ type: 'text', text: 'Hello' }] } },
    };
    const requestRef = requests.register(CODEX_EXECUTION_REQUEST_KIND, invocation);
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toEqual(invocation);
  });

  it('binds the workspace context to the active generation', async () => {
    const identities = new ApplicationIdentityFactory(() => '2'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const workspaceInputs: Array<{ generation: number; aborted: boolean }> = [];
    const factory = new CodexApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: {
        initialize: async input => {
          workspaceInputs.push({ generation: input.generation, aborted: input.signal.aborted });
          return { dispose: async () => undefined };
        },
      },
      processFactory: { create: () => { throw new Error('no process'); } },
      defaultResumeParams: {},
    });

    const workspaceContext = await factory.createWorkspaceContext({ generation: 9 });
    const controller = new AbortController();
    await workspaceContext.initialize(controller.signal);
    expect(workspaceInputs).toEqual([{ generation: 9, aborted: false }]);
  });
});
