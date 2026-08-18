import '@/providers';

import { CodexExecution } from '@/app/execution/codex/CodexExecutionComposition';
import type { CodexExecutionConnectionFactory } from '@/providers/codex/execution/CodexExecutionBackend';
import { updateCodexProviderSettings } from '@/providers/codex/settings';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

/**
 * The half of the Codex flip that only exists in production.
 *
 * The backend takes a request reference and knows nothing about what is inside
 * it; the runtime produces one and knows nothing either. This is the only place
 * that knows both, which is what makes a defect here invisible to every suite
 * that proved the halves apart.
 */
describe('Codex execution composition', () => {
  function createPlugin(overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'default',
      systemPrompt: '',
      userName: 'Michael',
      ...overrides,
    };
    updateCodexProviderSettings(settings, { enabled: true });
    return {
      settings,
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/codex',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
    };
  }

  const neverConnects: CodexExecutionConnectionFactory = {
    create: () => (({
      initializeResult: null,
      initialize: () => new Promise<never>(() => undefined),
      request: () => new Promise<never>(() => undefined),
      notify: () => undefined,
      onNotification: () => () => undefined,
      onServerRequest: () => () => undefined,
      onConnectionLost: () => () => undefined,
      dispose: async () => undefined,
    })),
  };

  function queued(execution: CodexExecution, overrides: Record<string, unknown> = {}): string {
    return execution.turnRequests.reference({
      prompt: 'summarise the note',
      text: 'summarise the note',
      isCompact: false,
      externalContextPaths: [],
      orchestratorMode: false,
      conversation: () => null,
      ...overrides,
    });
  }

  it('resolves a reference the runtime minted through the backend it built', async () => {
    // One store, or the reference resolves to nothing: this is the seam the
    // first wave's end-to-end turn failed on.
    const execution = new CodexExecution(createPlugin());
    const backend = execution.createBackend(neverConnects);
    const requestRef = queued(execution);

    const invocation = await (backend as unknown as {
      context: { requestResolver: { resolve(ref: string): Promise<unknown> } };
    }).context.requestResolver.resolve(requestRef);

    expect(invocation).toMatchObject({ thread: { kind: 'new' } });
    execution.dispose();
  });

  it('reads the settings each turn is dispatched under, not the ones it started with', async () => {
    const plugin = createPlugin();
    const execution = new CodexExecution(plugin);
    execution.createBackend(neverConnects);

    const first = await execution.turnRequests.resolve(queued(execution));
    plugin.settings.permissionMode = 'full_access';
    const second = await execution.turnRequests.resolve(queued(execution));

    if (first.thread.kind !== 'new' || second.thread.kind !== 'new') {
      throw new Error('expected new threads');
    }
    expect(first.thread.params).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
      cwd: '/vault',
    });
    expect(second.thread.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    expect(second.thread.params.baseInstructions).toContain('Michael');
    execution.dispose();
  });

  it('takes a prompt down when its interaction ends somewhere else', async () => {
    const execution = new CodexExecution(createPlugin());
    let dismissed = 0;
    const presenter = execution.createInteractionPresenter(() => ({
      approval: async () => new Promise<never>(() => undefined),
      approvalDismisser: () => {
        dismissed += 1;
      },
    }));
    const backend = execution.createBackend(neverConnects);
    const bridge = (backend as unknown as {
      context: { interactionBridge: { prepare(input: unknown): Promise<any> } };
    }).context.interactionBridge;
    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i', command: 'ls', cwd: '/vault' },
    });

    void presenter.present({
      interactionId: 'ix-00000000000000000000000000000001' as never,
      runId: 'run-00000000000000000000000000000001' as never,
      kind: 'approval',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    });
    await Promise.resolve();
    // The run was cancelled, or Codex answered its own request: either way the
    // backend cancels the prepared interaction and nobody tells the surface.
    await prepared.cancel();

    expect(dismissed).toBe(1);
    execution.dispose();
  });

  it('takes everything down and releases what a turn was holding, on unload', async () => {
    const execution = new CodexExecution(createPlugin());
    let dismissed = 0;
    const presenter = execution.createInteractionPresenter(() => ({
      approval: async () => new Promise<never>(() => undefined),
      approvalDismisser: () => {
        dismissed += 1;
      },
    }));
    const backend = execution.createBackend(neverConnects);
    const bridge = (backend as unknown as {
      context: { interactionBridge: { prepare(input: unknown): Promise<any> } };
    }).context.interactionBridge;
    const prepared = await bridge.prepare({
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't', turnId: 'u', itemId: 'i', command: 'ls', cwd: '/vault' },
    });
    void presenter.present({
      interactionId: 'ix-00000000000000000000000000000002' as never,
      runId: 'run-00000000000000000000000000000002' as never,
      kind: 'approval',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
    });
    await Promise.resolve();
    queued(execution);

    execution.dispose();

    expect(dismissed).toBe(1);
    expect(execution.turnRequests.pendingCount).toBe(0);
  });
});
