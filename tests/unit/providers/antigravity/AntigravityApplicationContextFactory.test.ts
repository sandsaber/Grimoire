import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import {
  ANTIGRAVITY_EXECUTION_REQUEST_KIND,
  AntigravityApplicationContextFactory,
} from '@/providers/antigravity/app/AntigravityApplicationContextFactory';
import type { AntigravityInvocation } from '@/providers/antigravity/execution/AntigravityExecutionBackend';

describe('AntigravityApplicationContextFactory', () => {
  it('composes a lazy backend context and generation-bound workspace without a legacy runtime', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requestStore = new EphemeralExecutionRequestStore();
    const requests = new ApplicationExecutionRequestBroker(requestStore, identities);
    const requestRef = requests.register<AntigravityInvocation>(
      ANTIGRAVITY_EXECUTION_REQUEST_KIND,
      {
        command: 'agy',
        cwd: '/vault',
        environment: {},
        model: null,
        permissionMode: 'auto',
        prompt: 'Hello',
      },
    );
    const workspaceInputs: Array<{ generation: number; aborted: boolean }> = [];
    let launched = false;
    const factory = new AntigravityApplicationContextFactory({
      requests,
      results: new DurableExecutionResultStore(
        new TestDurableStorage(),
        {
          digestUtf8: async value => createHash('sha256').update(value).digest('hex'),
        },
      ),
      identities,
      processTransport: {
        launch: () => {
          launched = true;
          throw new Error('not expected during composition');
        },
      },
      workspace: {
        initialize: async input => {
          workspaceInputs.push({
            generation: input.generation,
            aborted: input.signal.aborted,
          });
          return { dispose: async () => undefined };
        },
      },
    });

    const backendContext = await factory.createBackendContext();
    await expect(backendContext.requestResolver.resolve(requestRef)).resolves.toMatchObject({
      command: 'agy',
      prompt: 'Hello',
    });
    expect(launched).toBe(false);

    const workspaceContext = await factory.createWorkspaceContext({
      generation: 7,
    });
    const controller = new AbortController();
    await workspaceContext.initialize(controller.signal);
    expect(workspaceInputs).toEqual([{ generation: 7, aborted: false }]);
  });
});
