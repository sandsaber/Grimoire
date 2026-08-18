import '@/providers';

import path from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { CodexExecution } from '@/app/execution/codex/CodexExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
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
/** The vault directory as this platform writes it, which is what the daemon is given. */
const VAULT_CWD = path.normalize('/vault');

function hostPlatformOs(): string {
  if (process.platform === 'win32') return 'windows';
  return process.platform === 'darwin' ? 'macos' : 'linux';
}

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

  function createExecution(plugin: any): CodexExecution {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    return new CodexExecution(plugin, host.registry);
  }

  /** One Codex turn, without a `codex app-server`. */
  class FakeConnection {
    initializeResult: unknown = null;
    readonly calls: Array<{ method: string; params: any }> = [];
    /** Raises a command approval from inside the turn, the way the daemon does. */
    approveOnTurnStart = false;
    approvalResponse: unknown;
    /** The thread the daemon is answering on, which its notifications are routed by. */
    private activeThreadId = 'thread-1';
    private readonly listeners = new Set<(method: string, params: unknown) => void>();
    private readonly serverRequests = new Set<(
      requestId: string | number,
      method: string,
      params: unknown,
    ) => Promise<unknown>>();

    async initialize(): Promise<unknown> {
      // The daemon this stands in for was launched on this machine, so it
      // reports this machine: the runtime context refuses a daemon whose
      // platform disagrees with the target it was launched for.
      this.initializeResult ??= {
        userAgent: 'codex-fake',
        platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
        platformOs: hostPlatformOs(),
      };
      return this.initializeResult;
    }

    async request<T>(method: string, params: any): Promise<T> {
      this.calls.push({ method, params });
      if (method === 'thread/start' || method === 'thread/resume') {
        this.activeThreadId = String(params?.threadId ?? 'thread-1');
        return {
          thread: this.thread(this.activeThreadId),
          model: 'gpt-5.5',
          modelProvider: 'openai',
          serviceTier: null,
        } as T;
      }
      if (method === 'turn/start') {
        // Answered the way the daemon does: the response establishes the turn,
        // and everything else arrives after it. A real timer rather than a
        // microtask, because the caller has to see the response first —
        // a server request that arrives before the turn is established has no
        // run to belong to.
        setTimeout(() => {
          void this.runTurn();
        }, 0);
        return { turn: { id: 'turn-1', items: [], status: 'inProgress', error: null } } as T;
      }
      return {} as T;
    }

    private async runTurn(): Promise<void> {
      if (this.approveOnTurnStart) {
        const handler = this.serverRequests.values().next().value;
        this.approvalResponse = await handler?.(1, 'item/commandExecution/requestApproval', {
          threadId: this.activeThreadId,
          turnId: 'turn-1',
          itemId: 'item-1',
          command: 'npm run build',
          cwd: '/vault',
        }).catch((error: unknown) => ({ failed: String(error) }));
      }
      this.notify('item/agentMessage/delta', {
        threadId: this.activeThreadId,
        turnId: 'turn-1',
        itemId: 'message-1',
        delta: 'the answer',
      });
      this.notify('turn/completed', {
        threadId: this.activeThreadId,
        turn: {
          id: 'turn-1',
          status: 'completed',
          error: null,
          items: [{ type: 'agentMessage', id: 'message-1', text: 'the answer' }],
        },
      });
    }

    notify(method: string, params: unknown): void {
      for (const listener of this.listeners) {
        listener(method, params);
      }
    }

    onNotification(listener: (method: string, params: unknown) => void): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    onServerRequest(handler: (
      requestId: string | number,
      method: string,
      params: unknown,
    ) => Promise<unknown>): () => void {
      this.serverRequests.add(handler);
      return () => this.serverRequests.delete(handler);
    }

    onConnectionLost(): () => void {
      return () => undefined;
    }

    async dispose(): Promise<void> {}

    private thread(id: string): unknown {
      return {
        id,
        preview: '',
        ephemeral: false,
        path: `/sessions/${id}.jsonl`,
        cwd: '/vault',
        cliVersion: 'test',
        status: { type: 'active' },
        turns: [],
        createdAt: 1,
        updatedAt: 1,
        name: null,
      };
    }
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

  async function createTurnHarness(): Promise<{
    runtime: any;
    connection: FakeConnection;
    execution: CodexExecution;
  }> {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const execution = new CodexExecution(createPlugin(), host.registry);
    const connection = new FakeConnection();
    host.registerBackend(execution.createBackendRegistration({
      create: () => connection as never,
    }));
    await host.start();
    return {
      connection,
      execution,
      runtime: execution.createRuntime(),
    };
  }

  it('runs a whole turn: the runtime stores it, the backend launches it, the answer comes back', async () => {
    // The seam neither half can prove alone. In wave 1 this test found three
    // defects the per-half suites could not, one of them fatal to every turn.
    const plugin = createPlugin();
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const execution = new CodexExecution(plugin, host.registry);
    const connection = new FakeConnection();
    host.registerBackend(execution.createBackendRegistration({
      create: () => connection as never,
    }));
    await host.start();
    const runtime = execution.createRuntime();

    const turn = runtime.prepareTurn({ text: 'summarise the note' });
    const chunks = await drain(runtime.query(turn));

    expect(chunks).toContainEqual({ type: 'text', content: 'the answer' });
    const started = connection.calls.find(call => call.method === 'thread/start');
    expect(started?.params).toMatchObject({ cwd: VAULT_CWD, sandbox: 'read-only' });
    const turnStart = connection.calls.find(call => call.method === 'turn/start');
    expect(turnStart?.params.input).toEqual([
      { type: 'text', text: 'summarise the note', text_elements: [] },
    ]);
    expect(turnStart?.params.threadId).toBe('thread-1');
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);

    // The second turn joins the thread the first one bound: a daemon that
    // already holds it is not asked to start or resume it again.
    const second = await drain(runtime.query(runtime.prepareTurn({ text: 'and again' })));

    expect(second).toContainEqual({ type: 'text', content: 'the answer' });
    expect(connection.calls.filter(call => call.method === 'thread/start')).toHaveLength(1);
    expect(connection.calls.filter(call => call.method === 'turn/start')).toHaveLength(2);
    execution.dispose();
  });

  it('sends the prompt the turn was prepared into, not the text the user typed', async () => {
    // The two differ whenever the turn carries context — a current note, a
    // selection, a search — and the persisted copy is the one without it.
    const { runtime, connection, execution } = await createTurnHarness();

    await drain(runtime.query(runtime.prepareTurn({
      text: 'summarise this',
      currentNotePath: 'Notes/Daily.md',
    })));

    const turnStart = connection.calls.find(call => call.method === 'turn/start');
    const text = turnStart?.params.input.find((item: any) => item.type === 'text');
    expect(text.text).toContain('summarise this');
    expect(text.text).toContain('Notes/Daily.md');
    execution.dispose();
  });

  it('resumes the thread this tab is bound to', async () => {
    // The conversation is the tab's, not the store's: a runtime that never told
    // the store which conversation it serves would start a new thread for a
    // conversation that already has one.
    const { runtime, connection, execution } = await createTurnHarness();
    runtime.syncConversationState?.({ sessionId: 'thread-existing' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'carry on' })));

    expect(connection.calls.filter(call => call.method === 'thread/start')).toEqual([]);
    expect(connection.calls.find(call => call.method === 'thread/resume')?.params)
      .toMatchObject({ threadId: 'thread-existing' });
    expect(runtime.getSessionId()).toBe('thread-existing');
    execution.dispose();
  });

  it('asks the surface that installed its callback, not one captured before it did', async () => {
    // The tab installs its approval callback on the runtime after constructing
    // it, so a presenter that captured the callbacks at construction would ask
    // an empty surface and decline every approval.
    const { runtime, connection, execution } = await createTurnHarness();
    const asked: string[] = [];
    runtime.setApprovalCallback?.(async (_tool: string, _input: unknown, description: string) => {
      asked.push(description);
      return 'allow';
    });
    connection.approveOnTurnStart = true;

    await drain(runtime.query(runtime.prepareTurn({ text: 'run the build' })));

    expect(asked).toEqual(['Execute: npm run build']);
    expect(connection.approvalResponse).toEqual({ decision: 'accept' });
    execution.dispose();
  });

  it('resolves a reference the runtime minted through the backend it built', async () => {
    // One store, or the reference resolves to nothing: this is the seam the
    // first wave's end-to-end turn failed on.
    const execution = createExecution(createPlugin());
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
    const execution = createExecution(plugin);
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
      cwd: VAULT_CWD,
    });
    expect(second.thread.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    expect(second.thread.params.baseInstructions).toContain('Michael');
    execution.dispose();
  });

  it('takes a prompt down when its interaction ends somewhere else', async () => {
    const execution = createExecution(createPlugin());
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
    const execution = createExecution(createPlugin());
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
