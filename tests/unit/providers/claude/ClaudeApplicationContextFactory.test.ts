import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import {
  CLAUDE_EXECUTION_REQUEST_KIND,
  ClaudeApplicationContextFactory,
} from '@/providers/claude/app/ClaudeApplicationContextFactory';
import type { ClaudeExecutionInvocation } from '@/providers/claude/execution/ClaudeExecutionBackend';

describe('ClaudeApplicationContextFactory', () => {
  it('composes an SDK backend context from injected provider-owned ports', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    let queryCreated = false;
    const factory = new ClaudeApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(new TestDurableStorage(), {
        digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
      }),
      identities,
      presentations: { store: async () => ({ presentationRef: `pr-${'0'.repeat(64)}` }) },
      workspace: { initialize: async () => ({ dispose: async () => undefined }) },
      queryFactory: {
        create: () => {
          queryCreated = true;
          throw new Error('not expected during composition');
        },
      },
      taskResultLoader: { load: async () => null },
      reconciler: { reconcile: async () => ({ kind: 'unknown', effectsPossible: true }) },
      auxiliaryQueries: { execute: async () => '' },
    });

    const backendContext = await factory.createBackendContext();
    expect(queryCreated).toBe(false);
    expect(typeof backendContext.sessionInstanceIdFactory()).toBe('string');
    expect(backendContext.interactionBridge).toBeDefined();

    const invocation = {
      startupRef: 'startup-1',
      restartFingerprint: 'fp-1',
      message: { type: 'text', text: 'Hello' },
    } as unknown as ClaudeExecutionInvocation;
    const requestRef = requests.register(CLAUDE_EXECUTION_REQUEST_KIND, invocation);
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toEqual(invocation);
  });

  it('binds the workspace context to the active generation', async () => {
    const identities = new ApplicationIdentityFactory(() => '2'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const workspaceInputs: Array<{ generation: number }> = [];
    const factory = new ClaudeApplicationContextFactory({
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
      queryFactory: { create: () => { throw new Error('no query'); } },
      taskResultLoader: { load: async () => null },
      reconciler: { reconcile: async () => ({ kind: 'unknown', effectsPossible: true }) },
      auxiliaryQueries: { execute: async () => '' },
    });

    const workspaceContext = await factory.createWorkspaceContext({ generation: 3 });
    await workspaceContext.initialize(new AbortController().signal);
    expect(workspaceInputs).toEqual([{ generation: 3 }]);
  });
});
