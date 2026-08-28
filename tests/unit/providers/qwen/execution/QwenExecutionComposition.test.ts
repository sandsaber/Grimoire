import '@/providers';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, type InteractionId, runId } from '@/core/execution/ExecutionIds';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { TOOL_READ } from '@/core/tools/toolNames';
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
} from '@/providers/acp/types';
import { QwenContentPresenter } from '@/providers/qwen/execution/QwenContentPresenter';
import { QWEN_EXECUTION_DESCRIPTOR } from '@/providers/qwen/execution/QwenExecutionBackend';
import { QwenExecution } from '@/providers/qwen/execution/QwenExecutionComposition';
import {
  getQwenProviderSettings,
  updateQwenProviderSettings,
} from '@/providers/qwen/settings';

/**
 * The half of the Qwen flip that only exists in production.
 *
 * The backend takes three opaque references — the turn, the process to spawn,
 * the session config to apply — and knows what is inside none of them. This
 * module is the only place that knows all three, and wave 1 proved that a seam
 * both sides stub is a seam nobody tests.
 *
 * Run before the flip rather than after, because a flip that has to be reverted
 * to be tested is a flip nobody will revert.
 *
 * **Nothing the fake answers with was observed from Qwen.** `qwen 0.21.15`
 * refused `session/new` with "Authentication required" on the machine its wire
 * recording was taken from, so the model, the modes, the window and the answer
 * are all shapes rather than evidence — what stands behind them is
 * `QwenChatRuntime`, which has been driving this CLI on the legacy path. The
 * models use `modelId`, which *is* evidence: three recordings say so, and a fake
 * that wrote `id` is how a three-provider defect stayed hidden.
 */
describe('Qwen execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'8'.repeat(32)}`);
  const RUN_ID = runId(`run-${'8'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'qwen-tab' };

  const vaults: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  function createPlugin(): any {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-qwen-composition-'));
    vaults.push(vault);
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
    };
    updateQwenProviderSettings(settings, { enabled: true });
    return {
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/qwen',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
      // Both are called by the session sync, and a plugin without them throws
      // inside the handler that seeds the tab — leaving a half-applied session
      // that reads exactly like a composition which never asked.
      saveSettings: async () => undefined,
      getAllViews: () => [],
    };
  }

  /** One ACP agent, without an agent. */
  function createFakeAcp(options: {
    asksPermission?: boolean;
    sessionIsGone?: boolean;
    announcesCommands?: boolean;
    answersEffort?: boolean;
    distinctSessions?: boolean;
    reportsContextUsage?: boolean;
    suppressUsageUpdate?: boolean;
    asksQuestion?: boolean;
    dropsFirstPrompt?: boolean;
    refusesMode?: boolean;
    refusesSession?: string;
    rejectsPrompt?: string;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
    switchesMode?: string;
    windowOnFirstTurnOnly?: boolean;
  } = {}): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    modes: unknown[];
    models: unknown[];
    configOptions: unknown[];
    loadRequests: Array<{ sessionId: string }>;
  } {
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const permissions: Array<Promise<AcpRequestPermissionResponse>> = [];
    const modes: unknown[] = [];
    const models: unknown[] = [];
    const configOptions: unknown[] = [];
    const loadRequests: Array<{ sessionId: string }> = [];
    // Turns, not prompts: the injections below are about what a turn meets, and
    // `/effort` is configuration that happens to travel the same way. Counted
    // out here rather than per client, because a retry launches a second one and
    // "the first turn" has to mean the first turn of the run.
    let turns = 0;
    let sessionSeq = 0;
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        // One id per client where a test needs two tabs to be on two sessions;
        // otherwise the shared id every other case is written against.
        const sessionId = options.distinctSessions
          ? `acp-session-${(sessionSeq += 1)}`
          : 'acp-session-1';
        const askQuestion = (): void => {
          permissions.push(input.requestPermission({
            sessionId: 'acp-session-1',
            options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow' }],
            toolCall: {
              toolCallId: 'question-1',
              title: 'Ask user 2 questions',
              rawInput: { questions: [{ question: 'Which one?' }] },
            },
          }).catch(() => ({ outcome: { outcome: 'cancelled' as const } })));
        };
        const ask = (): void => {
          permissions.push(input.requestPermission({
            sessionId: 'acp-session-1',
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'no', kind: 'reject_once', name: 'Deny' },
            ],
            toolCall: {
              toolCallId: 'tool-1',
              title: 'WriteFile',
              kind: 'edit',
              rawInput: { path: 'notes/today.md' },
            },
          }));
        };
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          // The recorded `session/new` reply, values and all: four modes the
          // CLI names itself, a model list whose current is `auto`, and no
          // config options.
          newSession: async () => {
            if (options.refusesSession) {
              throw new JsonRpcErrorResponse('session/new', -32000, options.refusesSession);
            }
            return {
            sessionId,
            modes: {
              availableModes: [
                { id: 'default', name: 'Default', description: 'Prompts for approval' },
                { id: 'auto-edit', name: 'Auto Edit', description: 'Auto-approves edit tools' },
                { id: 'yolo', name: 'YOLO', description: 'Auto-approves all tools' },
                { id: 'plan', name: 'Plan', description: 'Read-only mode' },
              ],
              currentModeId: 'default',
            },
            models: {
              // `modelId`, which is what the recording says and what this fake
              // got wrong until Gemini's live smoke ran — three recordings
              // say `modelId`, this provider's among them: with `id` here every
              // consumer read `undefined`, and the one that called `.trim()`
              // threw inside the session open.
              availableModels: [
                { modelId: 'qwen3-coder-plus', name: 'qwen3-coder-plus' },
                { modelId: 'qwen3-max', name: 'qwen3-max' },
              ],
              currentModelId: 'qwen3-coder-plus',
            },
            };
          },
          loadSession: async request => {
            loadRequests.push(request);
            if (options.sessionIsGone) {
              throw new JsonRpcErrorResponse('session/load', -32603, 'session not found');
            }
            if (options.sessionLoadRefusal) {
              // What an unauthenticated CLI answers a *load* with: nothing
              // about the session, and nothing a new chat would fix. Recorded
              // from `kimi acp` and `qwen --acp`, which answer `session/new`
              // and `session/load` with the same sentence.
              throw new JsonRpcErrorResponse('session/load', -32000, options.sessionLoadRefusal);
            }
            if (options.sessionLoadFails) {
              throw new JsonRpcErrorResponse(
                'session/load',
                -32603,
                'Internal error: Qwen service failure',
                { service: 'session' },
              );
            }
            return { sessionId: request.sessionId };
          },
          prompt: async request => {
            prompts.push(request);
            // Configuration, not a turn. A real agent acknowledges `/effort` and
            // says nothing else — it does not run a tool, report a window or
            // produce an answer. A fake that streamed a whole turn here would
            // make every count and every failure injection below land on the
            // wrong prompt, which is what it did until this branch existed.
            if (request.prompt[0]?.type === 'text'
              && request.prompt[0].text.startsWith('/effort ')) {
              if (options.answersEffort) {
                notify?.({
                  sessionId: 'acp-session-1',
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    messageId: 'effort-ack',
                    content: { type: 'text', text: 'effort acknowledged' },
                  },
                });
              }
              return { stopReason: 'end_turn' };
            }
            turns += 1;
            if (options.asksQuestion) {
              askQuestion();
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            if (options.rejectsPrompt) {
              throw new JsonRpcErrorResponse('session/prompt', 429, options.rejectsPrompt);
            }
            if (options.dropsFirstPrompt && turns === 1) {
              // Not a JSON-RPC error response: nothing answered. This is the
              // shape the transport raises when the pipe is gone.
              throw new Error('Request aborted: session/prompt');
            }
            if (options.asksPermission) {
              // ACP asks before it runs anything, and the turn does not finish
              // until the answer comes back — over a pipe, which is why the
              // work that follows starts a task later rather than on the same
              // microtask drain.
              ask();
              await permissions.at(-1);
              await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            if (options.switchesMode) {
              // A switch somebody asked for, which is the one thing that may
              // move the toolbar: `/mode` typed into the composer moves the
              // session under the tab.
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
                  availableCommands: [{ name: 'clear', description: 'Clear the conversation' }],
                },
              } as unknown as AcpSessionNotification);
            }
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
            if (!options.suppressUsageUpdate
              && (!options.windowOnFirstTurnOnly || turns === 1)) {
              notify?.({
                sessionId: 'acp-session-1',
                update: {
                  sessionUpdate: 'usage_update',
                  used: 4_096,
                  size: 1_048_576,
                  cost: { amount: 0.25, currency: 'USD' },
                },
              });
            }
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                messageId: 'assistant-message',
                content: { type: 'text', text: 'the answer' },
              },
            });
            return {
              stopReason: 'end_turn',
              usage: { inputTokens: 3_900, outputTokens: 12, totalTokens: 3_912 },
            };
          },
          setMode: async request => {
            modes.push(request);
            if (options.refusesMode) {
              throw new JsonRpcErrorResponse(
                'session/set_mode',
                -32603,
                'Internal error',
                { details: 'Cannot enable privileged approval modes in an untrusted folder.' },
              );
            }
            return {};
          },
          setModel: async request => {
            models.push(request);
            return {};
          },
          setConfigOption: async request => {
            configOptions.push(request);
            return { configOptions: [] };
          },
          // The one question ACP has no method for. Answered here the way
          // `qwen 0.21.15` answers it, because nothing else reports this
          // provider's parent context window.
          vendorRequest: async (method: string) => (
            method === 'qwen/status/session/context_usage' && options.reportsContextUsage
              ? { usage: { contextWindowSize: 1_048_576, totalTokens: 4_096 } }
              : null
          ),
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
    return {
      factory, startupRefs, prompts, permissions, modes, models, configOptions, loadRequests,
    };
  }

  async function createHarness(options: {
    asksPermission?: boolean;
    plugin?: any;
    sessionIsGone?: boolean;
    announcesCommands?: boolean;
    answersEffort?: boolean;
    distinctSessions?: boolean;
    reportsContextUsage?: boolean;
    suppressUsageUpdate?: boolean;
    asksQuestion?: boolean;
    dropsFirstPrompt?: boolean;
    refusesMode?: boolean;
    refusesSession?: string;
    rejectsPrompt?: string;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
    switchesMode?: string;
    windowOnFirstTurnOnly?: boolean;
  } = {}): Promise<{
    execution: QwenExecution;
    host: ExecutionKernelHost;
    plugin: any;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    modes: unknown[];
    models: unknown[];
    configOptions: unknown[];
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
    const execution = new QwenExecution(plugin, host.registry);
    const {
      factory, startupRefs, prompts, permissions, modes, models, configOptions, loadRequests,
    } = createFakeAcp(options);
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    await host.registry.createSession({
      backendId: QWEN_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => events.push(envelope));
    return {
      execution,
      host,
      plugin,
      startupRefs,
      prompts,
      permissions,
      modes,
      models,
      configOptions,
      loadRequests,
      events,
    };
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

  /**
   * The prompts that were turns, which for this provider is not all of them.
   *
   * Qwen sets its reasoning level by *talking to the session* — `/effort <level>`
   * goes down `session/prompt` like anything else — so a test that counts
   * prompts is counting configuration too. Separated rather than tolerated,
   * because the count is what proves a refused turn is not retried.
   */
  function turnPrompts(prompts: readonly unknown[]): unknown[] {
    return prompts.filter(prompt => {
      const first = (prompt as { prompt?: Array<{ text?: string }> }).prompt?.[0];
      return !first?.text?.startsWith('/effort ');
    });
  }

  function effortPrompts(prompts: readonly unknown[]): string[] {
    return prompts
      .map(prompt => (prompt as { prompt?: Array<{ text?: string }> }).prompt?.[0]?.text ?? '')
      .filter(text => text.startsWith('/effort '));
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
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

    expect(turnPrompts(prompts)).toHaveLength(1);
    expect(events.map(envelope => envelope.event.kind)).toContain('run-started');
    expect(events.find(envelope => envelope.event.kind === 'terminal')?.event)
      .toMatchObject({ terminal: 'succeeded' });
    execution.dispose();
    await host.dispose();
  });

  it('draws the tab from the content the same turn forwarded', async () => {
    // Both halves real, no stand-in between them: the payload the backend emits
    // is only a contract if something actually renders it.
    const { execution, host, events } = await createHarness();
    const costs: unknown[] = [];
    const opened: unknown[] = [];
    const presenter = new QwenContentPresenter({
      displayModel: () => 'qwen:qwen3-coder-plus',
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
    // The agent's own word for the tool, not the canonical one its siblings map
    // to: this provider has no tool stream adapter at all, and giving it one
    // would change what a Qwen tool card says under cover of a migration.
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
      name: 'read',
    }));
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === TOOL_READ)).toBe(false);
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
          contextWindow: 1_048_576,
          contextTokens: 4_096,
          inputTokens: 3_900,
        }),
      }),
    );
    expect(costs).toEqual([{ amount: 0.25, currency: 'USD' }]);
    expect(opened).toEqual([expect.objectContaining({
      sessionId: 'acp-session-1',
      models: expect.objectContaining({ currentModelId: 'qwen3-coder-plus' }),
      modes: expect.objectContaining({ currentModeId: 'default' }),
    })]);
    expect(presenter.lastSessionId()).toBe('acp-session-1');
    // The answer itself stays on the kernel's channel; a second copy here
    // prints every sentence twice.
    expect(chunks.some(chunk => chunk.type === 'text')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('asks before it writes, in the words the tab renders', async () => {
    const { execution, host, permissions, events } = await createHarness({
      asksPermission: true,
    });

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'write the note' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    const opened = await waitForInteraction(events);

    // Deliberately not a vocabulary: this provider names its tool in the title,
    // and inventing a switch would mean guessing ids the recording never saw.
    expect(execution.interactionBridge.presentation(opened.presentationRef))
      .toEqual(expect.objectContaining({
        toolName: 'WriteFile',
        description: 'WriteFile requests access to notes/today.md.',
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

  it('renders a turn a tab can draw, and learns the session it is on', async () => {
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === 'read')).toBe(true);
    // Without this a tab starts a new session every turn: no resume across a
    // reload, and nothing to hydrate from.
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
    // The third finding of Gemini's live smoke, shared by every flipped ACP
    // provider, and the one that was a regression
    // rather than a defect: every legacy ACP runtime yielded the provider's own
    // error text, and the kernel path replaced it with a run whose outcome could
    // not be established. Found with the real thing — `429 You have exhausted
    // your daily quota on this model` — which the tab rendered as "Grimoire
    // could not establish whether this run completed."
    const { execution, host, prompts } = await createHarness({
      rejectsPrompt: 'You have exhausted your daily quota on this model.',
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content))
      .toEqual(['You have exhausted your daily quota on this model.']);
    // Once, not twice. The old path treated a refusal as a dead connection and
    // sent the same prompt again — a second request against a quota already
    // gone, and a second chance for the agent to act on it.
    expect(turnPrompts(prompts)).toHaveLength(1);
    expect(chunks.some(chunk => chunk.type === 'notice')).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('still retries a connection that died, which is what the refusal path took', async () => {
    // The discriminator has to cut both ways, or the fix trades one defect for
    // another: a dropped pipe is not the agent answering, and the retry it gets
    // is what makes a transient failure invisible instead of an error the user
    // has to act on. A plain `Error` is what the transport raises for one.
    const { execution, host, prompts, startupRefs } = await createHarness({
      dropsFirstPrompt: true,
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(turnPrompts(prompts)).toHaveLength(2);
    // A second process, because the first one is presumed dead.
    expect(startupRefs).toHaveLength(2);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    execution.dispose();
    await host.dispose();
  });

  it('says why the agent would not open a session, in the agent words', async () => {
    // The first thing a user without credentials meets, and what the harness
    // found: `qwen 0.21.15` answers `session/new` with "Authentication
    // required", and the classification alone could only guess — it told them a
    // saved session may have gone and to start a new chat, which would fail the
    // same way forever.
    const { execution, host } = await createHarness({
      refusesSession: 'Authentication required: Use Qwen Code CLI to authenticate first.',
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content))
      .toEqual(['Authentication required: Use Qwen Code CLI to authenticate first.']);
    execution.dispose();
    await host.dispose();
  });

  it('says what a turn that never started needs the person to do', async () => {
    // A *load* failure keeps the composition's own sentence, deliberately: what
    // an agent says about a session it cannot load is rarely actionable, while
    // "starting a new chat will create one" is.
    const { execution, host } = await createHarness({ sessionLoadFails: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses-that-is-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    const errors = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content);
    expect(errors).toEqual([
      'Qwen could not open the session this conversation was resumed from. Qwen said: Internal '
        + 'error: Qwen service failure. Starting a new chat helps only if the session itself is gone.',
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
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses-that-is-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content)).toEqual([
      'Qwen could not open the session this conversation was resumed from. '
        + 'Qwen said: Authentication required. Starting a new chat helps only if the '
        + 'session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('reports the session a turn actually ran in, not the one it was bound to', async () => {
    // The conversation remembers a session the agent no longer has. The backend
    // replaces it; a tab that kept reporting the old id would save the
    // conversation pointing at a session that does not exist.
    const { execution, host } = await createHarness({ sessionIsGone: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses-that-is-gone' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(runtime.getSessionId()).toBe('acp-session-1');
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

    await drain(runtime.query(runtime.prepareTurn({ text: 'write it' })));

    expect(asked).toEqual([{
      toolName: 'WriteFile',
      description: 'WriteFile requests access to notes/today.md.',
    }]);
    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
    execution.dispose();
    await host.dispose();
  });

  it('refuses a write on a session no open tab answers for', async () => {
    const plugin = createPlugin();
    // Not full access: that mode allows every write before anyone is asked, so
    // a harness left on it cannot see this decision at all.
    plugin.settings.permissionMode = 'plan';
    updateQwenProviderSettings(plugin.settings, { selectedMode: 'plan' });
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    const approval = jest.fn(async () => 'allow' as const);
    runtime.installInteractions({ approval: approval });
    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // The client factory is one process for every tab, so the tab is found by
    // the session the write arrived on. A session no tab owns has nobody to
    // ask, and the safe way to be wrong is to refuse.
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
    // A replacement session has to be told what came before; a bound one
    // already holds it, and saying it again says everything twice.
    const history = [
      { id: 'user-previous', role: 'user' as const, content: 'Keep the language rich.', timestamp: 1 },
    ];
    const { execution, host, prompts } = await createHarness();
    const fresh = execution.createRuntime();

    await drain(fresh.query(fresh.prepareTurn({ text: 'go on' }), history));

    const first = turnPrompts(prompts)[0] as { prompt: Array<{ text?: string }> };
    expect(first.prompt[0]?.text).toContain('Keep the language rich.');

    const bound = execution.createRuntime();
    bound.syncConversationState({ providerState: {}, sessionId: 'acp-session-saved' });
    await drain(bound.query(bound.prepareTurn({ text: 'go on' }), history));

    const second = turnPrompts(prompts)[1] as { prompt: Array<{ text?: string }> };
    expect(second.prompt[0]?.text).not.toContain('Keep the language rich.');
    execution.dispose();
    await host.dispose();
  });

  it('reads its own permission mode, not whichever provider was toggled last', async () => {
    // `settings.permissionMode` is shared: the coordinator projects the active
    // provider's value into it. Reading it directly is how another provider's
    // Auto-approve came to switch off this one's containment and skip its write
    // approvals — and the composition is where that question is asked now.
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'full_access';
    plugin.settings.savedProviderPermissionMode = { qwen: 'normal' };
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
    // The user's pick, which the session's own default must not overwrite.
    plugin.settings.permissionMode = 'plan';
    updateQwenProviderSettings(plugin.settings, { selectedMode: 'plan' });
    const { execution, host, modes } = await createHarness({ plugin });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    // The session sync is started by the content channel and settled off the
    // turn, so waiting for the turn is not waiting for it. Waited for by the
    // thing the same call seeds — otherwise an unchanged setting only means the
    // sync had not run yet, which every wrong version of this would also pass.
    await waitFor(() => getQwenProviderSettings(plugin.settings).availableModes.length > 0);

    // `session/new` reports where the agent starts, not a switch. Adopting it
    // moved `selectedMode`, which is the field the *next turn's* mode is
    // resolved from — so a vault on Plan sent no `set_mode` at all and ran in
    // the agent's default.
    expect(synced).toEqual([]);
    expect(getQwenProviderSettings(plugin.settings).selectedMode).toBe('plan');
    expect(modes).toEqual([expect.objectContaining({ modeId: 'plan' })]);
    execution.dispose();
    await host.dispose();
  });

  it('follows the session into a mode somebody switched it to', async () => {
    // The other door, and the one that may move the toolbar: `/mode` typed into
    // the composer moves the session under the tab. `autoEdit` auto-approves an
    // edit and still asks before a command, so it is Safe rather than
    // Auto-approve — telling the user otherwise would say they gave away more
    // than they have.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin, switchesMode: 'auto-edit' });
    const runtime = execution.createRuntime();
    const synced: string[] = [];
    runtime.installInteractions({ permissionModeSync: mode => synced.push(mode) });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => synced.length > 0);

    expect(synced).toEqual(['normal']);
    expect(getQwenProviderSettings(plugin.settings).selectedMode).toBe('normal');
    execution.dispose();
    await host.dispose();
  });

  it('does not carry one turn context report into the next', async () => {
    // The turn boundary. What the normalizer holds and how full the context was
    // belong to the turn that reported them, and Qwen reports the window on an
    // update rather than in the answer — so a turn that reports none would show
    // the previous turn's numbers as its own until one arrived.
    const { execution, host } = await createHarness({ windowOnFirstTurnOnly: true });
    const runtime = execution.createRuntime();

    const first = await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    const second = await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    expect(first.some(chunk => chunk.type === 'usage'
      && chunk.usage?.contextTokens === 4_096)).toBe(true);
    expect(second.some(chunk => chunk.type === 'usage'
      && chunk.usage?.contextTokens === 4_096)).toBe(false);
    execution.dispose();
    await host.dispose();
  });

  it('answers the turn even when the agent will not take the mode', async () => {
    // Gemini's live smoke found this, and the tolerance is shared rather than
    // this provider's own observation: `gemini 0.55.1` advertises four modes
    // and refuses the privileged two in a folder it has not been told to trust,
    // and the set is awaited before the prompt — so a thrown rejection killed
    // every turn run with Auto-approve on. Qwen's session has never opened, so
    // whether it behaves the same is unknown; surviving a refusal costs nothing
    // if it does not.
    const plugin = createPlugin();
    plugin.settings.permissionMode = 'full_access';
    updateQwenProviderSettings(plugin.settings, { selectedMode: 'full_access' });
    const logged: Array<Record<string, unknown>> = [];
    plugin.recordDebugLog = (record: Record<string, unknown>) => logged.push(record);
    const { execution, host, modes } = await createHarness({ plugin, refusesMode: true });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(modes).toEqual([{ modeId: 'yolo', sessionId: 'acp-session-1' }]);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(logged).toContainEqual(expect.objectContaining({
      event: 'execution.setMode.refused',
      data: { modeId: 'yolo' },
    }));

    // The session is now in a mode the toolbar does not show. Stricter than
    // promised, which is the safe way to be wrong — and still wrong, so the
    // person is told on the turn it happened to, in the toolbar's own word for
    // the mode and with the agent's reason behind it. A log entry nobody opens
    // is not being told.
    expect(chunks.filter(chunk => chunk.type === 'notice')).toEqual([{
      type: 'notice',
      level: 'warning',
      content: 'Qwen did not switch to Auto-approve: Cannot enable privileged approval modes '
        + 'in an untrusted folder. This turn ran in the mode the session was already in.',
    }]);

    // Once per session, not once per turn: the folder is what the agent is
    // refusing over, and it does not change between turns — a notice on every
    // one of them is noise a user learns to skip past.
    const second = await drain(runtime.query(runtime.prepareTurn({ text: 'again' })));
    expect(second.filter(chunk => chunk.type === 'notice')).toEqual([]);
    execution.dispose();
    await host.dispose();
  });

  it('talks the session into an effort, and only when it is not already there', async () => {
    // This provider's reasoning level is a `/effort <level>` prompt, which the
    // vendor charges for like any other turn. So it is asked for once and then
    // skipped — and the skip is the whole reason `dynamicConfiguration` treats
    // it differently from the mode and the model, which are sent every turn.
    const plugin = createPlugin();
    updateQwenProviderSettings(plugin.settings, { effortLevel: 'max' });
    const { execution, host, prompts } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    expect(effortPrompts(prompts)).toEqual(['/effort max']);

    await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    expect(effortPrompts(prompts)).toEqual(['/effort max']);
    expect(turnPrompts(prompts)).toHaveLength(2);
    execution.dispose();
    await host.dispose();
  });

  it('does not let one tab effort stand in for another tab session', async () => {
    // The applier is one object for every tab, and it reports while the session
    // is still being prepared — before any tab has been told its own session id.
    // A level recorded without the session it was applied to let the second tab
    // skip a `/effort` its own session never received, and then run at the
    // agent's default for the life of the conversation, silently, because
    // nothing reports a level back.
    const plugin = createPlugin();
    updateQwenProviderSettings(plugin.settings, { effortLevel: 'max' });
    const { execution, host, prompts } = await createHarness({ plugin, distinctSessions: true });

    // Both open before either runs, which is the case that reproduces: a tab
    // created afterwards was never told anything and asks for its own level
    // regardless.
    const first = execution.createRuntime();
    const second = execution.createRuntime();

    await drain(first.query(first.prepareTurn({ text: 'first tab' })));
    await drain(second.query(second.prepareTurn({ text: 'second tab' })));

    // One each, not one shared between them.
    expect(effortPrompts(prompts)).toEqual(['/effort max', '/effort max']);
    execution.dispose();
    await host.dispose();
  });

  it('draws nothing the effort prompt answers', async () => {
    // It is a prompt, so the agent may say something back — and whatever it says
    // is not part of the conversation. What keeps it out is ordering: the
    // applier runs while the session is being prepared, before the run has a
    // session reference to match a notification against.
    const plugin = createPlugin();
    updateQwenProviderSettings(plugin.settings, { effortLevel: 'low' });
    const { execution, host } = await createHarness({ plugin, answersEffort: true });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'text'
      && chunk.content.includes('effort acknowledged'))).toBe(false);
    expect(chunks.some(chunk => chunk.type === 'text'
      && chunk.content.includes('the answer'))).toBe(true);
    execution.dispose();
    await host.dispose();
  });

  it('asks the person the question, and sends the answers back with the choice', async () => {
    // The first interaction of `kind: 'question'` the product has ever carried.
    // The kernel has modelled the kind since M1 and nothing opened one, because
    // a resolution could carry a response id and nothing else — and this
    // provider's reply needs the answers beside the option id. That is what
    // `InteractionResolution.payload` is for, and this is the whole path:
    // agent → bridge → kernel → the tab's question callback → back.
    const { execution, host, permissions } = await createHarness({ asksQuestion: true });
    const runtime = execution.createRuntime();
    const approvals: string[] = [];
    const shown: unknown[] = [];
    runtime.installInteractions({ approval: async (tool: string) => {
      approvals.push(tool);
      return 'allow';
    } });
    runtime.installInteractions({ question: async input => {
      shown.push(input);
      return { 'Which one?': 'the second' };
    } });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // Not an approval. Nobody is asked to allow or deny a question.
    expect(approvals).toEqual([]);
    expect(shown).toEqual([{ questions: [expect.objectContaining({ question: 'Which one?' })] }]);
    // Keyed by position, which is how the agent reads them back.
    await expect(permissions[0]).resolves.toEqual({
      answers: { 0: 'the second' },
      outcome: { optionId: 'once', outcome: 'selected' },
    });
    execution.dispose();
    await host.dispose();
  });

  it('tells the agent nobody answered when the surface has no way to ask', async () => {
    // A tab that installed no question callback cannot show one, and a turn
    // waiting on a prompt nothing will draw never ends. Cancelled is the honest
    // answer and the one the legacy runtime gives.
    const { execution, host, permissions } = await createHarness({ asksQuestion: true });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    await expect(permissions[0]).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    execution.dispose();
    await host.dispose();
  });

  it('lists the commands the open session announced, and forgets them with it', async () => {
    // This provider surfaces what a session announces, where Gemini drops it —
    // so the tab holds them, and the tab is the only thing that can: the vault
    // catalogue does not know what this session offered.
    const { execution, host } = await createHarness({ announcesCommands: true });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect((await runtime.getSupportedCommands()).map(command => command.name))
      .toEqual(['clear']);

    // Another conversation is another session, and what that one announced says
    // nothing about this one. Bound to a session of its own rather than to none,
    // because a tab with no session lists nothing anyway — which would hide a
    // stale list rather than prove it was cleared.
    runtime.syncConversationState({
      id: 'conv-other',
      providerState: {},
      sessionId: 'acp-session-other',
    });

    expect(await runtime.getSupportedCommands()).toEqual([]);
    execution.dispose();
    await host.dispose();
  });

  it('asks the agent how full the context is, because nothing else says', async () => {
    // No `usage_update` this provider sends carries the parent window — the
    // legacy runtime reads it from `qwen/status/session/context_usage` once per
    // turn, after the prompt returns. Ported rather than dropped: the flip must
    // not take the badge with it.
    // No `usage_update` at all, which is what this provider actually sends —
    // so the only place the badge's numbers can come from is the vendor call.
    const { execution, host } = await createHarness({
      reportsContextUsage: true,
      suppressUsageUpdate: true,
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'usage').at(-1)).toEqual(
      expect.objectContaining({
        usage: expect.objectContaining({ contextWindow: 1_048_576, contextTokens: 4_096 }),
      }),
    );
    execution.dispose();
    await host.dispose();
  });

  it('shows a badge without a number when the agent has no such method', async () => {
    // The extension is optional: an older Qwen simply does not answer it, and a
    // window nobody could read is not a failed turn.
    const { execution, host } = await createHarness({
      reportsContextUsage: false,
      suppressUsageUpdate: true,
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text'
      && chunk.content.includes('the answer'))).toBe(true);
    execution.dispose();
    await host.dispose();
  });

  it('learns the vault models from the session the turn opened', async () => {
    // A Qwen vault learns what its models are by opening a session and being
    // told; nothing else answers that question.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));
    await waitFor(() => getQwenProviderSettings(plugin.settings).discoveredModels.length > 0);

    expect(getQwenProviderSettings(plugin.settings).discoveredModels)
      .toEqual([
        expect.objectContaining({ rawId: 'qwen3-coder-plus' }),
        expect.objectContaining({ rawId: 'qwen3-max' }),
      ]);
    execution.dispose();
    await host.dispose();
  });

  it('dispatches the turn under a mode the agent actually has', async () => {
    const plugin = createPlugin();
    updateQwenProviderSettings(plugin.settings, { selectedMode: 'full_access' });
    plugin.settings.permissionMode = 'full_access';
    const { execution, host, modes, models, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // The third reference space, end to end, and the translation with it:
    // `full_access` is Grimoire's word and not one of the four this agent named,
    // so sending it is a mode the agent does not have — and the call is awaited
    // before the prompt, which ends the turn rather than degrading it.
    expect(modes).toEqual([{ modeId: 'yolo', sessionId: 'acp-session-1' }]);
    // And nothing through a config option, because the session offers none.
    expect(configOptions).toEqual([]);
    // And no model, on this turn: see below — a vault that has never opened a
    // session does not yet know one to ask for.
    expect(models).toEqual([]);
    execution.dispose();
    await host.dispose();
  });

  it('sets the model a vault has learned, and none before it has learned one', async () => {
    // The chicken and the egg this provider actually has: the model list is
    // answered by `session/new`, so a tab's first turn is composed before
    // anything knows what to ask for. It runs on the agent's own current model
    // and the turn that discovers the list is what
    // makes the next one able to name it.
    const plugin = createPlugin();
    const { execution, host, models } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'first' })));
    expect(models).toEqual([]);
    await waitFor(() => getQwenProviderSettings(plugin.settings).visibleModels.length > 0);

    await drain(runtime.query(runtime.prepareTurn({ text: 'second' })));

    expect(models).toEqual([{ modelId: 'qwen3-coder-plus', sessionId: 'acp-session-1' }]);
    execution.dispose();
    await host.dispose();
  });

  it('asks its questions in a process bound to no conversation', async () => {
    const plugin = createPlugin();
    const { execution, host, startupRefs } = await createHarness({ plugin });

    await expect(execution.metadata.discoverMetadata()).resolves.toBe(true);

    expect(startupRefs).toHaveLength(1);
    const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
    // A flag, not a subcommand — the wave-7 difference.
    expect(launch.arguments).toEqual(['--acp']);
    // The answer the model catalog builds a whole chat runtime to get today.
    expect(getQwenProviderSettings(plugin.settings).discoveredModels)
      .toEqual([
        expect.objectContaining({ rawId: 'qwen3-coder-plus' }),
        expect.objectContaining({ rawId: 'qwen3-max' }),
      ]);
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process when the vault workspace resources change', async () => {
    // This CLI reads `.qwen/skills`, `.qwen/commands` and `.qwen/agents` when it
    // starts, and a process already running was told them once. The legacy
    // runtime shut it down; here the launch key changes, which is what the
    // settings surface is really asking for when it calls this.
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
    // The legacy runtime shut the process down on an MCP reload so the next
    // turn's session picks the servers up. Here the launch key is what says a
    // running process cannot be told, and the fingerprint is what restarts it.
    const { execution, host } = await createHarness();
    const servers: unknown[] = [];
    // Stubbed where the composition now asks: it reaches the provider's own
    // services rather than a registry accessor keyed by a provider id string.
    jest.spyOn(ProviderWorkspaceRegistry, 'getServices').mockReturnValue({
      mcpServerManager: { getServers: () => servers },
    } as never);

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
      executable: '/usr/local/bin/qwen',
      arguments: ['--acp'],
    });
    execution.dispose();
    await host.dispose();
  });

  it('falls back to the command the CLI actually installs', async () => {
    const plugin = createPlugin();
    // Nothing resolved: no absolute path in settings, and nothing found on
    // PATH. What is spawned then is this string, and getting it wrong is
    // "command not found" for every user who has not set an absolute path.
    plugin.getResolvedProviderCliPath = () => null;
    const { execution, host } = await createHarness({ plugin });

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    expect(launch.executable).toBe('qwen');
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
      requestRef: 'qwreq-0000000000000000000000000000000f',
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(host.registry.getRun(RUN_ID)).toMatchObject({ state: 'invalidated' });
    execution.dispose();
    await host.dispose();
  });
});
