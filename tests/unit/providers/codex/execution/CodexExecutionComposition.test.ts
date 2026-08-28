import '@/providers';

import path from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { codexPlanUsageStore } from '@/providers/codex/app/CodexPlanUsageStore';
import type { CodexExecutionConnectionFactory } from '@/providers/codex/execution/CodexExecutionBackend';
import { CodexExecution } from '@/providers/codex/execution/CodexExecutionComposition';
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
    /** Runs a command inside the turn, the way a real one does. */
    toolOnTurnStart = false;
    /** The message a failed turn reports, the way the daemon reports one. */
    failTurn: string | undefined;
    /** A turn that answers with no agent message, the way a plan turn does. */
    emptyTurn = false;
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
      if (method === 'account/rateLimits/read') {
        return {
          plan: 'ChatGPT Pro',
          rateLimits: {
            primary: {
              label: 'weekly',
              windowDurationMins: 10080,
              usedPercent: 40,
              resetsAt: 1893456000000,
            },
          },
        } as T;
      }
      if (method === 'thread/compact/start') {
        // A compaction has no turn of its own to return: the daemon announces
        // it, and the turn id is established from that announcement.
        setTimeout(() => {
          this.notify('turn/started', { threadId: this.activeThreadId, turn: { id: 'turn-compact' } });
          this.notify('turn/completed', {
            threadId: this.activeThreadId,
            turn: { id: 'turn-compact', status: 'completed', error: null, items: [] },
          });
        }, 0);
        return {} as T;
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
      if (this.toolOnTurnStart) {
        this.notify('item/started', {
          threadId: this.activeThreadId,
          turnId: 'turn-1',
          item: { type: 'commandExecution', id: 'item-1', command: 'npm test', status: 'inProgress' },
        });
        this.notify('item/completed', {
          threadId: this.activeThreadId,
          turnId: 'turn-1',
          item: {
            type: 'commandExecution',
            id: 'item-1',
            command: 'npm test',
            status: 'completed',
            aggregatedOutput: 'all green',
            exitCode: 0,
          },
        });
      }
      if (this.emptyTurn) {
        this.notify('turn/completed', {
          threadId: this.activeThreadId,
          turn: { id: 'turn-1', status: 'completed', error: null, items: [] },
        });
        return;
      }
      this.notify('item/agentMessage/delta', {
        threadId: this.activeThreadId,
        turnId: 'turn-1',
        itemId: 'message-1',
        delta: 'the answer',
      });
      this.notify('turn/completed', {
        threadId: this.activeThreadId,
        turn: this.failTurn
          ? { id: 'turn-1', status: 'failed', error: { message: this.failTurn }, items: [] }
          : {
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

    // Once. The run pushes each event onto its own stream and the registry also
    // subscribes to the session, so an event published to both is ingested
    // twice — invisible for facts, which are deduplicated by delivery id, and
    // doubled for content, which by design is not.
    expect(chunks.filter(chunk => chunk.type === 'text'))
      .toEqual([{ type: 'text', content: 'the answer' }]);
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
    runtime.installInteractions({ approval: async (_tool: string, _input: unknown, description: string) => {
      asked.push(description);
      return 'allow';
    } });
    connection.approveOnTurnStart = true;

    await drain(runtime.query(runtime.prepareTurn({ text: 'run the build' })));

    expect(asked).toEqual(['Execute: npm run build']);
    expect(connection.approvalResponse).toEqual({ decision: 'accept' });
    execution.dispose();
  });

  it('gives the turn the writable roots the daemon itself reported', async () => {
    // The daemon reports its own home in the handshake. Guessing `~/.codex`
    // instead is wrong for a custom CODEX_HOME and impossible for a target that
    // is not this machine, and a memories directory the model cannot write is a
    // Codex that silently forgets.
    const plugin = createPlugin({ permissionMode: 'plan' });
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const execution = new CodexExecution(plugin, host.registry);
    const connection = new FakeConnection();
    connection.initializeResult = {
      userAgent: 'codex-fake',
      platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
      platformOs: hostPlatformOs(),
      codexHome: path.normalize('/elsewhere/codex'),
    };
    host.registerBackend(execution.createBackendRegistration({ create: () => connection as never }));
    await host.start();
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'remember this' })));

    const turnStart = connection.calls.find(call => call.method === 'turn/start');
    expect(turnStart?.params.sandboxPolicy.writableRoots)
      .toContain(path.join(path.normalize('/elsewhere/codex'), 'memories'));
    execution.dispose();
  });

  it('renders a tool call on the surface, which is what the flip must not lose', async () => {
    // The whole reason the kernel grew a second content channel: a Codex turn
    // is mostly tool calls, and a flip that streamed only text would ship a
    // chat with nothing in it but the answer.
    const { runtime, connection, execution } = await createTurnHarness();
    connection.toolOnTurnStart = true;

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'run the tests' })));

    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool_use', name: 'Bash' }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      content: expect.stringContaining('all green'),
    }));
    expect(chunks).toContainEqual({ type: 'text', content: 'the answer' });
    execution.dispose();
  });

  it('reports a failed turn once, in the daemon\'s own words', async () => {
    // The renderer produces an error chunk of its own and the kernel renders
    // the terminal: unfiltered that is the same failure twice, and filtered
    // without keeping the words it is the neutral sentence instead.
    const { runtime, connection, execution } = await createTurnHarness();
    connection.failTurn = 'the model refused';

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'do it' })));

    expect(chunks.filter(chunk => chunk.type === 'error'))
      .toEqual([{ type: 'error', content: 'the model refused' }]);
    execution.dispose();
  });

  it('lets the plan-limit indicator ask the daemon what is left', async () => {
    // The reader and the subscription both lived in the deleted runtime; without
    // them every refresh answers "no reader" and the badge stays empty.
    const { runtime, connection, execution } = await createTurnHarness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'hello' })));

    connection.notify('account/rateLimits/updated', {
      rateLimits: {
        primary: {
          label: 'weekly',
          windowDurationMins: 10080,
          usedPercent: 40,
          resetsAt: 1893456000000,
        },
      },
    });
    const usage = await codexPlanUsageStore.refreshUsage({
      plugin: createPlugin(),
      providerId: 'codex',
      settings: createPlugin().settings,
    });

    expect(usage).not.toBeNull();
    expect(connection.calls.map(call => call.method)).toContain('account/rateLimits/read');
    execution.dispose();
  });

  it('lets go of a closed tab\'s images and prompts', async () => {
    // A tab that closes has no next turn, and its scratch would otherwise wait
    // for the plugin to unload.
    const { runtime, execution } = await createTurnHarness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'hello' })));
    const held = execution.turnRequests;

    await runtime.cleanup();

    // Nothing left to free: releasing twice is a no-op, and disposing after a
    // closed tab must not double-free what it already released.
    expect(() => execution.dispose()).not.toThrow();
    expect(held.pendingCount).toBe(0);
  });

  it('refuses a compaction that came with an instruction', async () => {
    // Codex compacts a thread; it does not read an argument, so `/compact
    // please` would silently compact and lose the instruction. The legacy
    // runtime refused it locally, and so does the resolver.
    const execution = createExecution(createPlugin());
    execution.createBackend(neverConnects);
    const ref = queued(execution, { isCompact: true, text: '/compact please', prompt: '/compact please' });

    await expect(execution.turnRequests.resolve(ref)).rejects.toThrow(/does not accept arguments/);
    execution.dispose();
  });

  it('shows the refusal in the resolver\'s words, not the neutral sentence', async () => {
    // The resolver refuses `/compact please` with a sentence a user can act on.
    // The run then finishes as `pre-dispatch-rejected`, and the adapter's
    // neutral wording for that — "The turn was rejected before it started, so
    // nothing ran." — says nothing about the argument that caused it. The smoke
    // matrix asks for the refusal, and the live row could only see that *some*
    // error arrived.
    const plugin = createPlugin();
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const execution = new CodexExecution(plugin, host.registry);
    host.registerBackend(execution.createBackendRegistration({
      create: () => new FakeConnection() as never,
    }));
    await host.start();
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: '/compact please' })));

    const errors = chunks.filter(chunk => chunk.type === 'error');
    expect(errors).toHaveLength(1);
    expect(String(errors[0].content)).toContain('does not accept arguments');
    execution.dispose();
  });

  it('stops the plan-limit badge asking a connection this composition disposed', async () => {
    // The reader is rebound per connection because one pointed at a dead daemon
    // answers nothing. Unload is that case with no rebinding to follow it: the
    // badge would keep calling `account/rateLimits/read` on a connection the
    // kernel has already taken down.
    const { runtime, execution, connection } = await createTurnHarness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'hello' })));
    const plugin = createPlugin();

    execution.dispose();
    await codexPlanUsageStore.refreshUsage({ plugin, providerId: 'codex' } as never);

    expect(connection.calls.filter(call => call.method === 'account/rateLimits/read'))
      .toEqual([]);
  });

  it('names the turn by the id the daemon can fork from', async () => {
    // The tab copies `assistantMessageId` onto the message, and a fork asks the
    // daemon to resume at it. A result id minted here names nothing in the
    // thread, so the fork fails to find its checkpoint — which is how the flip
    // broke forking without failing a single test.
    const { runtime, execution } = await createTurnHarness();

    await drain(runtime.query(runtime.prepareTurn({ text: 'hello' })));

    expect(runtime.consumeTurnMetadata()).toMatchObject({
      assistantMessageId: 'turn-1',
      wasSent: true,
    });
    execution.dispose();
  });

  it('reports the thread the daemon is on, and forgets it with the conversation', async () => {
    // A conversation learns its thread from the finished turn. Reporting only
    // the conversation's own binding is circular — it is empty until something
    // writes it — and reporting the daemon's thread *after* the tab moves on is
    // worse: the new conversation is saved pointing at the old thread.
    const { runtime, execution } = await createTurnHarness();
    runtime.syncConversationState({ id: 'conv-1' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'hello' })));

    expect(runtime.getSessionId()).toBe('thread-1');
    runtime.syncConversationState(null);
    expect(runtime.getSessionId()).toBeNull();
    execution.dispose();
  });

  it('asks for no result from a compaction, and does not insist on one in plan mode', async () => {
    // A compaction answers nothing by design and a plan turn answers with a
    // plan, so demanding a result reports a turn that worked as a failure.
    const plugin = createPlugin({ permissionMode: 'plan' });
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const execution = new CodexExecution(plugin, host.registry);
    const connection = new FakeConnection();
    connection.emptyTurn = true;
    host.registerBackend(execution.createBackendRegistration({ create: () => connection as never }));
    await host.start();
    const runtime = execution.createRuntime();

    const planned = await drain(runtime.query(runtime.prepareTurn({ text: 'plan it' })));
    const compacted = await drain(runtime.query(runtime.prepareTurn({ text: '/compact' })));

    expect(planned.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(compacted.filter(chunk => chunk.type === 'error')).toEqual([]);
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
    const { presenter } = execution.createInteractionPresenter(() => ({
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
    const { presenter } = execution.createInteractionPresenter(() => ({
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
  describe('auxiliary work, on the kernel', () => {
    /**
     * The path the three auxiliary services now take, end to end over the same
     * fake daemon the chat turns run on — the store, the retained thread, the
     * seam, and the launch that is deliberately not the chat's.
     *
     * Codex has no agent definition and no client-side filesystem, so every
     * property asserted here is a **thread parameter**. That is the whole of
     * what makes an unattended turn safe on this provider.
     */
    async function createAuxHarness(plugin: any = createPlugin()): Promise<{
      execution: CodexExecution;
      host: ExecutionKernelHost;
      daemons: FakeConnection[];
    }> {
      const host = new ExecutionKernelHost({
        storage: new TestDurableStorage(),
        scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      });
      const execution = new CodexExecution(plugin, host.registry);
      const daemons: FakeConnection[] = [];
      host.registerBackend(execution.createBackendRegistration({
        create: () => {
          const connection = new FakeConnection();
          daemons.push(connection);
          return connection as never;
        },
      }));
      await host.start();
      return { execution, host, daemons };
    }

    function threadStartOf(connection: FakeConnection): any {
      return connection.calls.find(call => call.method === 'thread/start')?.params;
    }

    it('answers a title on a daemon of its own, with approvals off', async () => {
      const { execution, host, daemons } = await createAuxHarness();

      const title = await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'The user asked about tomatoes.');

      expect(title).toBe('the answer');
      // Its own daemon, and nothing else has launched: no chat turn ran, so a
      // shared one would mean the auxiliary work had opened the conversation's
      // own app-server to generate a title.
      expect(daemons).toHaveLength(1);
      expect(threadStartOf(daemons[0])).toEqual({
        model: expect.any(String),
        cwd: VAULT_CWD,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        baseInstructions: 'Name the conversation.',
        experimentalRawEvents: true,
        // Kept out of the transcript store the chat path reads back, which is
        // this provider's version of "an auxiliary turn writes no history".
        persistExtendedHistory: false,
      });
      execution.dispose();
      await host.dispose();
    });

    it('stays read-only even when the chat is set to full access', async () => {
      const plugin = createPlugin({ permissionMode: 'full_access' });
      const { execution, host, daemons } = await createAuxHarness(plugin);

      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');

      // **The property every provider's auxiliary path has to hold, in this
      // provider's own terms.** A chat turn in full access runs
      // `danger-full-access` with approvals off, because the user asked for it
      // and is watching. An auxiliary turn is neither asked for nor watched, so
      // it is read-only whatever the chat is set to.
      expect(threadStartOf(daemons[0])).toMatchObject({
        approvalPolicy: 'never',
        sandbox: 'read-only',
      });
      execution.dispose();
      await host.dispose();
    });

    it('gives each purpose its own instructions and its own thread', async () => {
      const { execution, host, daemons } = await createAuxHarness();

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message');
      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');

      // The instructions are a thread parameter for this provider rather than a
      // file, and they are the caller's rather than the vault's: a title is
      // asked for by the prompt that asks for a title.
      expect(daemons).toHaveLength(2);
      expect(threadStartOf(daemons[0]).baseInstructions).toBe('Name the conversation.');
      expect(threadStartOf(daemons[1]).baseInstructions).toBe('Edit the selection.');
      execution.dispose();
      await host.dispose();
    });

    it('starts the auxiliary thread in the target the daemon was launched for', async () => {
      const { execution, host, daemons } = await createAuxHarness();

      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      // Carried over from the runner this replaced, where it was its own case:
      // the two targets Codex supports — this machine and a WSL distro —
      // disagree about every path there is, and a thread started in the wrong
      // one reads somewhere the user never pointed at.
      expect(threadStartOf(daemons[0]).cwd).toBe(VAULT_CWD);
      execution.dispose();
      await host.dispose();
    });

    it("keeps one runner's conversation and gives another its own", async () => {
      const { execution, host, daemons } = await createAuxHarness();
      const first = execution.createAuxRunner('inline');

      await first.query({ systemPrompt: 'Edit the selection.' }, 'make it shorter');
      await first.query({ systemPrompt: 'Edit the selection.' }, 'shorter still');
      await execution.createAuxRunner('inline')
        .query({ systemPrompt: 'Edit the selection.' }, 'a different edit');

      // Inline edit's second message has to reach the first one's thread, and a
      // second edit started elsewhere must not land in the middle of it.
      expect(daemons).toHaveLength(2);
      expect(daemons[0].calls.filter(call => call.method === 'thread/start')).toHaveLength(1);
      expect(daemons[0].calls.filter(call => call.method === 'turn/start')).toHaveLength(2);
      execution.dispose();
      await host.dispose();
    });

    it('ends the conversation on reset, and starts a new one after it', async () => {
      const { execution, host, daemons } = await createAuxHarness();
      const runner = execution.createAuxRunner('title-gen');

      await runner.query({ systemPrompt: 'Name the conversation.' }, 'first');
      runner.reset();
      await new Promise(resolve => { setTimeout(resolve, 0); });
      await runner.query({ systemPrompt: 'Name the conversation.' }, 'second');

      // What the title service does after every title: the daemon that generated
      // it is closed, and the next title launches its own.
      expect(daemons).toHaveLength(2);
      execution.dispose();
      await host.dispose();
    });

    it('names the model the caller chose on both the thread and the turn', async () => {
      const { execution, host, daemons } = await createAuxHarness();

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
        model: 'gpt-5.4-codex',
      }, 'the message');

      // The thread is started under whichever model this turn will run on, so a
      // caller that named one is not answered by a thread built for another.
      expect(threadStartOf(daemons[0]).model).toBe('gpt-5.4-codex');
      const turnStart = daemons[0].calls.find(call => call.method === 'turn/start');
      expect(turnStart?.params.model).toBe('gpt-5.4-codex');
      execution.dispose();
      await host.dispose();
    });

    it('falls back to the model the vault is set to when the caller names none', async () => {
      const { execution, host, daemons } = await createAuxHarness();

      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      // Inline edit and instruction refinement pass no model unless the user set
      // an override. `thread/start` requires one, so there is no "leave it to
      // the daemon" here — what it must not be is another provider's.
      const started = threadStartOf(daemons[0]);
      expect(typeof started.model).toBe('string');
      expect(started.model.length).toBeGreaterThan(0);
      // Not repeated on the turn: the thread already runs on it.
      const turnStart = daemons[0].calls.find(call => call.method === 'turn/start');
      expect(turnStart?.params.model).toBeUndefined();
      execution.dispose();
      await host.dispose();
    });

    it('reports what the daemon said when an auxiliary turn fails', async () => {
      const host = new ExecutionKernelHost({
        storage: new TestDurableStorage(),
        scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      });
      const execution = new CodexExecution(createPlugin(), host.registry);
      host.registerBackend(execution.createBackendRegistration({
        create: () => {
          const connection = new FakeConnection();
          connection.failTurn = 'You have exhausted your daily quota on this model.';
          return connection as never;
        },
      }));
      await host.start();

      // The alternative is the failure this migration exists to remove: an
      // auxiliary turn that answers with nothing and a title that silently never
      // appears.
      await expect(execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message')).rejects.toThrow('exhausted your daily quota');
      execution.dispose();
      await host.dispose();
    });

    it('starts a new thread when the instructions change under the same runner', async () => {
      const { execution, host, daemons } = await createAuxHarness();
      const runner = execution.createAuxRunner('instructions');

      await runner.query({ systemPrompt: 'Refine the instructions.' }, 'make this clearer');
      await runner.query({ systemPrompt: 'Refine them, briefly.' }, 'and again');

      // Codex takes its instructions on `thread/start` and a thread cannot be
      // told new ones, so the launch key has to carry them — otherwise a system
      // prompt edited in settings goes on being ignored for as long as the
      // daemon lives, which is what the legacy runner did.
      expect(daemons).toHaveLength(2);
      expect(threadStartOf(daemons[1]).baseInstructions).toBe('Refine them, briefly.');
      execution.dispose();
      await host.dispose();
    });

    it('closes the auxiliary daemons when the backend is disposed', async () => {
      const disposed: number[] = [];
      const host = new ExecutionKernelHost({
        storage: new TestDurableStorage(),
        scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      });
      const execution = new CodexExecution(createPlugin(), host.registry);
      host.registerBackend(execution.createBackendRegistration({
        create: () => {
          const connection = new FakeConnection();
          const index = disposed.length;
          disposed.push(0);
          connection.dispose = async () => { disposed[index] += 1; };
          return connection as never;
        },
      }));
      await host.start();
      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message');

      // The other half of the pair, and the one the composition's own disposal
      // hides: `main.ts` takes the host down too, and a backend that shut down
      // without closing its auxiliary port would leave an idle CLI behind
      // whenever the composition was not disposed first.
      await host.dispose();

      expect(disposed.some(count => count > 0)).toBe(true);
      execution.dispose();
    });

    it('closes the auxiliary daemons when the composition goes away', async () => {
      const disposed: number[] = [];
      const host = new ExecutionKernelHost({
        storage: new TestDurableStorage(),
        scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
      });
      const execution = new CodexExecution(createPlugin(), host.registry);
      host.registerBackend(execution.createBackendRegistration({
        create: () => {
          const connection = new FakeConnection();
          const index = disposed.length;
          disposed.push(0);
          connection.dispose = async () => { disposed[index] += 1; };
          return connection as never;
        },
      }));
      await host.start();
      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      // The composition alone, without its host: that is the order `main.ts`
      // unloads in — every composition first, the kernel host after, and the
      // host's disposal is not awaited. The backend closes these too; this is
      // the one that runs first.
      execution.dispose();

      // A plugin unload with an idle auxiliary CLI still running is the leak the
      // retained daemon would otherwise be.
      for (let attempt = 0; attempt < 50 && disposed.every(count => count === 0); attempt += 1) {
        await new Promise(resolve => { setTimeout(resolve, 0); });
      }
      expect(disposed.some(count => count > 0)).toBe(true);
      await host.dispose();
    });
  });

});
