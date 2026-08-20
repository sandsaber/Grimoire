import '@/providers';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { GrokExecution } from '@/app/execution/grok/GrokExecutionComposition';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, type InteractionId, runId } from '@/core/execution/ExecutionIds';
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
          newSession: async () => ({
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
          loadSession: async request => ({ sessionId: request.sessionId }),
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
            notify?.({
              sessionId: 'grok-session',
              update: {
                sessionUpdate: 'agent_message_chunk',
                messageId: 'assistant-message',
                content: { type: 'text', text: 'the answer' },
              },
            });
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
  } = {}): Promise<{
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
    const execution = new GrokExecution(options.plugin ?? createPlugin(), host.registry);
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
    return { execution, host, events, ...fake };
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
