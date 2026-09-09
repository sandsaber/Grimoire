import '@/providers';

import { mkdtempSync, rmSync } from 'node:fs';
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
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';
import { DevinContentPresenter } from '@/providers/devin/execution/DevinContentPresenter';
import { DEVIN_EXECUTION_DESCRIPTOR } from '@/providers/devin/execution/DevinExecutionBackend';
import { DevinExecution } from '@/providers/devin/execution/DevinExecutionComposition';
import {
  getDevinProviderSettings,
  updateDevinProviderSettings,
} from '@/providers/devin/settings';

/**
 * The half of the Devin composition that only exists in production.
 *
 * The backend takes three opaque references — the turn, the process to spawn,
 * the session config to apply — and knows what is inside none of them. This
 * module is the only place that knows all three.
 *
 * **What the fake answers with was observed from Devin.** The `session/new`
 * reply, the permission request and the usage update are the shapes in
 * `tests/fixtures/provider-traces/wire/devin-wire.json` and the probes beside
 * it, taken from `devin 3000.6.14` on 2026-09-09: models and modes as config
 * options, a permission that carries only a command line in `_meta`, and a
 * `session/set_model` the CLI does not have.
 */
describe('Devin execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'8'.repeat(32)}`);
  const RUN_ID = runId(`run-${'8'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'devin-tab' };

  const vaults: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  let stubbedWorkspaceServices: unknown = null;

  function createPlugin(): any {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-devin-composition-'));
    vaults.push(vault);
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
    };
    updateDevinProviderSettings(settings, { enabled: true });
    return {
      getApplicationRuntimeOrNull: () => ({
        workspaceServicesFor: () => stubbedWorkspaceServices,
      }),
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/devin',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
      getAllViews: () => [],
    };
  }

  /** The recorded `session/request_permission`, for `rm out.txt`. */
  function recordedPermission(): Omit<AcpRequestPermissionRequest, 'sessionId'> {
    return {
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'allow_session', kind: 'allow_always', name: 'Yes, allow `rm` commands (this session)' },
        { optionId: 'allow_always', kind: 'allow_always', name: 'Yes, always allow `rm` commands in `vault`' },
        { optionId: 'allow_always_global', kind: 'allow_always', name: 'Yes, always allow `rm` commands in all projects' },
        { optionId: 'switch_bypass', kind: 'allow_always', name: 'Yes, switch to bypass mode' },
        { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' },
      ],
      toolCall: {
        toolCallId: 'call_2044a883d1ef429087276f94',
        _meta: { 'cognition.ai/editableCommand': 'rm out.txt' },
      },
    };
  }

  /** The recorded `session/new` reply: two selects, and `modes` beside them. */
  function recordedSession(sessionId: string) {
    return {
      sessionId,
      modes: {
        currentModeId: 'accept-edits',
        availableModes: [
          { id: 'accept-edits', name: 'Code' },
          { id: 'smart', name: 'Smart' },
          { id: 'ask', name: 'Ask' },
          { id: 'plan', name: 'Plan' },
          { id: 'bypass', name: 'Bypass Permissions' },
        ],
      },
      configOptions: [
        {
          id: 'mode', name: 'Session Mode', category: 'mode', type: 'select',
          currentValue: 'accept-edits',
          options: [
            { value: 'accept-edits', name: 'Code', description: 'Write and edit code' },
            { value: 'smart', name: 'Smart', description: 'Auto-approve actions the model judges safe' },
            { value: 'ask', name: 'Ask', description: 'Answer questions without code changes' },
            { value: 'plan', name: 'Plan', description: 'Plan changes before implementing' },
            { value: 'bypass', name: 'Bypass Permissions', description: 'Auto-approve all tool calls' },
          ],
        },
        {
          id: 'model', name: 'Model', description: 'AI model to use', category: 'model', type: 'select',
          currentValue: 'swe-1-6-slow',
          options: [
            { value: 'swe-1-6-slow', name: 'SWE-1.6 Slow' },
            { value: 'claude-opus-5-medium', name: 'Claude Opus 5 Medium' },
          ],
        },
      ],
    } as never;
  }

  interface FakeOptions {
    asksPermission?: boolean;
    sessionIsGone?: boolean;
    announcesCommands?: boolean;
    distinctSessions?: boolean;
    dropsFirstPrompt?: boolean;
    refusesMode?: boolean;
    refusesSession?: string;
    rejectsPrompt?: string;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
    switchesMode?: string;
    windowOnFirstTurnOnly?: boolean;
  }

  interface ConfigOptionCall {
    readonly configId: string;
    readonly sessionId: string;
    readonly value: string;
  }

  /** One ACP agent, without an agent. */
  function createFakeAcp(options: FakeOptions = {}): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    configOptions: ConfigOptionCall[];
    loadRequests: Array<{ sessionId: string }>;
  } {
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const permissions: Array<Promise<AcpRequestPermissionResponse>> = [];
    const configOptions: ConfigOptionCall[] = [];
    const loadRequests: Array<{ sessionId: string }> = [];
    let turns = 0;
    let sessionSeq = 0;
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        const sessionId = options.distinctSessions
          ? `acp-session-${(sessionSeq += 1)}`
          : 'acp-session-1';
        const ask = (): void => {
          permissions.push(input.requestPermission({
            sessionId: 'acp-session-1',
            ...recordedPermission(),
          }));
        };
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          newSession: async () => {
            if (options.refusesSession) {
              throw new JsonRpcErrorResponse('session/new', -32000, options.refusesSession);
            }
            return recordedSession(sessionId);
          },
          loadSession: async request => {
            loadRequests.push(request);
            if (options.sessionIsGone) {
              // Recorded: `-32016 Session not found`, with the kind in `data`.
              throw new JsonRpcErrorResponse('session/load', -32016, 'Session not found', {
                'cognition.ai/errorKind': 'session_not_found',
                'cognition.ai/retryable': false,
              });
            }
            if (options.sessionLoadRefusal) {
              throw new JsonRpcErrorResponse('session/load', -32000, options.sessionLoadRefusal);
            }
            if (options.sessionLoadFails) {
              throw new JsonRpcErrorResponse(
                'session/load',
                -32603,
                'Internal error: Devin service failure',
                { service: 'session' },
              );
            }
            return recordedSession(request.sessionId);
          },
          prompt: async request => {
            prompts.push(request);
            turns += 1;
            if (options.rejectsPrompt) {
              throw new JsonRpcErrorResponse('session/prompt', 429, options.rejectsPrompt);
            }
            if (options.dropsFirstPrompt && turns === 1) {
              throw new Error('Request aborted: session/prompt');
            }
            if (options.asksPermission) {
              ask();
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            if (options.switchesMode) {
              notify?.({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'current_mode_update',
                  currentModeId: options.switchesMode,
                },
              } as unknown as AcpSessionNotification);
            }
            if (options.announcesCommands) {
              notify?.({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'available_commands_update',
                  availableCommands: [{ name: 'status', description: 'Check authentication status' }],
                },
              } as unknown as AcpSessionNotification);
            }
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'call_c5eb90a46deb46f695378abc',
                title: 'Read file',
                kind: 'read',
                status: 'completed',
                rawInput: { file_path: 'Note.md' },
                content: [{ type: 'content', content: { type: 'text', text: '3 lines' } }],
              },
            });
            if (!options.windowOnFirstTurnOnly || turns === 1) {
              notify?.({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'usage_update',
                  used: 13_652,
                  size: 200_000,
                  cost: { amount: 0.25, currency: 'USD' },
                },
              });
            }
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'the answer' },
              },
            });
            return {
              stopReason: 'end_turn',
              usage: { inputTokens: 13_622, outputTokens: 30, totalTokens: 13_652 },
            };
          },
          setMode: async () => ({}),
          // Probed: `-32601 Method not found`. A fake that accepted it would
          // hide the one call this provider must never make.
          setModel: async () => {
            throw new JsonRpcErrorResponse('session/set_model', -32601, 'Method not found');
          },
          setConfigOption: async request => {
            configOptions.push({
              configId: request.configId,
              sessionId: request.sessionId,
              value: String(request.value),
            });
            if (options.refusesMode && request.configId === 'mode') {
              throw new JsonRpcErrorResponse(
                'session/set_config_option',
                -32602,
                'Invalid params',
                { details: 'Mode bypass is not available for this account.' },
              );
            }
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
    return { factory, startupRefs, prompts, permissions, configOptions, loadRequests };
  }

  async function createHarness(options: FakeOptions & { plugin?: any } = {}): Promise<{
    execution: DevinExecution;
    host: ExecutionKernelHost;
    plugin: any;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    configOptions: ConfigOptionCall[];
    loadRequests: Array<{ sessionId: string }>;
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
    const execution = new DevinExecution(plugin, host.registry);
    const { factory, startupRefs, prompts, permissions, configOptions, loadRequests } = createFakeAcp(options);
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    await host.registry.createSession({
      backendId: DEVIN_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => events.push(envelope));
    return { execution, host, plugin, startupRefs, prompts, permissions, configOptions, loadRequests, events };
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

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) {
        return;
      }
      await new Promise(resolve => { setTimeout(resolve, 5); });
    }
    throw new Error('The session configuration never settled.');
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

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

  function modeCalls(configOptions: readonly ConfigOptionCall[]): string[] {
    return configOptions.filter(call => call.configId === 'mode').map(call => call.value);
  }

  function modelCalls(configOptions: readonly ConfigOptionCall[]): string[] {
    return configOptions.filter(call => call.configId === 'model').map(call => call.value);
  }

  it('carries a whole turn from the reference to the ACP prompt and back', async () => {
    const { execution, host, prompts, events } = await createHarness();

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(prompts).toHaveLength(1);
    expect(events.map(envelope => envelope.event.kind)).toContain('run-started');
    expect(events.find(envelope => envelope.event.kind === 'terminal')?.event)
      .toMatchObject({ terminal: 'succeeded' });
    execution.dispose();
    await host.dispose();
  });

  it('draws the tab from the content the same turn forwarded', async () => {
    const { execution, host, events } = await createHarness();
    const costs: unknown[] = [];
    const opened: unknown[] = [];
    const presenter = new DevinContentPresenter({
      displayModel: () => 'devin:swe-1-6-slow',
      onCost: cost => costs.push(cost),
      onSessionOpened: opening => opened.push(opening),
    });

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);

    const chunks = events.flatMap(({ event }) => (
      event.kind === 'provider-content' ? [...presenter.present(event.payload)] : []
    ));
    // The agent's own title for the tool: this provider has no tool stream
    // adapter, and the card says what the agent called it.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'call_c5eb90a46deb46f695378abc',
      name: 'Read file',
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      id: 'call_c5eb90a46deb46f695378abc',
      content: '3 lines',
    }));
    expect(chunks.filter(chunk => chunk.type === 'usage').at(-1)).toEqual(
      expect.objectContaining({
        sessionId: 'acp-session-1',
        usage: expect.objectContaining({
          contextWindow: 200_000,
          contextTokens: 13_652,
          inputTokens: 13_622,
        }),
      }),
    );
    expect(costs).toEqual([{ amount: 0.25, currency: 'USD' }]);
    expect(opened).toEqual([expect.objectContaining({
      sessionId: 'acp-session-1',
      configOptions: expect.arrayContaining([expect.objectContaining({ id: 'model' })]),
    })]);
    expect(presenter.lastSessionId()).toBe('acp-session-1');
    expect(chunks.some(chunk => chunk.type === 'text')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('asks before it runs a command, in the words the tab renders', async () => {
    const { execution, host, permissions, events } = await createHarness({
      asksPermission: true,
    });

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'delete the file' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    const opened = await waitForInteraction(events);

    // The request carries no title and no input; the command in `_meta` is
    // the whole of what a person decides on.
    expect(execution.interactionBridge.presentation(opened.presentationRef))
      .toEqual(expect.objectContaining({
        toolName: 'Shell command',
        description: 'Devin wants to run `rm out.txt`.',
        options: [
          { responseId: 'allow-once', label: 'Allow', presentation: 'allow' },
          { responseId: 'allow-always', label: 'Yes, allow `rm` commands (this session)', presentation: 'always' },
          { responseId: 'allow-always-2', label: 'Yes, always allow `rm` commands in `vault`', presentation: 'always' },
          { responseId: 'allow-always-3', label: 'Yes, always allow `rm` commands in all projects', presentation: 'always' },
          { responseId: 'allow-always-4', label: 'Yes, switch to bypass mode', presentation: 'always' },
          { responseId: 'reject-once', label: 'Reject', presentation: 'reject' },
        ],
      }));

    await host.registry.resolveInteraction({
      interactionId: opened.interactionId,
      responseId: 'allow-once',
      resolvedAt: 1,
    });
    await settle(host, events);

    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    expect(execution.interactionBridge.presentation(opened.presentationRef)).toBeUndefined();
    execution.dispose();
    await host.dispose();
  });

  it('renders a turn a tab can draw, and learns the session it is on', async () => {
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === 'Read file')).toBe(true);
    expect(runtime.getSessionId()).toBe('acp-session-1');
    execution.dispose();
    await host.dispose();
  });

  it('resumes the session the conversation remembers', async () => {
    const { execution, host, loadRequests } = await createHarness();
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'acp-session-saved' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(loadRequests).toEqual([expect.objectContaining({ sessionId: 'acp-session-saved' })]);
    expect(runtime.getSessionId()).toBe('acp-session-saved');
    execution.dispose();
    await host.dispose();
  });

  it('ends a turn the agent refused in the words the agent used', async () => {
    const { execution, host, prompts } = await createHarness({
      rejectsPrompt: 'You have exhausted your daily quota on this model.',
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content))
      .toEqual(['You have exhausted your daily quota on this model.']);
    expect(prompts).toHaveLength(1);
    expect(chunks.some(chunk => chunk.type === 'notice')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('still retries a connection that died, which is what the refusal path took', async () => {
    const { execution, host, prompts, startupRefs } = await createHarness({
      dropsFirstPrompt: true,
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(prompts).toHaveLength(2);
    expect(startupRefs).toHaveLength(2);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    execution.dispose();
    await host.dispose();
  });

  it('says why the agent would not open a session, in the agent words', async () => {
    const { execution, host } = await createHarness({
      refusesSession: 'Authentication required: run `devin auth login` first.',
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content))
      .toEqual(['Authentication required: run `devin auth login` first.']);
    execution.dispose();
    await host.dispose();
  });

  it('says what a turn that never started needs the person to do', async () => {
    const { execution, host } = await createHarness({ sessionLoadFails: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses-that-is-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    const errors = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content);
    expect(errors).toEqual([
      'Devin could not open the session this conversation was resumed from. Devin said: Internal '
        + 'error: Devin service failure. Starting a new chat helps only if the session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('says what the agent said when the session was not what stopped it', async () => {
    const { execution, host } = await createHarness({
      sessionLoadRefusal: 'Authentication required',
    });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses-that-is-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content)).toEqual([
      'Devin could not open the session this conversation was resumed from. '
        + 'Devin said: Authentication required. Starting a new chat helps only if the '
        + 'session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('replaces a session the agent says it no longer has, and says so', async () => {
    // Recorded: `-32016 Session not found`. The shared pattern reads the
    // message, the backend replaces the session, and the surface can say so.
    const { execution, host } = await createHarness({ sessionIsGone: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({
      id: 'conv-1',
      providerState: {},
      sessionId: 'ses-that-is-gone',
    });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(runtime.getSessionId()).toBe('acp-session-1');
    expect(runtime.isSessionDropped()).toBe(true);
    expect(runtime.sessionBinding({
      conversation: { id: 'conv-1' },
      sessionInvalidated: false,
    })?.providerState).toMatchObject({ sessionDropped: true });
    execution.dispose();
    await host.dispose();
  });

  it('carries a drop into the tab that opens the conversation next', async () => {
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();

    runtime.syncConversationState({
      id: 'conv-1',
      providerState: { sessionDropped: true },
      sessionId: null,
    });

    expect(runtime.isSessionDropped()).toBe(true);
    execution.dispose();
    await host.dispose();
  });

  it('asks the tab before a command, and answers the agent with what it chose', async () => {
    const { execution, host, permissions } = await createHarness({ asksPermission: true });
    const runtime = execution.createRuntime();
    const asked: Array<{ toolName: string; description: string }> = [];
    runtime.installInteractions({ approval: async (toolName: string, _input: unknown, description: string) => {
      asked.push({ toolName, description });
      return 'allow';
    } });

    await drain(runtime.query(runtime.prepareTurn({ text: 'delete it' })));

    expect(asked).toEqual([{
      toolName: 'Shell command',
      description: 'Devin wants to run `rm out.txt`.',
    }]);
    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    execution.dispose();
    await host.dispose();
  });

  it('refuses a write on a session no open tab answers for', async () => {
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'plan';
    updateDevinProviderSettings(plugin.settings, { selectedMode: 'plan' });
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    const approval = jest.fn(async () => 'allow' as const);
    runtime.installInteractions({ approval: approval });
    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    await expect((execution as any).approveWrite({
      sessionId: 'acp-session-nobody-owns',
      requestPath: 'note.md',
      resolvedPath: '/vault/note.md',
    })).resolves.toBe(false);
    expect(approval).not.toHaveBeenCalled();

    await expect((execution as any).approveWrite({
      sessionId: 'acp-session-1',
      requestPath: 'note.md',
      resolvedPath: '/vault/note.md',
    })).resolves.toBe(true);
    expect(approval).toHaveBeenCalledTimes(1);
    execution.dispose();
    await host.dispose();
  });

  it('says the conversation only to a session that has never heard it', async () => {
    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
    ];
    const { execution, host, prompts } = await createHarness();
    const fresh = execution.createRuntime();

    await drain(fresh.query(fresh.prepareTurn({ text: 'go on' }), history));

    const first = prompts[0] as { prompt: Array<{ text?: string }> };
    expect(first.prompt[0]?.text).toContain('Keep the language rich.');

    const bound = execution.createRuntime();
    bound.syncConversationState({ providerState: {}, sessionId: 'acp-session-saved' });
    await drain(bound.query(bound.prepareTurn({ text: 'go on' }), history));

    const second = prompts[1] as { prompt: Array<{ text?: string }> };
    expect(second.prompt[0]?.text).not.toContain('Keep the language rich.');
    execution.dispose();
    await host.dispose();
  });

  it('reads its own permission mode, not whichever provider was toggled last', async () => {
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'full_access';
    plugin.settings.savedProviderPermissionMode = { devin: 'normal' };
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    const approval = jest.fn(async () => 'deny' as const);
    runtime.installInteractions({ approval: approval });
    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    await expect((execution as any).approveWrite({
      sessionId: 'acp-session-1',
      requestPath: 'note.md',
      resolvedPath: '/vault/note.md',
    })).resolves.toBe(false);
    expect(approval).toHaveBeenCalledTimes(1);
    execution.dispose();
    await host.dispose();
  });

  it('leaves the mode the user picked alone when the session reports its own', async () => {
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'plan';
    updateDevinProviderSettings(plugin.settings, { selectedMode: 'plan' });
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => getDevinProviderSettings(plugin.settings).availableModes.length > 0);

    // `session/new` reports where the agent starts, not a switch.
    expect(synced).toEqual([]);
    expect(getDevinProviderSettings(plugin.settings).selectedMode).toBe('plan');
    expect(modeCalls(configOptions)).toEqual(['plan']);
    execution.dispose();
    await host.dispose();
  });

  it('follows the session into a mode somebody switched it to', async () => {
    // `smart` auto-approves what a fast model judges safe and still asks for
    // the rest, so it is Safe rather than Auto-approve.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin, switchesMode: 'smart' });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => synced.length > 0);

    expect(synced).toEqual(['normal']);
    expect(getDevinProviderSettings(plugin.settings).selectedMode).toBe('normal');
    execution.dispose();
    await host.dispose();
  });

  it('does not carry one turn context report into the next', async () => {
    const { execution, host } = await createHarness({ windowOnFirstTurnOnly: true });
    const runtime = execution.createRuntime();

    const first = await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    const second = await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    // The window is the half only the update carries: the prompt answer's
    // own `totalTokens` is the same number as `used` on the recorded wire.
    expect(first.some(chunk => chunk.type === 'usage'
      && chunk.usage?.contextWindow === 200_000)).toBe(true);
    expect(second.some(chunk => chunk.type === 'usage'
      && chunk.usage?.contextWindow === 200_000)).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('answers the turn even when the agent will not take the mode', async () => {
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'full_access';
    updateDevinProviderSettings(plugin.settings, { selectedMode: 'full_access' });
    const logged: Array<Record<string, unknown>> = [];
    plugin.recordDebugLog = (record: Record<string, unknown>) => logged.push(record);
    const { execution, host, configOptions } = await createHarness({ plugin, refusesMode: true });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(modeCalls(configOptions)).toEqual(['bypass']);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(logged).toContainEqual(expect.objectContaining({
      event: 'execution.setMode.refused',
      data: { modeId: 'bypass' },
    }));
    expect(chunks.filter(chunk => chunk.type === 'notice')).toEqual([{
      type: 'notice',
      level: 'warning',
      content: 'Devin did not switch to Auto-approve: Mode bypass is not available for this '
        + 'account. This turn ran in the mode the session was already in.',
    }]);

    // Once per session, not once per turn.
    const second = await drain(runtime.query(runtime.prepareTurn({ text: 'again' })));
    expect(second.filter(chunk => chunk.type === 'notice')).toEqual([]);
    execution.dispose();
    await host.dispose();
  });

  it('lists the commands the open session announced, and forgets them with it', async () => {
    const { execution, host } = await createHarness({ announcesCommands: true });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect((await runtime.getSupportedCommands()).map(command => command.name))
      .toEqual(['status']);

    runtime.syncConversationState({
      id: 'conv-other',
      providerState: {},
      sessionId: 'acp-session-other',
    });

    expect(await runtime.getSupportedCommands()).toEqual([]);
    execution.dispose();
    await host.dispose();
  });

  it('learns the vault models from the session the turn opened', async () => {
    // What the session offers is what the account allows, and nothing else
    // answers that question — not `devin models list`.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => getDevinProviderSettings(plugin.settings).discoveredModels.length > 0);

    expect(getDevinProviderSettings(plugin.settings).discoveredModels)
      .toEqual([
        expect.objectContaining({ rawId: 'swe-1-6-slow', label: 'SWE-1.6 Slow' }),
        expect.objectContaining({ rawId: 'claude-opus-5-medium' }),
      ]);
    execution.dispose();
    await host.dispose();
  });

  it('dispatches the turn under a mode the agent actually has, as a config option', async () => {
    const plugin = createPlugin();
    updateDevinProviderSettings(plugin.settings, { selectedMode: 'full_access' });
    plugin.settings.permissionMode = 'full_access';
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // `full_access` is Grimoire's word and not one of the five this agent
    // named; and `session/set_model` does not exist, so the model would have
    // gone the same way — but a vault that has never opened a session does
    // not yet know one to ask for.
    expect(configOptions).toEqual([
      { configId: 'mode', sessionId: 'acp-session-1', value: 'bypass' },
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('sets the model a vault has learned, and none before it has learned one', async () => {
    const plugin = createPlugin();
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    expect(modelCalls(configOptions)).toEqual([]);
    await waitFor(() => getDevinProviderSettings(plugin.settings).visibleModels.length > 0);

    await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    expect(modelCalls(configOptions)).toEqual(['swe-1-6-slow']);
    execution.dispose();
    await host.dispose();
  });

  it('asks its questions in a process bound to no conversation', async () => {
    const plugin = createPlugin();
    const { execution, host, startupRefs } = await createHarness({ plugin });

    await expect(execution.metadata.discoverMetadata()).resolves.toBe(true);

    expect(startupRefs).toHaveLength(1);
    const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
    expect(launch.arguments).toEqual(['acp']);
    expect(getDevinProviderSettings(plugin.settings).discoveredModels)
      .toEqual([
        expect.objectContaining({ rawId: 'swe-1-6-slow' }),
        expect.objectContaining({ rawId: 'claude-opus-5-medium' }),
      ]);
    expect(getDevinProviderSettings(plugin.settings).availableModes.map(mode => mode.id))
      .toEqual(['accept-edits', 'smart', 'ask', 'plan', 'bypass']);
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process when the vault workspace resources change', async () => {
    // This CLI reads `.devin/skills` and `.agents/skills` when it starts.
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();

    const before = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'first' }],
    }));
    await runtime.reloadWorkspaceResources?.();
    const after = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'second' }],
    }));

    expect(after.restartFingerprint).not.toBe(before.restartFingerprint);
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process when the vault MCP servers change', async () => {
    const { execution, host } = await createHarness();
    const servers: unknown[] = [];
    stubbedWorkspaceServices = { mcpServerManager: { getServers: () => servers } };

    const before = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'first' }],
    }));
    servers.push({ id: 'docs', name: 'docs', type: 'stdio', command: 'docs-mcp', enabled: true });
    const after = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'second' }],
    }));

    expect(after.restartFingerprint).not.toBe(before.restartFingerprint);
    execution.dispose();
    await host.dispose();
  });

  it('resolves the startup reference into the process a launcher would spawn', async () => {
    const { execution, host, startupRefs, events } = await createHarness();

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(startupRefs).toHaveLength(1);
    const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
    expect(launch).toMatchObject({
      executable: '/usr/local/bin/devin',
      arguments: ['acp'],
    });
    // The CLI's own tracing is quietened unless the person asked otherwise.
    expect(launch.environment.RUST_LOG).toBe('warn');
    execution.dispose();
    await host.dispose();
  });

  it('falls back to the command the CLI actually installs', async () => {
    const plugin = createPlugin();
    plugin.getResolvedProviderCliPath = () => null;
    const { execution, host } = await createHarness({ plugin });

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    expect(launch.executable).toBe('devin');
    execution.dispose();
    await host.dispose();
  });

  it('refuses a reference it did not mint', async () => {
    const { execution, host, events } = await createHarness();

    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef: 'dvreq-0000000000000000000000000000000f',
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(host.registry.getRun(RUN_ID)).toMatchObject({ state: 'invalidated' });
    execution.dispose();
    await host.dispose();
  });
});
