import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, type InteractionId, runId } from '@/core/execution/ExecutionIds';
import type { StreamChunk } from '@/core/types';
import { JsonRpcErrorResponse } from '@/providers/acp';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpRequestPermissionResponse,
  AcpSessionNotification,
  AcpSetSessionModeRequest,
} from '@/providers/acp/types';
import { GROK_EXECUTION_DESCRIPTOR } from '@/providers/grok/execution/GrokExecutionBackend';
import { GrokExecution } from '@/providers/grok/execution/GrokExecutionComposition';
import { updateGrokProviderSettings } from '@/providers/grok/settings';

/**
 * The half of the Grok flip that only exists in production.
 *
 * The backend it builds is the shared managed-ACP one and is tested as that.
 * What this file is for is everything the backend is deliberately ignorant of:
 * the command line Grok is started with, the two flags that belong to the
 * launch rather than to a session, and the ordering its own settings are
 * applied in.
 */
describe('Grok execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'3'.repeat(32)}`);
  const RUN_ID = runId(`run-${'3'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'grok-tab' };

  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  function createPlugin(overrides: Record<string, unknown> = {}): any {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-grok-composition-'));
    vaults.push(vault);
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
      ...overrides,
    };
    updateGrokProviderSettings(settings, { enabled: true });
    return {
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => '/usr/local/bin/grok',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
    };
  }

  /** One ACP agent, without an agent. */
  function createFakeAcp(options: {
    asksPermission?: boolean;
    cancelsTheTurn?: boolean;
    modeIsUnsupported?: boolean;
    reportsNativeModes?: boolean;
    reportsNoModes?: boolean;
    sessionIsGone?: boolean;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
    streamsNothing?: boolean;
  } = {}): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
    models: string[];
    modes: AcpSetSessionModeRequest[];
    configOptions: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    closes: string[];
    askAnything: () => Promise<AcpRequestPermissionResponse>;
  } {
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const models: string[] = [];
    const modes: AcpSetSessionModeRequest[] = [];
    const configOptions: unknown[] = [];
    const closes: string[] = [];
    const permissions: Array<Promise<AcpRequestPermissionResponse>> = [];
    let lastPermissionRequest: ManagedAcpClientFactoryInput['requestPermission'] | undefined;
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        lastPermissionRequest = input.requestPermission;
        const ask = (): void => {
          permissions.push(input.requestPermission({
            sessionId: 'grok-session',
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'no', kind: 'reject_once', name: 'Deny' },
            ],
            // The kind is what names this one. A title of "Shell" matches
            // nothing in the vocabulary and would be read back at the user
            // verbatim; `execute` is what makes it a shell command.
            toolCall: {
              toolCallId: 'tool-1',
              title: 'Shell',
              kind: 'execute',
              rawInput: { command: 'ls' },
            },
          }));
        };
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          newSession: async () => (options.reportsNativeModes ? {
            sessionId: 'grok-session',
            modes: {
              availableModes: [
                { id: 'ask', name: 'Safe' },
                { id: 'always-approve', name: 'Auto-approve' },
              ],
              currentModeId: 'ask',
            },
          } : options.reportsNoModes ? {
            sessionId: 'grok-session',
          } : {
            sessionId: 'grok-session',
            configOptions: [{
              category: 'mode',
              currentValue: 'default',
              id: 'mode',
              name: 'Mode',
              options: [{ name: 'Plan', value: 'plan' }],
              type: 'select',
            }] as never,
          }),
          loadSession: async request => {
            if (options.sessionIsGone) {
              // What Grok answers for a session whose directory is not there:
              // a filesystem error, with the session never named.
              throw new JsonRpcErrorResponse('session/load', -32603, 'Path not found.', {
                code: 'FS_NOT_FOUND',
                detail: 'No such file or directory (os error 2)',
              });
            }
            if (options.sessionLoadRefusal) {
              // What an unauthenticated CLI answers a *load* with: nothing
              // about the session, and nothing a new chat would fix. Recorded
              // from `kimi acp` and `qwen --acp`, which answer `session/new`
              // and `session/load` with the same sentence.
              throw new JsonRpcErrorResponse('session/load', -32000, options.sessionLoadRefusal);
            }
            if (options.sessionLoadFails) {
              // What Grok answers for a session it no longer has: a service
              // failure that names nothing about the session.
              throw new JsonRpcErrorResponse('session/load', -32603, 'Internal error');
            }
            return { sessionId: request.sessionId };
          },
          prompt: async request => {
            prompts.push(request);
            if (options.asksPermission) {
              // ACP asks before it runs anything, over a pipe: the work that
              // follows the answer starts a task later, never on the same
              // microtask drain.
              ask();
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            if (!options.streamsNothing) {
              notify?.({
                sessionId: 'grok-session',
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  messageId: 'assistant-message',
                  content: { type: 'text', text: 'the answer' },
                },
              });
            }
            return { stopReason: options.cancelsTheTurn ? 'cancelled' : 'end_turn' };
          },
          setMode: async request => {
            if (options.modeIsUnsupported) {
              // What a release that carries its policy on the command line
              // answers: it has no mode method at all.
              throw new JsonRpcErrorResponse('session/set_mode', -32601, 'method not found');
            }
            modes.push(request);
            return {};
          },
          setModel: async request => {
            models.push(request.modelId);
            return {};
          },
          setConfigOption: async request => {
            configOptions.push(request);
            return { configOptions: [] };
          },
          cancel: () => undefined,
          onSessionNotification: listener => {
            notify = listener;
            return () => { notify = undefined; };
          },
          onConnectionLost: () => () => undefined,
          close: async () => {
            closes.push(input.startupRef);
            return 'confirmed' as const;
          },
        };
        return client;
      },
    };
    return {
      factory, startupRefs, prompts, models, modes, configOptions, permissions, closes,
      askAnything: async () => {
        if (!lastPermissionRequest) throw new Error('Nothing has launched to ask.');
        return lastPermissionRequest({
          sessionId: 'grok-session',
          options: [
            { optionId: 'yes', kind: 'allow_once', name: 'Allow' },
            { optionId: 'no', kind: 'reject_once', name: 'Deny' },
          ],
          toolCall: { toolCallId: 'tool-9', title: 'read', kind: 'read', rawInput: { path: 'note.md' } },
        });
      },
    };
  }

  async function createHarness(options: {
    asksPermission?: boolean;
    cancelsTheTurn?: boolean;
    plugin?: any;
    modeIsUnsupported?: boolean;
    reportsNativeModes?: boolean;
    reportsNoModes?: boolean;
    sessionIsGone?: boolean;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
    streamsNothing?: boolean;
  } = {}): Promise<{
    plugin: any;
    execution: GrokExecution;
    host: ExecutionKernelHost;
    startupRefs: string[];
    prompts: unknown[];
    models: string[];
    modes: AcpSetSessionModeRequest[];
    configOptions: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    closes: string[];
    askAnything: () => Promise<AcpRequestPermissionResponse>;
    events: ExecutionEventEnvelope[];
  }> {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const plugin = options.plugin ?? createPlugin();
    const execution = new GrokExecution(plugin, host.registry);
    const fake = createFakeAcp(options);
    host.registerBackend(execution.createBackendRegistration(fake.factory));
    await host.start();
    await host.registry.createSession({
      backendId: GROK_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => events.push(envelope));
    return { execution, host, events, plugin, ...fake };
  }

  async function waitForInteraction(
    events: ExecutionEventEnvelope[],
  ): Promise<{ interactionId: InteractionId; presentationRef: string }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const opened = events.find(envelope => envelope.event.kind === 'interaction-opened');
      if (opened?.event.kind === 'interaction-opened') {
        return {
          interactionId: opened.event.interaction.interactionId,
          presentationRef: opened.event.interaction.presentationRef,
        };
      }
      await new Promise(resolve => { setTimeout(resolve, 5); });
    }
    throw new Error('No interaction was opened.');
  }

  async function settle(
    host: ExecutionKernelHost,
    events: ExecutionEventEnvelope[],
  ): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await host.registry.waitForIdle();
      if (events.some(envelope => envelope.event.kind === 'terminal')) {
        return;
      }
      await new Promise(resolve => { setTimeout(resolve, 5); });
    }
    throw new Error(`The run never reached a terminal: ${JSON.stringify(
      events.map(envelope => envelope.event.kind),
    )}`);
  }

  async function runTurn(
    execution: GrokExecution,
    host: ExecutionKernelHost,
    events: ExecutionEventEnvelope[],
    dynamic?: { modelId?: string; modeId?: string },
  ): Promise<void> {
    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
      ...(dynamic ? { dynamic } : {}),
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

  /** A Grok session on disk, as the CLI leaves one behind. */
  function writeSessionLog(vault: string, sessionId: string, contents: {
    signals?: Record<string, unknown>;
    updates?: readonly Record<string, unknown>[];
  }): string {
    const sessionDir = join(
      vault,
      '.grimoire',
      'grok',
      'sessions',
      encodeURIComponent(vault),
      sessionId,
    );
    mkdirSync(sessionDir, { recursive: true });
    // The marker the path resolver looks for; without it no other file in this
    // directory is found, which is how the CLI's own layout works.
    writeFileSync(join(sessionDir, 'chat_history.jsonl'), '');
    if (contents.signals) {
      writeFileSync(join(sessionDir, 'signals.json'), JSON.stringify(contents.signals));
    }
    if (contents.updates) {
      writeFileSync(
        join(sessionDir, 'updates.jsonl'),
        contents.updates.map(row => JSON.stringify(row)).join('\n'),
      );
    }
    return sessionDir;
  }

  it('renders a turn a tab can draw, and learns the session it is on', async () => {
    // The runtime half end to end: a tab prepares a turn, the kernel dispatches
    // it, the agent answers, and what comes back is what the surface draws.
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    // Without this a tab starts a new session every turn: no resume across a
    // reload, and nothing to hydrate from.
    expect(runtime.getSessionId()).toBe('grok-session');
    execution.dispose();
    await host.dispose();
  });

  it('fills the context reading Grok never sends over the wire', async () => {
    // Grok's wire recording observes seven update types and no context window
    // at all. Its own session log has one, and the turn is still open while the
    // answer is committed — which is the only reason this reaches the badge of
    // the turn that earned it.
    const plugin = createPlugin();
    const vault = plugin.app.vault.adapter.basePath;
    writeSessionLog(vault, 'grok-session', {
      signals: { contextTokensUsed: 12_000, contextWindowTokens: 256_000 },
    });
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({
        contextTokens: 12_000,
        contextWindow: 256_000,
        contextWindowIsAuthoritative: true,
      }),
    }));
    execution.dispose();
    await host.dispose();
  });

  it('asks for a mode in the session own words, never in Grimoire\'s', async () => {
    // A vault that has not opened a session yet holds Grimoire's toolbar modes,
    // whose ids are not Grok's. Sending one reaches `session/set_mode` as
    // `-32602 Invalid params` and aborts the turn before the prompt — issue #52.
    const { execution, host, modes } = await createHarness({ reportsNativeModes: true });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(modes).toEqual([
      { modeId: 'always-approve', sessionId: 'grok-session' },
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('sends no mode at all to a session that reported none', async () => {
    // A release that carries its permission policy on the command line
    // advertises no modes, and Grimoire's own toolbar ids mean nothing to it.
    const { execution, host, modes, configOptions } = await createHarness({
      reportsNoModes: true,
    });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(modes).toEqual([]);
    expect(configOptions).toEqual([]);
    execution.dispose();
    await host.dispose();
  });

  it('puts a question Grok asked to the tab whose session it came in on', async () => {
    // ACP's `ask_user_question` is a server request with its own answer shape,
    // not one of the interactions the kernel carries — and a question nobody is
    // shown is a turn waiting forever.
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();
    const asked: unknown[] = [];
    runtime.installInteractions({ question: async (request: unknown) => {
      asked.push(request);
      return { 'What do you want to do?': 'notes' };
    } });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    const answer = await (execution as any).askUserQuestion({
      questions: [{
        multiSelect: false,
        options: [{ description: 'Notes', label: 'notes' }],
        question: 'What do you want to do?',
      }],
      sessionId: 'grok-session',
      toolCallId: 'call-1',
    });

    expect(answer).toEqual({
      annotations: {},
      answers: { 'What do you want to do?': 'notes' },
      outcome: 'accepted',
    });
    expect(asked).toHaveLength(1);
    execution.dispose();
    await host.dispose();
  });

  it('lets go of a conversation\'s sessions when the tab moves to another', async () => {
    // The callbacks registered per native session read *this tab's* current
    // state. Left behind when the tab moved on, an entry under the previous
    // conversation's session id answered a late-settling run of that
    // conversation with the new conversation's session directory — and would
    // have put its question to the new conversation's user.
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();
    runtime.installInteractions({ question: async () => ({ 'anyone?': 'yes' }) });
    runtime.syncConversationState(
      { id: 'conversation-1', providerState: {}, sessionId: null },
    );
    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    runtime.syncConversationState(
      { id: 'conversation-2', providerState: {}, sessionId: null },
    );

    await expect((execution as any).askUserQuestion({
      questions: [{ multiSelect: false, options: [], question: 'anyone?' }],
      sessionId: 'grok-session',
    })).resolves.toEqual({ outcome: 'cancelled' });
    execution.dispose();
    await host.dispose();
  });

  it('cancels a question whose session belongs to no open tab', async () => {
    const { execution, host } = await createHarness();

    await expect((execution as any).askUserQuestion({
      questions: [{ multiSelect: false, options: [], question: 'anyone?' }],
      sessionId: 'nobodys-session',
    })).resolves.toEqual({ outcome: 'cancelled' });

    execution.dispose();
    await host.dispose();
  });

  it('counts what a cancelled turn spent', async () => {
    // A turn the user stopped still spent tokens, and for many Grok turns the
    // only record of what they cost is the session log. The legacy runtime read
    // it when the prompt returned, whatever the stop reason.
    const plugin = createPlugin();
    const vault = plugin.app.vault.adapter.basePath;
    writeSessionLog(vault, 'grok-session', {
      signals: { contextTokensUsed: 4_096, contextWindowTokens: 500_000 },
    });
    const { execution, host } = await createHarness({ plugin, cancelsTheTurn: true });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({ contextTokens: 4_096 }),
    }));
    execution.dispose();
    await host.dispose();
  });

  it('keeps the answer Grok wrote down but never sent', async () => {
    // Grok finishes turns whose final message never reaches ACP while writing
    // the answer to its own session log. Before that log was read back, this
    // was an empty chat bubble or a credentials error on a turn the provider
    // had actually completed.
    const plugin = createPlugin();
    const vault = plugin.app.vault.adapter.basePath;
    const sessionDir = join(
      vault,
      '.grimoire',
      'grok',
      'sessions',
      encodeURIComponent(vault),
      'grok-session',
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'chat_history.jsonl'),
      [
        JSON.stringify({ type: 'user', content: 'what now?' }),
        JSON.stringify({ type: 'assistant', content: 'the answer it never sent' }),
      ].join('\n'),
    );
    const { execution, host } = await createHarness({ plugin, streamsNothing: true });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => (
      chunk.type === 'text' && chunk.content.includes('the answer it never sent')
    ))).toBe(true);
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('starts a new session when the saved one is not on disk any more', async () => {
    // Grok reports a session it cannot find as a filesystem error and never
    // names the session, so the shared heuristic reads it as a hard failure and
    // refuses the turn. The legacy runtime's resume policy was the opposite:
    // drop the binding, create a session, answer the turn.
    const { execution, host } = await createHarness({ sessionIsGone: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'grok-session-deleted' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'error')).toBe(false);
    expect(chunks.some(chunk => (
      chunk.type === 'text' && chunk.content.includes('the answer')
    ))).toBe(true);
    // The tab is on the session the turn actually ran in, which is what the
    // conversation is then saved pointing at.
    expect(runtime.getSessionId()).toBe('grok-session');
    execution.dispose();
    await host.dispose();
  });

  it('says what a turn that never started needs the person to do', async () => {
    // Grok answers an unknown session with a generic service failure that names
    // nothing, so without provider wording the conversation repeats the neutral
    // sentence on every turn with nothing to act on.
    const { execution, host } = await createHarness({ sessionLoadFails: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'grok-session-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => (
      (chunk).content
    ))).toEqual([
      'Grok Build could not open the session this conversation was resumed from. Grok Build said: '
        + 'Internal error. Starting a new chat helps only if the session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('says what the agent said when the session was not what stopped it', async () => {
    // The refusal a live run found, one path over from the one it was fixed on.
    // An unauthenticated CLI refuses `session/load` with a sentence that has
    // nothing to do with the session, and the advice above — start a new chat —
    // then fails identically every time it is followed. Both halves travel, the
    // agent's first, and the advice says out loud what it depends on.
    const { execution, host } = await createHarness({
      sessionLoadRefusal: 'Authentication required',
    });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'grok-session-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content)).toEqual([
      'Grok Build could not open the session this conversation was resumed from. '
        + 'Grok Build said: Authentication required. Starting a new chat helps only if the '
        + 'session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('saves the conversation pointing at the transcript it can be hydrated from', async () => {
    // A Grok session id alone hydrates nothing: the transcript is a directory
    // under the managed home, and the conversation is saved pointing at it.
    const plugin = createPlugin();
    const vault = plugin.app.vault.adapter.basePath;
    const sessionDir = writeSessionLog(vault, 'grok-session', { signals: {} });
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    runtime.syncConversationState(
      { id: 'conversation-1', providerState: {}, sessionId: null },
    );

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    const updates = runtime.buildSessionUpdates({
      conversation: { id: 'conversation-1' },
      sessionInvalidated: false,
    });

    expect(updates.updates).toEqual({
      sessionId: 'grok-session',
      providerState: { sessionDirPath: sessionDir, workspacePath: vault },
    });
    execution.dispose();
    await host.dispose();
  });

  it('asks the tab before a command runs, and answers the agent with what it chose', async () => {
    const { execution, host, permissions } = await createHarness({ asksPermission: true });
    const runtime = execution.createRuntime();
    const asked: Array<{ toolName: string; description: string }> = [];
    runtime.installInteractions({ approval: async (toolName: string, _input: unknown, description: string) => {
      asked.push({ toolName, description });
      return 'allow';
    } });

    await drain(runtime.query(runtime.prepareTurn({ text: 'run it' })));

    expect(asked).toEqual([expect.objectContaining({
      toolName: 'bash',
      description: 'Grok Build wants to run a shell command.',
    })]);
    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
    execution.dispose();
    await host.dispose();
  });

  it('carries a whole turn from the reference to the ACP prompt and back', async () => {
    const { execution, host, prompts, events } = await createHarness();

    await runTurn(execution, host, events);

    expect(prompts).toHaveLength(1);
    expect(events.find(envelope => envelope.event.kind === 'terminal')?.event)
      .toMatchObject({ terminal: 'succeeded' });
    execution.dispose();
    await host.dispose();
  });

  it('asks before it runs a command, in Grok own words', async () => {
    // ACP asks the client before an edit or a command, and Grok names its
    // permissions by the tool and the kind together — a distinction the shared
    // bridge does not make and its vocabulary does.
    const { execution, host, permissions, events } = await createHarness({
      asksPermission: true,
    });

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'run it' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    const opened = await waitForInteraction(events);

    expect(execution.interactionBridge.presentation(opened.presentationRef))
      .toEqual(expect.objectContaining({
        toolName: 'bash',
        description: 'Grok Build wants to run a shell command.',
        options: [
          { responseId: 'allow-once', label: 'Allow', presentation: 'allow' },
          { responseId: 'reject-once', label: 'Deny', presentation: 'reject' },
        ],
      }));

    await host.registry.resolveInteraction({
      interactionId: opened.interactionId,
      responseId: 'allow-once',
      resolvedAt: 1,
    });
    await settle(host, events);

    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
    execution.dispose();
    await host.dispose();
  });

  it('starts the process Grok is actually spoken to through', async () => {
    const { execution, host, startupRefs, events } = await createHarness();

    await runTurn(execution, host, events);

    const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
    // Grok is `agent … stdio`, and the vault is the working directory rather
    // than an argument — the same rule every ACP launch here follows.
    // The effort the vault is set to is on the command line too, which is what
    // makes it a launch concern rather than a session one.
    expect(launch).toMatchObject({
      executable: '/usr/local/bin/grok',
      arguments: ['agent', '--always-approve', '--reasoning-effort', 'high', 'stdio'],
    });
    expect(launch.environment.GROK_HOME).toContain('.grimoire');
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process when the reasoning effort changes', async () => {
    const plugin = createPlugin();
    plugin.settings.savedProviderEffort = { grok: 'high' };
    const { execution, host } = await createHarness({ plugin });

    const before = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'first' }],
    }));
    // Where the setting actually lives for a provider: the coordinator restores
    // the per-provider projection over the top-level value on every snapshot,
    // so writing the top-level one changes nothing.
    (plugin.settings.savedProviderEffort as Record<string, string>).grok = 'low';
    const after = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'second' }],
    }));

    // Effort is an argument for this provider, not a session setting: a running
    // process cannot be told about it, so the fingerprint has to say so.
    expect(after.restartFingerprint).not.toBe(before.restartFingerprint);
    const launch = await execution.turnRequests.resolveLaunch(after.startupRef);
    expect(launch.arguments)
      .toEqual(['agent', '--always-approve', '--reasoning-effort', 'low', 'stdio']);
    execution.dispose();
    await host.dispose();
  });

  it('sets the model and the mode through the methods Grok has for them', async () => {
    const { execution, host, models, modes, events } = await createHarness();

    await runTurn(execution, host, events, { modelId: 'grok-4.6', modeId: 'plan' });

    // Not config options: Grok has dedicated ACP methods for both, and this is
    // the ordering its own runtime applies them in.
    expect(models).toEqual(['grok-4.6']);
    expect(modes).toEqual([expect.objectContaining({ modeId: 'plan', sessionId: 'grok-session' })]);
    execution.dispose();
    await host.dispose();
  });

  it('falls back to the config option when the release has no mode method', async () => {
    const { execution, host, configOptions, events } = await createHarness({
      modeIsUnsupported: true,
    });

    await runTurn(execution, host, events, { modeId: 'plan' });

    // A release that carries its policy on the command line answers "method not
    // found" for the mode; the option the session advertised is what is left.
    expect(configOptions).toEqual([expect.objectContaining({
      configId: 'mode',
      value: 'plan',
    })]);
    execution.dispose();
    await host.dispose();
  });

  it('falls back to the command the CLI actually installs', async () => {
    const plugin = createPlugin();
    // Nothing resolved: no absolute path in settings, nothing found on PATH.
    // What is spawned then is this string. It happens to equal the provider id
    // for this provider and did *not* for MiMoCode, where the flip shipped
    // `mimocode` for a binary called `mimo` — so the property is pinned
    // everywhere rather than only where it once broke.
    plugin.getResolvedProviderCliPath = () => null;
    const { execution, host } = await createHarness({ plugin });

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    expect(launch.executable).toBe('grok');
    execution.dispose();
    await host.dispose();
  });

  describe('auxiliary work, on the kernel', () => {
    /**
     * The path the three auxiliary services now take, end to end over the same
     * fake agent the chat turns run on — the store, the retained process, the
     * seam, and the launch that is deliberately not the chat's.
     *
     * What is different from the three OpenCode forks is what is asserted here:
     * there is no agent to set the session to, so every one of these properties
     * is a property of the **command line and the managed home**.
     */
    it('answers a title on a process of its own, under its own policy', async () => {
      const plugin = createPlugin();
      const { execution, host, startupRefs, prompts, configOptions } = await createHarness({ plugin });

      const title = await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'The user asked about tomatoes.');

      expect(title).toBe('the answer');
      // Its own launch, and nothing else has launched: no chat turn ran, so a
      // shared process would mean the auxiliary work had opened the
      // conversation's own CLI to generate a title.
      expect(startupRefs).toHaveLength(1);
      expect(prompts).toHaveLength(1);
      // **Nothing is set on the session.** The forks send the agent id here;
      // this provider has no agent, and a `mode` config option applied to an
      // auxiliary session would be setting it to one of the vault's chat modes.
      expect(configOptions).toHaveLength(0);
      const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
      // What actually makes this turn safe is on the command line, which is why
      // a change to it restarts the process rather than reconfiguring a session,
      // and why nothing on the session had to say it.
      expect(launch.arguments).toEqual(['agent', '--reasoning-effort', 'high', 'stdio']);
      expect(launch.executable).toBe('/usr/local/bin/grok');
      execution.dispose();
      await host.dispose();
    });

    it('writes each purpose its own managed home, with its own permission mode', async () => {
      const plugin = createPlugin();
      const { execution, host } = await createHarness({ plugin });
      const vault = plugin.app.vault.adapter.basePath as string;

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message');
      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');

      const homeOf = (purpose: string): string => join(
        vault, '.grimoire', 'grok', 'auxiliary', purpose,
      );
      // The config the launched process reads its policy out of. Asserting the
      // launch flag alone would prove the argument, not the mode the CLI ends up
      // in — for this provider both are written, and they have to agree.
      expect(readFileSync(join(homeOf('title-gen'), 'managed_config.toml'), 'utf8'))
        .toContain('permission_mode = "plan"');
      // An inline edit reads the note around what it is editing, so its turn is
      // launched able to ask rather than unable to act.
      expect(readFileSync(join(homeOf('inline'), 'managed_config.toml'), 'utf8'))
        .toContain('permission_mode = "ask"');
      // Each purpose keeps its own instructions, so a title's cannot be the ones
      // an edit runs under — and its own `GROK_HOME`, so neither shares a
      // session store with the other or with the chat.
      expect(readFileSync(join(homeOf('inline'), 'system.md'), 'utf8'))
        .toContain('Edit the selection.');
      expect(existsSync(join(homeOf('title-gen'), 'system.md'))).toBe(true);
      execution.dispose();
      await host.dispose();
    });

    it('launches the auxiliary process into its own GROK_HOME', async () => {
      const plugin = createPlugin();
      const { execution, host, startupRefs } = await createHarness({ plugin });
      const vault = plugin.app.vault.adapter.basePath as string;

      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
      // The home is what the process reads its config and system prompt from,
      // and it is the partitioning this provider has that the forks do not: a
      // shared home would put an auxiliary session in the conversation's store.
      expect(launch.environment.GROK_HOME).toBe(
        join(vault, '.grimoire', 'grok', 'auxiliary', 'instructions'),
      );
      execution.dispose();
      await host.dispose();
    });

    it('gives the reading purpose a filesystem and the others none', async () => {
      const { execution, host, startupRefs } = await createHarness();

      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');
      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message');

      // **The forks decide this in an agent definition and Grok cannot.** With
      // nothing to deny a read, the only thing that can say "this purpose reads
      // nothing" is the client, and it says it in the handshake by being built
      // without a delegate — which is chosen per launch, so the launch has to
      // carry the answer.
      expect(execution.turnRequests.auxiliaryReadsFiles(startupRefs[0])).toBe(true);
      expect(execution.turnRequests.auxiliaryReadsFiles(startupRefs[1])).toBe(false);
      execution.dispose();
      await host.dispose();
    });

    it('tells the agent no rather than cutting its turn off', async () => {
      const { execution, host, askAnything } = await createHarness();

      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');

      // An auxiliary turn has no surface to raise a prompt on. But this one is
      // launched in `ask` mode — it is *able* to run the tool it is asking
      // about — so it is refused with the agent's own reject option, which it
      // can report and work around. A cancellation would abandon the edit.
      await expect(askAnything()).resolves.toEqual({
        outcome: { optionId: 'no', outcome: 'selected' },
      });
      execution.dispose();
      await host.dispose();
    });

    it('launches grok from PATH when no CLI path is configured', async () => {
      const plugin = createPlugin();
      // Nothing resolved: no absolute path in settings, nothing found on PATH.
      // Carried over from the runner this replaced, where it was its own case:
      // the auxiliary launch builds its own environment and would otherwise be
      // the one place the fallback was missing.
      plugin.getResolvedProviderCliPath = () => null;
      const { execution, host, startupRefs } = await createHarness({ plugin });

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message');

      const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
      expect(launch.executable).toBe('grok');
      execution.dispose();
      await host.dispose();
    });

    it("keeps one runner's conversation and gives another its own", async () => {
      const { execution, host, startupRefs } = await createHarness();
      const first = execution.createAuxRunner('inline');

      await first.query({ systemPrompt: 'Edit the selection.' }, 'make it shorter');
      await first.query({ systemPrompt: 'Edit the selection.' }, 'shorter still');
      await execution.createAuxRunner('inline')
        .query({ systemPrompt: 'Edit the selection.' }, 'a different edit');

      // Inline edit's second message has to reach the first one's session, and
      // a second edit started elsewhere must not land in the middle of it.
      expect(startupRefs).toHaveLength(2);
      execution.dispose();
      await host.dispose();
    });

    it('ends the conversation on reset, and starts a new one after it', async () => {
      const { execution, host, startupRefs, closes } = await createHarness();
      const runner = execution.createAuxRunner('title-gen');

      await runner.query({ systemPrompt: 'Name the conversation.' }, 'first');
      runner.reset();
      await new Promise(resolve => { setTimeout(resolve, 0); });
      await runner.query({ systemPrompt: 'Name the conversation.' }, 'second');

      // What the title service does after every title: the process that
      // generated it is closed, and the next title launches its own.
      expect(closes).toHaveLength(1);
      expect(startupRefs).toHaveLength(2);
      execution.dispose();
      await host.dispose();
    });

    it('applies the model the caller chose, through the setter this agent has', async () => {
      const { execution, host, models, configOptions } = await createHarness();

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
        model: 'grok:openai/gpt-5.4',
      }, 'the message');

      // `session/set_model`, which is one of Grok's differences from the forks:
      // they carry the model as a config option because that is what their agent
      // answers, and applying it that way here would set a configuration this
      // agent does not have.
      expect(models).toEqual(['openai/gpt-5.4']);
      expect(configOptions).toHaveLength(0);
      execution.dispose();
      await host.dispose();
    });

    it('falls back to the model the chat is set to when the caller names none', async () => {
      const plugin = createPlugin({
        savedProviderModel: { grok: 'grok:openai/gpt-5.4' },
        visibleModels: ['openai/gpt-5.4'],
      });
      const { execution, host, models } = await createHarness({ plugin });

      // Inline edit and instruction refinement pass no model unless the user
      // set an override, and the runner this replaced applied the chat's
      // selection to them. Without this an auxiliary turn silently runs on
      // whatever the CLI defaults to, which is a different model and a different
      // bill from the one the vault is configured for.
      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      expect(models).toEqual(['openai/gpt-5.4']);
      execution.dispose();
      await host.dispose();
    });

    it('applies nothing when the vault has chosen no model of its own', async () => {
      const { execution, host, models } = await createHarness();

      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      // The default selection is this provider's synthetic id, which names no
      // model at all. Sending it would ask the agent for a model that does not
      // exist rather than leaving it on its own default.
      expect(models).toHaveLength(0);
      execution.dispose();
      await host.dispose();
    });

    it('closes the auxiliary processes when the composition goes away', async () => {
      const { execution, host, closes } = await createHarness();
      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      // The composition alone, without its host: that is the order `main.ts`
      // unloads in — every composition first, the kernel host after, and the
      // host's disposal is not awaited. The backend closes these too; this is
      // the one that runs first.
      execution.dispose();

      // A plugin unload with an idle auxiliary CLI still running is the leak
      // the retained process would otherwise be.
      for (let attempt = 0; attempt < 50 && closes.length === 0; attempt += 1) {
        await new Promise(resolve => { setTimeout(resolve, 0); });
      }
      expect(closes).toHaveLength(1);
      await host.dispose();
    });
  });

});
