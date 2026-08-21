import '@/providers';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { GrokExecution } from '@/app/execution/grok/GrokExecutionComposition';
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
    modeIsUnsupported?: boolean;
    reportsNativeModes?: boolean;
    reportsNoModes?: boolean;
    sessionIsGone?: boolean;
    sessionLoadFails?: boolean;
    streamsNothing?: boolean;
  } = {}): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
    models: string[];
    modes: AcpSetSessionModeRequest[];
    configOptions: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
  } {
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const models: string[] = [];
    const modes: AcpSetSessionModeRequest[] = [];
    const configOptions: unknown[] = [];
    const permissions: Array<Promise<AcpRequestPermissionResponse>> = [];
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
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
            return { stopReason: 'end_turn' };
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
          close: async () => 'confirmed' as const,
        };
        return client;
      },
    };
    return { factory, startupRefs, prompts, models, modes, configOptions, permissions };
  }

  async function createHarness(options: {
    asksPermission?: boolean;
    plugin?: any;
    modeIsUnsupported?: boolean;
    reportsNativeModes?: boolean;
    reportsNoModes?: boolean;
    sessionIsGone?: boolean;
    sessionLoadFails?: boolean;
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
    runtime.setAskUserQuestionCallback(async (request: unknown) => {
      asked.push(request);
      return { 'What do you want to do?': 'notes' };
    });

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

  it('cancels a question whose session belongs to no open tab', async () => {
    const { execution, host } = await createHarness();

    await expect((execution as any).askUserQuestion({
      questions: [{ multiSelect: false, options: [], question: 'anyone?' }],
      sessionId: 'nobodys-session',
    })).resolves.toEqual({ outcome: 'cancelled' });

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
    ))).toEqual([expect.stringContaining('session may no longer exist')]);
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
      { id: 'conversation-1', providerState: {}, sessionId: null } as never,
    );

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    const updates = runtime.buildSessionUpdates({
      conversation: { id: 'conversation-1' } as never,
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
    runtime.setApprovalCallback(async (toolName: string, _input: unknown, description: string) => {
      asked.push({ toolName, description });
      return 'allow';
    });

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
});
