import '@/providers';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { attachmentPath, AttachmentStore } from '@/core/attachments/AttachmentStore';
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
import { ReasonixContentPresenter } from '@/providers/reasonix/execution/ReasonixContentPresenter';
import { REASONIX_EXECUTION_DESCRIPTOR } from '@/providers/reasonix/execution/ReasonixExecutionBackend';
import { ReasonixExecution } from '@/providers/reasonix/execution/ReasonixExecutionComposition';
import {
  getReasonixProviderSettings,
  updateReasonixProviderSettings,
} from '@/providers/reasonix/settings';

/**
 * The half of the Reasonix composition that only exists in production.
 *
 * The backend takes three opaque references — the turn, the process to spawn,
 * the session config to apply — and knows what is inside none of them. This
 * module is the only place that knows all three.
 *
 * **What the fake answers with was observed from Reasonix.** The `session/new`
 * reply, the permission request and the usage update are the shapes in
 * `tests/fixtures/provider-traces/wire/reasonix-wire.json` and the probes beside
 * it, taken from `reasonix 3000.6.14` on 2026-09-09: models and modes as config
 * options, a permission that carries only a command line in `_meta`, and a
 * `session/set_model` the CLI does not have.
 */
describe('Reasonix execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'8'.repeat(32)}`);
  const RUN_ID = runId(`run-${'8'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'reasonix-tab' };

  const vaults: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  let stubbedWorkspaceServices: unknown = null;

  function createPlugin(): any {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-reasonix-composition-'));
    vaults.push(vault);
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
    };
    updateReasonixProviderSettings(settings, { enabled: true });
    return {
      getApplicationRuntimeOrNull: () => ({
        workspaceServicesFor: () => stubbedWorkspaceServices,
      }),
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/reasonix',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
      getAllViews: () => [],
    };
  }

  /** The probed `session/request_permission`, for a write. */
  function recordedPermission(): Omit<AcpRequestPermissionRequest, 'sessionId'> {
    return {
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'allow_always', kind: 'allow_always', name: 'Allow Edit for this session' },
        { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' },
      ],
      toolCall: {
        toolCallId: 'gate-1',
        title: 'write_file hello.txt',
        kind: 'edit',
        status: 'pending',
        rawInput: { content: 'hi', path: 'hello.txt' },
        locations: [{ path: '/vault/hello.txt' }],
        _meta: {
          'reasonix.io': { approvalId: '1', fresh: false, subject: 'hello.txt', tool: 'write_file' },
        },
      },
    };
  }

  /** The recorded `session/new` reply: models, modes, and the config options. */
  function recordedSession(sessionId: string) {
    return {
      sessionId,
      models: {
        currentModelId: 'custom-api-z-ai/glm-5.3-flash',
        availableModels: [
          { modelId: 'custom-api-z-ai/glm-5.3', name: 'custom-api-z-ai/glm-5.3' },
          { modelId: 'custom-api-z-ai/glm-5.3-flash', name: 'custom-api-z-ai/glm-5.3-flash' },
        ],
      },
      modes: {
        currentModeId: 'normal',
        availableModes: [
          { id: 'normal', name: 'Normal' },
          { id: 'plan', name: 'Plan' },
          { id: 'goal', name: 'Goal' },
        ],
      },
      configOptions: [
        {
          id: 'model', name: 'Model', category: 'model', type: 'select',
          currentValue: 'custom-api-z-ai/glm-5.3-flash',
          options: [
            { value: 'custom-api-z-ai/glm-5.3', name: 'custom-api-z-ai/glm-5.3' },
            { value: 'custom-api-z-ai/glm-5.3-flash', name: 'custom-api-z-ai/glm-5.3-flash' },
          ],
        },
        {
          id: 'tool_approval', name: 'Tool Approval', category: 'tool_approval', type: 'select',
          currentValue: 'ask',
          options: [
            { value: 'ask', name: 'Ask', description: 'Ask before permission-gated tool calls' },
            { value: 'auto', name: 'Auto', description: 'Follow configured permission rules' },
            { value: 'yolo', name: 'Yolo', description: 'Approve tool calls except protected decisions' },
          ],
        },
      ],
    } as never;
  }

  interface FakeOptions {
    asksPermission?: boolean;
    /** Asks to leave Plan mode, which is a request with no input on it. */
    asksToExitPlan?: boolean;
    sessionIsGone?: boolean;
    announcesCommands?: boolean;
    distinctSessions?: boolean;
    dropsFirstPrompt?: boolean;
    refusesMode?: boolean;
    refusesConfig?: string;
    refusesSession?: string;
    rejectsPrompt?: string;
    sessionLoadFails?: boolean;
    emptySessionReplay?: boolean;
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
        // A Set, as `AcpClientConnection` keeps: the composition subscribes
        // for its own reasons beside the backend, and a fake that held one
        // listener would silently drop whichever subscribed first.
        const listeners = new Set<(notification: AcpSessionNotification) => void>();
        const notify = (notification: AcpSessionNotification): void => {
          for (const listener of [...listeners]) listener(notification);
        };
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
              // Probed 2026-09-09: the id is named in the message and there
              // is no `data` to key on.
              throw new JsonRpcErrorResponse(
                'session/load',
                -32602,
                `session/load: unknown session ${request.sessionId}`,
                {},
              );
            }
            if (options.sessionLoadRefusal) {
              throw new JsonRpcErrorResponse('session/load', -32000, options.sessionLoadRefusal);
            }
            if (options.sessionLoadFails) {
              throw new JsonRpcErrorResponse(
                'session/load',
                -32603,
                'Internal error: Reasonix service failure',
                { service: 'session' },
              );
            }
            if (!options.emptySessionReplay) {
              notify({ sessionId: request.sessionId, update: {
                sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Earlier message' },
              } });
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
            if (options.asksToExitPlan) {
              permissions.push(input.requestPermission({
                sessionId: 'acp-session-1',
                options: [
                  { optionId: 'allow_once', kind: 'allow_once', name: 'Yes, implement the plan' },
                  { optionId: 'reject_once', kind: 'reject_once', name: 'No, plan needs changes' },
                ],
                toolCall: { toolCallId: 'gate-2', title: 'Exit plan mode', kind: 'switch_mode' },
              } as never));
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            if (options.asksPermission) {
              ask();
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            if (options.switchesMode) {
              notify({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'current_mode_update',
                  currentModeId: options.switchesMode,
                },
              } as unknown as AcpSessionNotification);
            }
            if (options.announcesCommands) {
              notify({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'available_commands_update',
                  availableCommands: [{ name: 'status', description: 'Check authentication status' }],
                },
              } as unknown as AcpSessionNotification);
            }
            notify({
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
              notify({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'usage_update',
                  used: 13_652,
                  size: 200_000,
                  cost: { amount: 0.25, currency: 'USD' },
                },
              });
            }
            notify({
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
          setMode: async request => {
            configOptions.push({
              configId: 'mode',
              sessionId: request.sessionId,
              value: String(request.modeId),
            });
            if (options.refusesMode) {
              throw new JsonRpcErrorResponse(
                'session/set_mode',
                -32602,
                'Invalid params',
                { details: 'Mode plan is not available for this session.' },
              );
            }
            return {};
          },
          // Answered by the CLI, and not used: the model goes through the
          // config option, which reports back what the session now holds.
          setModel: async () => ({}),
          setConfigOption: async request => {
            if (options.refusesConfig) {
              throw new JsonRpcErrorResponse('session/set_config_option', -32602, options.refusesConfig);
            }
            configOptions.push({
              configId: request.configId,
              sessionId: request.sessionId,
              value: String(request.value),
            });
            return { configOptions: [] };
          },
          cancel: () => undefined,
          onSessionNotification: listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
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
    execution: ReasonixExecution;
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
    const execution = new ReasonixExecution(plugin, host.registry);
    const { factory, startupRefs, prompts, permissions, configOptions, loadRequests } = createFakeAcp(options);
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    await host.registry.createSession({
      backendId: REASONIX_EXECUTION_DESCRIPTOR.backendId,
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

  function approvalCalls(configOptions: readonly ConfigOptionCall[]): string[] {
    return configOptions
      .filter(call => call.configId === 'tool_approval')
      .map(call => call.value);
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
    const presenter = new ReasonixContentPresenter({
      displayModel: () => 'reasonix:swe-1-6-slow',
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

  it('asks before it writes, in the words the tab renders', async () => {
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

    // The request carries its own title, kind and input, so the sentence is
    // built from it and nothing is looked up.
    expect(execution.interactionBridge.presentation(opened.presentationRef))
      .toEqual(expect.objectContaining({
        toolName: 'write_file hello.txt',
        description: 'Reasonix wants to write hello.txt.',
        options: [
          { responseId: 'allow-once', label: 'Allow', presentation: 'allow' },
          { responseId: 'allow-always', label: 'Allow Edit for this session', presentation: 'always' },
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

  it('describes a plan exit, which is the request that carries no input', async () => {
    const { execution, host } = await createHarness({ asksToExitPlan: true });
    const runtime = execution.createRuntime();
    const asked: Array<{ toolName: string; description: string }> = [];
    runtime.installInteractions({ approval: async (toolName: string, _input: unknown, description: string) => {
      asked.push({ toolName, description });
      return 'allow';
    } });

    await drain(runtime.query(runtime.prepareTurn({ text: 'do it' })));

    expect(asked).toEqual([{
      toolName: 'Exit plan mode',
      description: 'Reasonix wants to leave Plan mode and start implementing the plan.',
    }]);
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

  it('shows a configuration refusal without suggesting that a fresh session is missing', async () => {
    const detail = 'session/set_config_option: invalid value yolo for tool_approval';
    const { execution, host, prompts } = await createHarness({ refusesConfig: detail });
    try {
      const runtime = execution.createRuntime();
      const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'hello' })));
      expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content))
        .toEqual([`Could not apply session configuration: ${detail}`]);
      expect(prompts).toHaveLength(0);
    } finally {
      execution.dispose();
      await host.dispose();
    }
  });

  it('says why the agent would not open a session, in the agent words', async () => {
    const { execution, host } = await createHarness({
      refusesSession: 'Authentication required: run `reasonix auth login` first.',
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content))
      .toEqual(['Authentication required: run `reasonix auth login` first.']);
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
      'Reasonix could not open the session this conversation was resumed from. Reasonix said: Internal '
        + 'error: Reasonix service failure. Starting a new chat helps only if the session itself is gone.',
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
      'Reasonix could not open the session this conversation was resumed from. '
        + 'Reasonix said: Authentication required. Starting a new chat helps only if the '
        + 'session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('replaces a session the agent says it no longer has, and says so', async () => {
    // Probed: `-32602 "session/load: unknown session <id>"`. The shared
    // pattern reads the message, the backend replaces the session, and the
    // surface can say so.
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

  it('asks the tab before a write, and answers the agent with what it chose', async () => {
    const { execution, host, permissions } = await createHarness({ asksPermission: true });
    const runtime = execution.createRuntime();
    const asked: Array<{ toolName: string; description: string }> = [];
    runtime.installInteractions({ approval: async (toolName: string, _input: unknown, description: string) => {
      asked.push({ toolName, description });
      return 'allow';
    } });

    await drain(runtime.query(runtime.prepareTurn({ text: 'delete it' })));

    expect(asked).toEqual([{
      toolName: 'write_file hello.txt',
      description: 'Reasonix wants to write hello.txt.',
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
    updateReasonixProviderSettings(plugin.settings, { selectedMode: 'plan' });
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

  it.each([false, true])('delivers images as files, including empty native replay=%s', async emptySessionReplay => {
    const { execution, host, plugin, prompts } = await createHarness({ emptySessionReplay });
    const files = new Map<string, ArrayBuffer>();
    plugin.storage = { attachments: new AttachmentStore({
      exists: async path => files.has(path),
      readBinary: async path => files.get(path)!,
      writeBinary: async (path, bytes) => { files.set(path, bytes); },
      delete: async path => { files.delete(path); },
      listFiles: async () => [...files.keys()], getResourcePath: path => path,
    }) };
    updateReasonixProviderSettings(plugin.settings, { imageAttachmentsAsFiles: true });
    const image = { id: 'image', name: 'photo.png', mediaType: 'image/png' as const,
      data: Buffer.from('image bytes').toString('base64'), size: 11, source: 'paste' as const, hash: undefined as string | undefined };
    const runtime = execution.createRuntime();
    if (emptySessionReplay) runtime.syncConversationState({ sessionId: 'saved-session' });
    const history = [{ id: 'prior', role: 'user' as const, content: 'Remember birch7319.', timestamp: 1 }];
    try {
      await drain(runtime.query(runtime.prepareTurn({ text: 'Describe this', images: [image] }), history));
      const blocks = (prompts[0] as { prompt: Array<{ type: string; text: string }> }).prompt;
      expect(blocks.every(block => block.type === 'text')).toBe(true);
      const text = blocks.map(block => block.text).join('');
      expect(text).toContain('birch7319');
      expect(text).toContain(JSON.stringify(join(plugin.app.vault.adapter.basePath, attachmentPath(image.hash!, image.mediaType))));
      expect(text).toContain('file-reading tool');
      expect(text).not.toContain(image.data);
      expect(Buffer.from(files.get(attachmentPath(image.hash!, image.mediaType))!)).toEqual(Buffer.from('image bytes'));
    } finally {
      execution.dispose();
      await host.dispose();
    }
  });

  it('rejects images without opt-in and fails missing files before starting ACP', async () => {
    const { execution, host, plugin, prompts, startupRefs } = await createHarness();
    const runtime = execution.createRuntime();
    const request = { text: 'Describe this', images: [{ id: 'image', name: 'photo.png',
      mediaType: 'image/png' as const, data: '', hash: 'a'.repeat(64), size: 11, source: 'paste' as const }] };
    try {
      expect(() => runtime.prepareTurn(request)).toThrow('Image attachments as files');
      updateReasonixProviderSettings(plugin.settings, { imageAttachmentsAsFiles: true });
      plugin.storage = { attachments: { read: async () => null } };
      const chunks = await drain(runtime.query(runtime.prepareTurn(request)));
      expect(JSON.stringify(chunks)).toContain('unavailable');
      expect(prompts).toHaveLength(0);
      expect(startupRefs).toHaveLength(0);
    } finally {
      execution.dispose();
      await host.dispose();
    }
  });

  it('restores saved history once when a successful native load replays no conversation', async () => {
    const { execution, host, prompts } = await createHarness({ emptySessionReplay: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ sessionId: 'acp-session-saved' });
    const history = [{ id: 'previous', role: 'user' as const, content: 'The code word is birch7319.', timestamp: 1 }];
    await drain(runtime.query(runtime.prepareTurn({ text: 'What was the code word?' }), history));
    expect(JSON.stringify(prompts[0])).toContain('birch7319');
    await drain(runtime.query(runtime.prepareTurn({ text: 'Continue.' }), history));
    expect(JSON.stringify(prompts[1])).not.toContain('birch7319');
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
    plugin.settings.savedProviderPermissionMode = { reasonix: 'normal' };
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
    updateReasonixProviderSettings(plugin.settings, { selectedMode: 'plan' });
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => getReasonixProviderSettings(plugin.settings).availableModes.length > 0);

    // `session/new` reports where the agent starts, not a switch.
    expect(synced).toEqual([]);
    expect(getReasonixProviderSettings(plugin.settings).selectedMode).toBe('plan');
    expect(approvalCalls(configOptions)).toEqual(['ask']);
    expect(modeCalls(configOptions)).toEqual(['plan']);
    execution.dispose();
    await host.dispose();
  });

  it('follows the session into a mode somebody switched it to', async () => {
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin, switchesMode: 'plan' });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => synced.length > 0);

    expect(synced).toEqual(['plan']);
    expect(getReasonixProviderSettings(plugin.settings).selectedMode).toBe('plan');
    execution.dispose();
    await host.dispose();
  });

  it('keeps somebody in Auto-approve when the session reports the mode it shares with Safe', async () => {
    // `goal` and `normal` both read as Safe, and Safe and Auto-approve are the
    // same Reasonix mode. A reported mode must not be able to revoke the
    // permissions a person granted.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin, switchesMode: 'goal' });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => synced.length > 0);

    expect(synced).toEqual(['full_access']);
    expect(getReasonixProviderSettings(plugin.settings).selectedMode).toBe('full_access');
    execution.dispose();
    await host.dispose();
  });

  it('does not carry one turn context report into the next', async () => {
    const { execution, host } = await createHarness({ windowOnFirstTurnOnly: true });
    const runtime = execution.createRuntime();

    const first = await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    const second = await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    // A window the wire stated is the thing that must not outlive its turn.
    // A turn without an occupancy report must not fabricate a percentage.
    expect(first.some(chunk => chunk.type === 'usage'
      && chunk.usage?.contextWindowIsAuthoritative === true)).toBe(true);
    expect(second.some(chunk => chunk.type === 'usage'
      && chunk.usage?.contextWindowIsAuthoritative === true)).toBe(false);
    expect(second.some(chunk => chunk.type === 'usage')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('answers the turn even when the agent will not take the mode', async () => {
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'full_access';
    updateReasonixProviderSettings(plugin.settings, { selectedMode: 'full_access' });
    const logged: Array<Record<string, unknown>> = [];
    plugin.recordDebugLog = (record: Record<string, unknown>) => logged.push(record);
    const { execution, host, configOptions } = await createHarness({ plugin, refusesMode: true });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // The posture landed and the mode did not, which is the half-failure the
    // ordering makes safe: the session keeps the mode it had.
    expect(approvalCalls(configOptions)).toEqual(['yolo']);
    expect(modeCalls(configOptions)).toEqual(['normal']);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(logged).toContainEqual(expect.objectContaining({
      event: 'execution.setMode.refused',
      data: { method: 'session/set_mode', modeId: 'full_access' },
    }));
    // Named in the toolbar's vocabulary: `normal` is the wire value for both
    // Safe and Auto-approve, and this person asked for the second.
    expect(chunks.filter(chunk => chunk.type === 'notice')).toEqual([{
      type: 'notice',
      level: 'warning',
      content: 'Reasonix did not switch to Auto-approve: Mode plan is not available for this '
        + 'session. This turn ran in the mode the session was already in.',
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
    // answers that question — not `reasonix models list`.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => getReasonixProviderSettings(plugin.settings).discoveredModels.length > 0);

    expect(getReasonixProviderSettings(plugin.settings).discoveredModels)
      .toEqual([
        expect.objectContaining({ rawId: 'custom-api-z-ai/glm-5.3' }),
        expect.objectContaining({ rawId: 'custom-api-z-ai/glm-5.3-flash' }),
      ]);
    execution.dispose();
    await host.dispose();
  });

  it('dispatches Auto-approve as a session mode plus an approval posture', async () => {
    const plugin = createPlugin();
    updateReasonixProviderSettings(plugin.settings, { selectedMode: 'full_access' });
    plugin.settings.permissionMode = 'full_access';
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // `full_access` is Grimoire's word: Reasonix has no Auto-approve mode, so
    // the session stays in `normal` and `tool_approval` carries the rest. A
    // vault that has never opened a session knows no model to ask for.
    expect(configOptions).toEqual([
      { configId: 'tool_approval', sessionId: 'acp-session-1', value: 'yolo' },
      { configId: 'mode', sessionId: 'acp-session-1', value: 'normal' },
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('keeps the model the session reported after discovering its catalog', async () => {
    const plugin = createPlugin();
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    expect(modelCalls(configOptions)).toEqual([]);
    await waitFor(() => getReasonixProviderSettings(plugin.settings).visibleModels.length > 0);

    await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    expect(modelCalls(configOptions)).toEqual([]);
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
    expect(getReasonixProviderSettings(plugin.settings).discoveredModels)
      .toEqual([
        expect.objectContaining({ rawId: 'custom-api-z-ai/glm-5.3' }),
        expect.objectContaining({ rawId: 'custom-api-z-ai/glm-5.3-flash' }),
      ]);
    expect(getReasonixProviderSettings(plugin.settings).availableModes.map(mode => mode.id))
      .toEqual(['normal', 'plan', 'goal']);
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process when the vault workspace resources change', async () => {
    // This CLI reads `.reasonix/skills` and `.agents/skills` when it starts.
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
      executable: '/usr/local/bin/reasonix',
      arguments: ['acp'],
    });
    // Nothing is forced into the environment: this CLI needs no quietening.
    expect(launch.environment.RUST_LOG).toBeUndefined();
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

    expect(launch.executable).toBe('reasonix');
    execution.dispose();
    await host.dispose();
  });

  it('refuses a reference it did not mint', async () => {
    const { execution, host, events } = await createHarness();

    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef: 'rxreq-0000000000000000000000000000000f',
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(host.registry.getRun(RUN_ID)).toMatchObject({ state: 'invalidated' });
    execution.dispose();
    await host.dispose();
  });
});
