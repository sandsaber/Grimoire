import '@/providers';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { OpencodeExecution } from '@/app/execution/opencode/OpencodeExecutionComposition';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, type InteractionId, runId } from '@/core/execution/ExecutionIds';
import { TOOL_READ } from '@/core/tools/toolNames';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpRequestPermissionResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';
import { OpencodeContentPresenter } from '@/providers/opencode/execution/OpencodeContentPresenter';
import { OPENCODE_EXECUTION_DESCRIPTOR } from '@/providers/opencode/execution/OpencodeExecutionBackend';
import { updateOpencodeProviderSettings } from '@/providers/opencode/settings';

/**
 * The half of the OpenCode flip that only exists in production.
 *
 * The backend takes three opaque references — the turn, the process to spawn,
 * the session config to apply — and knows what is inside none of them. This
 * module is the only place that knows all three, and wave 1 proved that a seam
 * both sides stub is a seam nobody tests.
 *
 * So this drives a whole turn with a fake ACP client as the only stand-in, and
 * asserts the thing the three reference spaces exist for: that the process the
 * launcher would spawn is `opencode acp`, under the config the artifacts just
 * wrote, resolved from the reference the turn minted.
 */
describe('OpenCode execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'2'.repeat(32)}`);
  const RUN_ID = runId(`run-${'2'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'opencode-tab' };

  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  function createPlugin(): any {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-opencode-composition-'));
    vaults.push(vault);
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
    };
    updateOpencodeProviderSettings(settings, { enabled: true });
    return {
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/opencode',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
    };
  }

  /** One ACP agent, without an agent. */
  function createFakeAcp(options: { asksPermission?: boolean } = {}): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
  } {
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const permissions: Array<Promise<AcpRequestPermissionResponse>> = [];
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        const ask = (): void => {
          permissions.push(input.requestPermission({
            sessionId: 'acp-session-1',
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'no', kind: 'reject_once', name: 'Deny' },
            ],
            toolCall: { toolCallId: 'tool-1', title: 'bash', rawInput: { command: 'ls' } },
          }));
        };
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          // What a session answers with when it opens, which is where the
          // models and the modes a tab can choose from are said.
          newSession: async () => ({
            sessionId: 'acp-session-1',
            models: {
              availableModels: [{ id: 'opencode/big-pickle', name: 'Big Pickle' }],
              currentModelId: 'opencode/big-pickle',
            },
            modes: {
              availableModes: [{ id: 'build', name: 'Build' }],
              currentModeId: 'build',
            },
          }),
          loadSession: async () => ({ sessionId: 'acp-session-1' }),
          prompt: async request => {
            prompts.push(request);
            if (options.asksPermission) {
              // ACP asks before it runs anything, and the turn does not finish
              // until the answer comes back — over a pipe, which is why the
              // work that follows it starts a task later rather than on the
              // same microtask drain. See the journal: a provider that answers
              // within that drain makes the kernel throw while it is still
              // committing the resolution.
              ask();
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            // Everything an ACP agent says, it says as a session update: the
            // work it did, the plan it is on, how full the context is, and the
            // answer. The stop reason ends the turn.
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tool-1',
                title: 'read',
                kind: 'read',
                status: 'completed',
                rawInput: { file_path: 'note.md' },
                content: [{ type: 'content', content: { type: 'text', text: 'note body' } }],
              },
            });
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'usage_update',
                used: 16_964,
                size: 200_000,
                cost: { amount: 0.25, currency: 'USD' },
              },
            });
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'the answer' },
              },
            });
            return {
              stopReason: 'end_turn',
              usage: { inputTokens: 15_940, outputTokens: 4, totalTokens: 16_979 },
            };
          },
          setConfigOption: async () => ({ configOptions: [] }),
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
    return { factory, startupRefs, prompts, permissions };
  }

  async function createHarness(options: { asksPermission?: boolean } = {}): Promise<{
    execution: OpencodeExecution;
    host: ExecutionKernelHost;
    startupRefs: string[];
    prompts: unknown[];
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
    const execution = new OpencodeExecution(createPlugin(), host.registry);
    const { factory, startupRefs, prompts, permissions } = createFakeAcp(options);
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    await host.registry.createSession({
      backendId: OPENCODE_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => events.push(envelope));
    return { execution, host, startupRefs, prompts, permissions, events };
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
    const kinds = events.map(envelope => envelope.event.kind);
    expect(kinds).toContain('run-started');
    const terminal = events.find(envelope => envelope.event.kind === 'terminal');
    expect(terminal?.event).toMatchObject({ terminal: 'succeeded' });
    execution.dispose();
    await host.dispose();
  });

  it('draws the tab from the content the same turn forwarded', async () => {
    // Both halves real, no stand-in between them: wave 1's lesson is that a
    // seam both sides stub is a seam nobody tests, and the payload the backend
    // emits is only a contract if something actually renders it.
    const { execution, host, events } = await createHarness();
    const costs: unknown[] = [];
    const opened: unknown[] = [];
    const presenter = new OpencodeContentPresenter({
      displayModel: () => 'opencode/big-pickle',
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
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
      name: TOOL_READ,
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      id: 'tool-1',
      content: 'note body',
    }));
    // The window comes from the update, the prompt's own tokens from the
    // answer, and the badge needs the pair.
    expect(chunks.filter(chunk => chunk.type === 'usage').at(-1)).toEqual(
      expect.objectContaining({
        sessionId: 'acp-session-1',
        usage: expect.objectContaining({
          contextWindow: 200_000,
          contextTokens: 16_964,
          inputTokens: 15_940,
        }),
      }),
    );
    expect(costs).toEqual([{ amount: 0.25, currency: 'USD' }]);
    // The models and modes the selectors are built from, which the session
    // says once and nothing repeats.
    expect(opened).toEqual([expect.objectContaining({
      sessionId: 'acp-session-1',
      models: expect.objectContaining({ currentModelId: 'opencode/big-pickle' }),
      modes: expect.objectContaining({ currentModeId: 'build' }),
    })]);
    expect(presenter.lastSessionId()).toBe('acp-session-1');
    // The answer itself stays on the kernel's channel; a second copy here
    // prints every sentence twice.
    expect(chunks.some(chunk => chunk.type === 'text')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('asks before it runs a command, in the words the tab renders', async () => {
    // ACP asks the client for permission before an edit or a command, so the
    // bridge is what stands between a flipped tab and a turn that hangs on a
    // prompt nobody was shown.
    const { execution, host, permissions, events } = await createHarness({
      asksPermission: true,
    });

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'list the vault' }],
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
        description: 'OpenCode wants to run a shell command.',
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

    // The agent hears the option it named, not the id the kernel recorded.
    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
    expect(execution.interactionBridge.presentation(opened.presentationRef)).toBeUndefined();
    execution.dispose();
    await host.dispose();
  });

  it('resolves the startup reference into the process a launcher would spawn', async () => {
    // The three reference spaces are the point of this composition, and this is
    // where they meet: the turn mints a startup reference, and what it stands
    // for is `opencode acp` under the config file the artifacts wrote for that
    // same turn. A launch built anywhere else would run the previous turn's
    // configuration.
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
      executable: '/usr/local/bin/opencode',
      arguments: ['acp'],
    });
    expect(launch.environment.OPENCODE_CONFIG).toContain('.grimoire');
    expect(launch.environment.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
    execution.dispose();
    await host.dispose();
  });

  it('refuses a reference it did not mint', async () => {
    // One store, or the reference resolves to nothing: the seam wave 1's
    // end-to-end turn failed on, asserted here before a flip can meet it.
    const { execution, host, events } = await createHarness();

    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef: 'ocreq-0000000000000000000000000000000f',
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(host.registry.getRun(RUN_ID)).toMatchObject({ state: 'invalidated' });
    execution.dispose();
    await host.dispose();
  });
});
