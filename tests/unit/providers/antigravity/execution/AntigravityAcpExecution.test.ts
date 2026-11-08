import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type { ManagedAcpLaunchInvocation } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { executionSessionId } from '@/core/execution/ExecutionIds';
import type { ApprovalDecision, StreamChunk } from '@/core/types';
import { JsonRpcErrorResponse } from '@/providers/acp';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpLoadSessionRequest,
  AcpPromptRequest,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionNotification,
  AcpSetSessionModelRequest,
  AcpStopReason,
} from '@/providers/acp/types';
import type { AntigravityProcessRunner } from '@/providers/antigravity/execution/AntigravityExecutionBackend';
import { AntigravityExecution } from '@/providers/antigravity/execution/AntigravityExecutionComposition';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

describe('Antigravity ACP execution composition', () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  function createPlugin(mode = 'normal'): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      savedProviderPermissionMode: { antigravity: mode },
      settingsProvider: 'codex',
      systemPrompt: '',
    };
    updateAntigravityProviderSettings(settings, {
      enabled: true,
      visibleModels: ['Gemini 4 Argon (Medium)'],
    });
    return {
      settings,
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/agy',
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
      getAllViews: () => [],
    };
  }

  function permissionRequest(sessionId: string): AcpRequestPermissionRequest {
    return {
      sessionId,
      options: [
        { optionId: 'yes-once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'no-once', kind: 'reject_once', name: 'Deny' },
      ],
      toolCall: {
        toolCallId: 'write-1',
        title: 'write_to_file',
        kind: 'edit',
        rawInput: { TargetFile: '/vault/notes/today.md' },
      },
    };
  }

  async function harness(options: {
    acp?: boolean;
    asksPermission?: boolean;
    mode?: string;
    rejectsPrompt?: boolean;
    dropsFirstPrompt?: boolean;
    rejectsLoad?: boolean;
    offersPlan?: boolean;
    plugin?: any;
    turns?: Array<{
      asksPermission?: boolean;
      permissionSession?: string;
      answer?: string;
      stopReason?: AcpStopReason;
    }>;
  } = {}) {
    const prompts: AcpPromptRequest[] = [];
    const loads: AcpLoadSessionRequest[] = [];
    const permissions: AcpRequestPermissionResponse[] = [];
    const models: AcpSetSessionModelRequest[] = [];
    const modes: string[] = [];
    const launches: ManagedAcpLaunchInvocation[] = [];
    const connections: ManagedAcpClientFactoryInput[] = [];
    const starts = jest.fn();
    const closes = jest.fn(async () => 'confirmed' as const);
    const newSessions = jest.fn(async () => ({
      sessionId: 'agy-native-1',
      configOptions: [{
        id: 'mode', name: 'Mode', type: 'select' as const, currentValue: 'default',
        options: [
          { value: 'default', name: 'Default' },
          { value: 'accept-edits', name: 'Accept Edits' },
          ...(options.offersPlan === false ? [] : [{ value: 'plan', name: 'Plan' }]),
        ],
      }],
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default' },
          ...(options.offersPlan === false ? [] : [{ id: 'plan', name: 'Plan' }]),
        ],
      },
      models: {
        currentModelId: 'gemini-4-argon-medium',
        availableModels: [{ modelId: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' }],
      },
    }));
    const factory: ManagedAcpClientFactory = {
      create: async input => {
        starts(input.startupRef);
        connections.push(input);
        const launch = await execution['acpRequests'].resolveLaunch(input.startupRef);
        launches.push(launch);
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          newSession: newSessions,
          loadSession: async request => {
            loads.push(request);
            if (options.rejectsLoad) throw new Error('Authentication is required.');
            return { sessionId: request.sessionId };
          },
          prompt: async request => {
            const turn = options.turns?.[prompts.length];
            prompts.push(request);
            if (options.rejectsPrompt) {
              throw new JsonRpcErrorResponse('session/prompt', -32000, 'Request refused by the provider.');
            }
            if (options.dropsFirstPrompt && prompts.length === 1) {
              throw new Error('Request aborted: session/prompt');
            }
            const nativeAutoApprove = launch.arguments.includes('--dangerously-skip-permissions');
            if (turn?.permissionSession
              || (turn?.asksPermission ?? (options.asksPermission && !nativeAutoApprove))) {
              permissions.push(await input.requestPermission(permissionRequest(
                turn?.permissionSession ?? request.sessionId,
              )));
            }
            const denied = permissions.at(-1)?.outcome;
            const answer = turn?.answer ?? (denied?.outcome === 'selected' && denied.optionId === 'no-once'
              ? 'Write denied.' : 'The ACP answer.');
            if (answer) notify?.({
              sessionId: request.sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: answer },
              },
            });
            return { stopReason: turn?.stopReason ?? 'end_turn' };
          },
          setConfigOption: async request => {
            if ('value' in request && typeof request.value === 'string') modes.push(request.value);
            return { configOptions: [] };
          },
          setMode: async request => { modes.push(request.modeId); return {}; },
          setModel: async request => { models.push(request); return {}; },
          cancel: () => undefined,
          onSessionNotification: listener => {
            notify = listener;
            return () => { notify = undefined; };
          },
          onConnectionLost: () => () => undefined,
          close: closes,
        };
        return client;
      },
    };
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const plugin = options.plugin ?? createPlugin(options.mode);
    const execution = new AntigravityExecution(plugin, host.registry, async () => ({
      acp: options.acp ?? true,
      addDir: false,
      printTimeout: false,
      streamJson: false,
    }));
    const printStart = jest.fn<ReturnType<AntigravityProcessRunner['start']>, Parameters<AntigravityProcessRunner['start']>>(() => ({
      started: Promise.resolve(),
      completed: Promise.resolve({ exitCode: 0, stdout: 'Print fallback.', stderr: '' }),
      outputLimitExceeded: new Promise(() => undefined),
      confirmTerminated: async () => true,
      terminate: async () => 'confirmed',
    }));
    host.registerBackend(execution.createBackendRegistration({ start: printStart }, factory));
    await host.start();
    cleanup.push(async () => { await execution.dispose(); await host.dispose(); });
    return {
      execution, host, plugin, prompts, loads, permissions, models, modes, launches, connections,
      starts, closes, newSessions, printStart,
      runtime: execution.createRuntime(),
    };
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) collected.push(chunk);
    return collected;
  }

  it.each(['allow', 'deny'] as const)('returns the user\'s %s decision to ACP in normal mode', async decision => {
    const { runtime, permissions, prompts, printStart } = await harness({ asksPermission: true });
    const approval = jest.fn(async (): Promise<ApprovalDecision> => decision);
    runtime.installInteractions({ approval });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Write the note.' })));

    expect(approval).toHaveBeenCalledTimes(1);
    expect(permissions).toEqual([{
      outcome: { outcome: 'selected', optionId: decision === 'allow' ? 'yes-once' : 'no-once' },
    }]);
    expect(prompts).toHaveLength(1);
    expect(chunks).toContainEqual({ type: 'text', content: decision === 'allow' ? 'The ACP answer.' : 'Write denied.' });
    expect(printStart).not.toHaveBeenCalled();
  });

  it('uses native Auto-approve without synthesizing approval replies in Grimoire', async () => {
    const { runtime, permissions, launches, printStart } = await harness({ asksPermission: true, mode: 'full_access' });
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'deny');
    runtime.installInteractions({ approval });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Write the note.' })));

    expect(approval).not.toHaveBeenCalled();
    expect(launches[0]?.arguments).toEqual(expect.arrayContaining(['acp', '--dangerously-skip-permissions']));
    expect(permissions).toEqual([]);
    expect(chunks).toContainEqual({ type: 'text', content: 'The ACP answer.' });
    expect(printStart).not.toHaveBeenCalled();
  });

  it('restarts the native process when entering and leaving Auto-approve', async () => {
    const { runtime, plugin, starts, closes, launches, loads } = await harness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'Safe.' })));

    plugin.settings.savedProviderPermissionMode.antigravity = 'full_access';
    await drain(runtime.query(runtime.prepareTurn({ text: 'Auto-approve.' })));
    plugin.settings.savedProviderPermissionMode.antigravity = 'normal';
    await drain(runtime.query(runtime.prepareTurn({ text: 'Safe again.' })));

    expect(starts).toHaveBeenCalledTimes(3);
    expect(closes).toHaveBeenCalledTimes(2);
    expect(launches.map(launch => launch.arguments.includes('--dangerously-skip-permissions')))
      .toEqual([false, true, false]);
    expect(loads).toHaveLength(2);
    expect(loads.every(request => request.sessionId === 'agy-native-1')).toBe(true);
  });

  it('changes Safe to Plan and back on the warm session using its remembered mode options', async () => {
    const { runtime, plugin, starts, modes, prompts } = await harness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'Safe.' })));
    plugin.settings.savedProviderPermissionMode.antigravity = 'plan';
    await drain(runtime.query(runtime.prepareTurn({ text: 'Plan.' })));
    plugin.settings.savedProviderPermissionMode.antigravity = 'normal';
    await drain(runtime.query(runtime.prepareTurn({ text: 'Safe again.' })));

    expect(starts).toHaveBeenCalledTimes(1);
    expect(modes).toEqual(['default', 'plan', 'default']);
    expect(prompts).toHaveLength(3);
  });

  it('refuses a foreign session permission even in native Auto-approve mode', async () => {
    const { runtime, permissions } = await harness({
      mode: 'full_access', turns: [{ permissionSession: 'another-native-session' }],
    });
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'allow');
    runtime.installInteractions({ approval });

    await drain(runtime.query(runtime.prepareTurn({ text: 'Answer.' })));

    expect(permissions).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(approval).not.toHaveBeenCalled();
  });

  it('refuses stale permissions after the owning run ends in native Auto-approve mode', async () => {
    const { runtime, connections } = await harness({ mode: 'full_access' });
    const approval = jest.fn(async (): Promise<ApprovalDecision> => 'allow');
    runtime.installInteractions({ approval });
    await drain(runtime.query(runtime.prepareTurn({ text: 'Answer.' })));

    await expect(connections[0].requestPermission(permissionRequest('agy-native-1')))
      .resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    expect(approval).not.toHaveBeenCalled();
  });

  it('accepts an empty denied end_turn only for that run, then rejects unrelated empty output', async () => {
    const { runtime, host, permissions } = await harness({
      turns: [{ asksPermission: true, answer: '' }, { answer: '' }],
    });
    runtime.syncConversationState({ id: 'empty-denied-chat', providerState: {}, sessionId: null });
    runtime.installInteractions({ approval: async () => 'deny' });

    const denied = await drain(runtime.query(runtime.prepareTurn({ text: 'Write.' })));

    expect(permissions).toEqual([{ outcome: { outcome: 'selected', optionId: 'no-once' } }]);
    expect(denied.some(chunk => chunk.type === 'text' || chunk.type === 'error')).toBe(false);
    expect(host.registry.getRunsForOwner({ kind: 'conversation', ownerId: 'empty-denied-chat' }))
      .toEqual([expect.objectContaining({ state: 'succeeded' })]);

    const ordinary = await drain(runtime.query(runtime.prepareTurn({ text: 'Answer.' })));

    expect(ordinary.some(chunk => chunk.type === 'error')).toBe(true);
    expect(host.registry.getRunsForOwner({ kind: 'conversation', ownerId: 'empty-denied-chat' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        state: 'failed', terminal: expect.objectContaining({ reason: 'missing-required-result' }),
      })]));
  });

  it.each([
    { decision: 'allow', asksPermission: false, stopReason: 'end_turn' },
    { decision: 'allow', asksPermission: true, stopReason: 'end_turn' },
    { decision: 'deny', asksPermission: true, stopReason: 'max_tokens' },
  ] as const)('rejects empty output with $decision, permission=$asksPermission and $stopReason', async scenario => {
    const { runtime, host } = await harness({ turns: [{ ...scenario, answer: '' }] });
    runtime.syncConversationState({ id: 'empty-failure-chat', providerState: {}, sessionId: null });
    runtime.installInteractions({ approval: async () => scenario.decision });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Answer.' })));

    expect(chunks.some(chunk => chunk.type === 'error')).toBe(true);
    expect(host.registry.getRunsForOwner({ kind: 'conversation', ownerId: 'empty-failure-chat' }))
      .toEqual([expect.objectContaining({
        state: 'failed', terminal: expect.objectContaining({ reason: 'missing-required-result' }),
      })]);
  });

  it('keeps native continuity without replaying an already bound conversation', async () => {
    const { runtime, loads, prompts, newSessions } = await harness();
    runtime.syncConversationState({ id: 'chat-1', providerState: {}, sessionId: 'agy-saved' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'Continue.' }), [{
      id: 'old-user', role: 'user', content: 'Already in native history.', timestamp: 1,
    }]));

    expect(loads).toEqual([expect.objectContaining({ sessionId: 'agy-saved' })]);
    expect(newSessions).not.toHaveBeenCalled();
    expect(prompts[0]?.sessionId).toBe('agy-saved');
    expect(JSON.stringify(prompts[0]?.prompt)).not.toContain('Already in native history.');
    expect(runtime.getSessionId()).toBe('agy-saved');
    expect(runtime.sessionBinding({ conversation: { id: 'chat-1' }, sessionInvalidated: false }))
      .toMatchObject({ sessionId: 'agy-saved' });
  });

  it('selects the native model ID matching the exact label saved by the model picker', async () => {
    const { runtime, models } = await harness();

    await drain(runtime.query(runtime.prepareTurn({ text: 'Answer.' }), [], {
      model: 'antigravity:Gemini 4 Argon (Medium)',
    }));

    expect(models).toEqual([{ sessionId: 'agy-native-1', modelId: 'gemini-4-argon-medium' }]);
  });

  it('rejects Plan before prompting when the ACP session does not offer it', async () => {
    const { runtime, prompts, printStart } = await harness({ mode: 'plan', offersPlan: false });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Plan only.' })));

    expect(prompts).toEqual([]);
    expect(printStart).not.toHaveBeenCalled();
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(true);
  });

  it('closes an idle ACP process and reloads its native session on the next turn', async () => {
    const { runtime, host, starts, closes, loads, newSessions } = await harness();
    runtime.syncConversationState({ id: 'chat-idle', providerState: {}, sessionId: null });
    await drain(runtime.query(runtime.prepareTurn({ text: 'First.' })));
    const sessions = host.registry.getSessionsForOwner({ kind: 'conversation', ownerId: 'chat-idle' });
    expect(sessions).toHaveLength(1);
    expect(runtime.getSessionId()).toBe('agy-native-1');

    await host.registry.suspendSession(executionSessionId(sessions[0].executionSessionId));

    expect(closes).toHaveBeenCalledTimes(1);
    await drain(runtime.query(runtime.prepareTurn({ text: 'Second.' })));
    expect(starts).toHaveBeenCalledTimes(2);
    expect(newSessions).toHaveBeenCalledTimes(1);
    expect(loads).toEqual([expect.objectContaining({ sessionId: 'agy-native-1' })]);
  });

  it('forwards context, vault skills and native image blocks in the ACP prompt', async () => {
    const plugin = createPlugin();
    plugin.getApplicationRuntimeOrNull = () => ({
      workspaceServicesFor: () => ({
        commandCatalog: { listVaultEntries: async () => [{ name: 'researcher', content: 'Cite every source.' }] },
      }),
    });
    const { runtime, prompts, printStart } = await harness({ plugin });
    const data = Buffer.from('image bytes').toString('base64');
    const prepared = runtime.prepareTurn({
      text: '/researcher Describe this.',
      currentNotePath: 'notes/today.md',
      contextFiles: ['notes/reference.md'],
      images: [{ id: 'img-1', name: 'drawing.png', mediaType: 'image/png', source: 'file', size: 11, data }],
    });

    await drain(runtime.query(prepared));

    const blocks = prompts[0]?.prompt ?? [];
    const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    expect(text).toContain('Cite every source.');
    expect(text).toContain('Describe this.');
    expect(text).toContain('notes/today.md');
    expect(text).toContain('notes/reference.md');
    expect(blocks).toContainEqual({ type: 'image', data, mimeType: 'image/png' });
    expect(text).not.toContain('grimoire-antigravity-images-');
    expect(printStart).not.toHaveBeenCalled();
  });

  it('does not replay a failed ACP prompt through print mode', async () => {
    const { runtime, prompts, printStart } = await harness({ rejectsPrompt: true, mode: 'full_access' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Do this once.' })));

    expect(prompts).toHaveLength(1);
    expect(printStart).not.toHaveBeenCalled();
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(true);
  });

  it('retains launch and model references while retrying a cold ACP transport disconnect', async () => {
    const { runtime, starts, closes, launches, models, modes, prompts, printStart } = await harness({
      dropsFirstPrompt: true,
    });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Answer once.' }), [], {
      model: 'antigravity:Gemini 4 Argon (Medium)',
    }));

    expect(starts).toHaveBeenCalledTimes(2);
    expect(starts.mock.calls[1]).toEqual(starts.mock.calls[0]);
    expect(closes).toHaveBeenCalledTimes(1);
    expect(launches.length).toBe(2);
    expect(launches[1] === launches[0]).toBe(true);
    expect(models).toEqual([
      { sessionId: 'agy-native-1', modelId: 'gemini-4-argon-medium' },
      { sessionId: 'agy-native-1', modelId: 'gemini-4-argon-medium' },
    ]);
    expect(modes).toEqual(['default', 'default']);
    expect(prompts).toHaveLength(2);
    expect(chunks).toContainEqual({ type: 'text', content: 'The ACP answer.' });
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(false);
    expect(printStart).not.toHaveBeenCalled();
  });

  it.each([false, true])('requires ACP for a saved native reference even when help lacks ACP (load failure: %s)', async rejectsLoad => {
    const { runtime, starts, loads, prompts, printStart } = await harness({
      acp: false, mode: 'full_access', rejectsLoad,
    });
    runtime.syncConversationState({ id: 'chat-saved', providerState: {}, sessionId: 'agy-saved' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Continue the saved session.' })));

    expect(starts).toHaveBeenCalledTimes(1);
    expect(loads).toEqual([expect.objectContaining({ sessionId: 'agy-saved' })]);
    expect(printStart).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(rejectsLoad ? 0 : 1);
    expect(chunks.some(chunk => chunk.type === 'error')).toBe(rejectsLoad);
  });
});
