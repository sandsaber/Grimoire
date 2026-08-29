import '@/providers';

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, type InteractionId, runId } from '@/core/execution/ExecutionIds';
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
import { OpencodeContentPresenter } from '@/providers/opencode/execution/OpencodeContentPresenter';
import { OPENCODE_EXECUTION_DESCRIPTOR } from '@/providers/opencode/execution/OpencodeExecutionBackend';
import { OpencodeExecution } from '@/providers/opencode/execution/OpencodeExecutionComposition';
import {
  getOpencodeProviderSettings,
  updateOpencodeProviderSettings,
} from '@/providers/opencode/settings';

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

  let stubbedWorkspaceServices: unknown = null;

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
      getApplicationRuntimeOrNull: () => ({
        workspaceServicesFor: () => stubbedWorkspaceServices,
      }),
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/opencode',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
      // Both are called by the session sync this harness drives. Without them
      // the handler that seeds the tab throws halfway, the composition catches
      // it and logs, and every test here ran against a half-applied session —
      // the models seeded, the modes never asked about. Grok's harness has had
      // them since its own flip; this one had not.
      saveSettings: async () => undefined,
      getAllViews: () => [],
    };
  }

  /** One ACP agent, without an agent. */
  function createFakeAcp(options: {
    asksPermission?: boolean;
    offersEffort?: boolean;
    sessionForgotten?: boolean;
    sessionIsGone?: boolean;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
  } = {}): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    configOptions: unknown[];
    loadRequests: Array<{ sessionId: string }>;
    closes: string[];
    permissionAnswers: AcpRequestPermissionResponse[];
    askAnything: () => Promise<void> | undefined;
  } {
    let askAnythingRef: (() => Promise<void>) | undefined;
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const permissions: Array<Promise<AcpRequestPermissionResponse>> = [];
    const configOptions: unknown[] = [];
    const loadRequests: Array<{ sessionId: string }> = [];
    const closes: string[] = [];
    const permissionAnswers: AcpRequestPermissionResponse[] = [];
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        const askAnything = async (): Promise<void> => {
          permissionAnswers.push(await input.requestPermission({
            sessionId: 'acp-session-1',
            options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow' }],
            toolCall: { toolCallId: 'tool-9', title: 'write', rawInput: { path: 'note.md' } },
          }));
        };
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
        askAnythingRef = askAnything;
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          // What a session answers with when it opens, which is where the
          // models and the modes a tab can choose from are said.
          newSession: async () => ({
            sessionId: 'acp-session-1',
            ...(options.offersEffort
              ? {
                configOptions: [{
                  category: 'thought_level',
                  currentValue: 'low',
                  id: 'effort',
                  name: 'Effort',
                  options: [{ name: 'Low', value: 'low' }, { name: 'High', value: 'high' }],
                  type: 'select',
                }],
              }
              : {}),
            models: {
              availableModels: [{ id: 'opencode/big-pickle', name: 'Big Pickle' }],
              currentModelId: 'opencode/big-pickle',
            },
            modes: {
              availableModes: [{ id: 'build', name: 'Build' }],
              currentModeId: 'build',
            },
          }),
          // What OpenCode answers when asked which sessions it still has. The
          // conversation's own id is never in it: the point of the option is a
          // session the agent has forgotten.
          ...(options.sessionForgotten
            ? { listSessions: async () => ({ sessions: [{ sessionId: 'acp-session-1' }] }) }
            : {}),
          loadSession: async request => {
            loadRequests.push(request);
            if (options.sessionForgotten) {
              // The refusal OpenCode 1.18.18 actually sends for a session it
              // does not have: nothing in the words says so, which is why the
              // listing is asked for at all.
              throw new JsonRpcErrorResponse(
                'session/load',
                -32603,
                'Internal error: OpenCode service failure',
                { service: 'session' },
              );
            }
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
              // What OpenCode 1.18.18 actually answers for a session it does
              // not have: nothing about the session at all.
              throw new JsonRpcErrorResponse(
                'session/load',
                -32603,
                'Internal error: OpenCode service failure',
                { service: 'session' },
              );
            }
            return { sessionId: request.sessionId };
          },
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
                // One id for every turn, the way an agent that numbers its
                // messages per session does.
                messageId: 'assistant-message',
                content: { type: 'text', text: 'the answer' },
              },
            });
            return {
              stopReason: 'end_turn',
              usage: { inputTokens: 15_940, outputTokens: 4, totalTokens: 16_979 },
            };
          },
          setMode: async () => ({}),
          setModel: async () => ({}),
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
      factory, startupRefs, prompts, permissions, configOptions, loadRequests, closes,
      permissionAnswers, askAnything: () => askAnythingRef?.(),
    };
  }

  async function createHarness(options: {
    asksPermission?: boolean;
    offersEffort?: boolean;
    plugin?: any;
    sessionForgotten?: boolean;
    sessionIsGone?: boolean;
    sessionLoadFails?: boolean;
    sessionLoadRefusal?: string;
  } = {}): Promise<{
    execution: OpencodeExecution;
    host: ExecutionKernelHost;
    startupRefs: string[];
    prompts: unknown[];
    permissions: Array<Promise<AcpRequestPermissionResponse>>;
    configOptions: unknown[];
    loadRequests: Array<{ sessionId: string }>;
    closes: string[];
    permissionAnswers: AcpRequestPermissionResponse[];
    askAnything: () => Promise<void> | undefined;
    events: ExecutionEventEnvelope[];
  }> {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new OpencodeExecution(options.plugin ?? createPlugin(), host.registry);
    const {
      factory, startupRefs, prompts, permissions, configOptions, loadRequests, closes,
      permissionAnswers, askAnything,
    } = createFakeAcp(options);
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    await host.registry.createSession({
      backendId: OPENCODE_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => events.push(envelope));
    return {
      execution, host, startupRefs, prompts, permissions, configOptions, loadRequests, closes,
      permissionAnswers, askAnything, events,
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

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

  it('renders a turn a tab can draw, and learns the session it is on', async () => {
    // The runtime half end to end: a tab prepares a turn, the kernel dispatches
    // it, the agent answers, and what comes back is what the surface draws —
    // the text the kernel carries and the card the presenter makes from the
    // update carried beside it.
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === TOOL_READ)).toBe(true);
    // Without this a tab starts a new session every turn: no resume across a
    // reload, and nothing to hydrate from.
    expect(runtime.getSessionId()).toBe('acp-session-1');
    execution.dispose();
    await host.dispose();
  });

  it('resumes the session the conversation remembers', async () => {
    // The tab knows which ACP session this conversation is on, and the kernel
    // session has to be created with it or the backend has nothing to load —
    // every reload starting a new session with the conversation left behind.
    const { execution, host, loadRequests } = await createHarness();
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'acp-session-saved' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(loadRequests).toEqual([expect.objectContaining({ sessionId: 'acp-session-saved' })]);
    expect(runtime.getSessionId()).toBe('acp-session-saved');
    execution.dispose();
    await host.dispose();
  });

  it('says what a turn that never started needs the person to do', async () => {
    // OpenCode answers an unknown session with a generic service failure, and
    // the resume policy keeps a binding rather than replacing it on an error
    // that vague — so without provider wording the conversation repeats the
    // neutral sentence on every turn with nothing to act on.
    const { execution, host } = await createHarness({ sessionLoadFails: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses-that-is-gone' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    const errors = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content);
    expect(errors).toEqual([
      'OpenCode could not open the session this conversation was resumed from. OpenCode said: '
        + 'Internal error: OpenCode service failure. Starting a new chat helps only if the session '
        + 'itself is gone.',
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
      'OpenCode could not open the session this conversation was resumed from. '
        + 'OpenCode said: Authentication required. Starting a new chat helps only if the '
        + 'session itself is gone.',
    ]);
    execution.dispose();
    await host.dispose();
  });

  it('reports the session a turn actually ran in, not the one it was bound to', async () => {
    // The conversation remembers a session the agent no longer has. The backend
    // replaces it; a tab that kept reporting the old id would save the
    // conversation pointing at a session that does not exist, and every turn
    // after this one would start over. Found by a live run.
    const { execution, host } = await createHarness({ sessionIsGone: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({
      providerState: {},
      sessionId: 'ses-that-is-gone',
    });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(runtime.getSessionId()).toBe('acp-session-1');
    execution.dispose();
    await host.dispose();
  });

  it('remembers that the session it resumed into was not the one it was asked for', async () => {
    // The conversation's history is on screen and the agent has never seen it.
    // Nothing else says so: the turn succeeds, the tab is bound to a live
    // session, and the transcript above it reads as the agent's memory.
    const { execution, host } = await createHarness({ sessionForgotten: true });
    const runtime = execution.createRuntime();
    runtime.syncConversationState({ id: 'conv-1', providerState: {}, sessionId: 'ses-forgotten' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(runtime.isSessionDropped()).toBe(true);
    // Written into the conversation, because the tab that draws the notice is
    // usually a later one than the tab that learned this.
    expect(runtime.sessionBinding({
      conversation: { id: 'conv-1' },
      sessionInvalidated: false,
    })?.providerState).toMatchObject({ sessionDropped: true });
    execution.dispose();
    await host.dispose();
  });

  it('carries a drop into the tab that opens the conversation next', async () => {
    // The marker is read back on bind: the runtime that learned it is gone by
    // the time anyone sees the thread again.
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

  it('takes the marker back off once a resume succeeds', async () => {
    // The notice comes down when the conversation has real memory again, which
    // is the first turn that loads the session it was bound to.
    const { execution, host } = await createHarness();
    const runtime = execution.createRuntime();
    runtime.syncConversationState({
      id: 'conv-1',
      providerState: { sessionDropped: true },
      sessionId: 'acp-session-saved',
    });

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(runtime.isSessionDropped()).toBe(false);
    expect(runtime.sessionBinding({
      conversation: { id: 'conv-1' },
      sessionInvalidated: false,
    })?.providerState).not.toMatchObject({ sessionDropped: true });
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

    expect(asked).toEqual([{
      toolName: 'bash',
      description: 'OpenCode wants to run a shell command.',
    }]);
    // What the tab chose, in the agent's own vocabulary: the point of the
    // bridge is that this arrives as a permission rather than as a chunk.
    await expect(permissions[0]).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
    execution.dispose();
    await host.dispose();
  });

  it('learns the vault models from the session the turn opened', async () => {
    // An OpenCode vault learns what its models are by opening a session and
    // being told; nothing else answers that question.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(getOpencodeProviderSettings(plugin.settings).discoveredModels)
      .toEqual([expect.objectContaining({ rawId: 'opencode/big-pickle' })]);
    execution.dispose();
    await host.dispose();
  });

  it('dispatches the turn under the mode the tab is set to', async () => {
    const plugin = createPlugin();
    updateOpencodeProviderSettings(plugin.settings, { selectedMode: 'plan' });
    plugin.settings.permissionMode = 'plan';
    const { execution, host, configOptions } = await createHarness({ plugin });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // The third reference space, end to end: what the tab is set to reaches
    // the session as a `setConfigOption` before the prompt is sent.
    expect(configOptions).toContainEqual(expect.objectContaining({
      configId: 'mode',
      sessionId: 'acp-session-1',
      value: 'plan',
    }));
    execution.dispose();
    await host.dispose();
  });

  it('forces the Claude prompt flag while preserving the project config flag', async () => {
    const plugin = createPlugin();
    plugin.settings.sharedEnvironmentVariables =
      'OPENCODE_DISABLE_PROJECT_CONFIG=false\nOPENCODE_DISABLE_CLAUDE_CODE_PROMPT=false';
    const { execution, host } = await createHarness({ plugin });

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    // The vault's own OpenCode variables are honoured; the one Grimoire owns —
    // OpenCode reading Claude's prompt files — is not negotiable.
    expect(launch.environment.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('false');
    expect(launch.environment.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
    execution.dispose();
    await host.dispose();
  });

  it('asks its questions in a process bound to no conversation', async () => {
    // The four surfaces that ask what models exist must not bind a session to
    // a tab or write OpenCode state into the vault while they do it.
    const { execution, host, startupRefs } = await createHarness();

    await execution.metadata.discoverMetadata();

    expect(startupRefs).toHaveLength(1);
    const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
    expect(launch.environment.OPENCODE_DB).toBe(':memory:');
    expect(launch.arguments).toEqual(['acp']);
    execution.dispose();
    await host.dispose();
  });

  it('launches against the database the conversation is kept in', async () => {
    // Everything the database plumbing exists for is inert if the environment
    // is asked without it: the resume then loads a session that is not in the
    // database it opened. Found by review — a zero-arity lambda type-checks.
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin });
    const other = join(plugin.app.vault.adapter.basePath, 'other.db');

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
      databasePath: other,
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    expect(launch.environment.OPENCODE_DB).toBe(other);
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process for a conversation kept in another database', async () => {
    const plugin = createPlugin();
    const { execution, host } = await createHarness({ plugin });

    const first = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'first' }],
    }));
    const second = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'second' }],
      databasePath: join(plugin.app.vault.adapter.basePath, 'other.db'),
    }));

    // A running process reads one database; a tab that moves to a conversation
    // kept in another has to restart it. The artifact key is what carries it —
    // asserted here rather than assumed, because the launch key is assembled by
    // hand and the database is the newest thing in it.
    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
    execution.dispose();
    await host.dispose();
  });

  it('sets the thinking level on a tab first turn, before any session named it', async () => {
    const plugin = createPlugin();
    plugin.settings.effortLevel = 'high';
    const { execution, host, configOptions } = await createHarness({ plugin, offersEffort: true });
    const runtime = execution.createRuntime();

    await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    // The turn is composed before the session exists, so the id the level is
    // set under is unknown then; the applier resolves it from the session's own
    // reply rather than dropping the level for the first turn of every tab.
    expect(configOptions).toContainEqual(expect.objectContaining({
      configId: 'effort',
      value: 'high',
    }));
    execution.dispose();
    await host.dispose();
  });

  it('restarts the process when the vault MCP servers change', async () => {
    // The legacy runtime shut the process down on an MCP reload so the next
    // turn's session picks the servers up. Here the launch key is what says a
    // running process cannot be told, and the fingerprint is what restarts it.
    const { execution, host } = await createHarness();
    const servers: unknown[] = [];
    // Stubbed where the composition now asks: through the plugin's composition
    // root, which is where a provider's services live.
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

    expect(launch.executable).toBe('opencode');
    execution.dispose();
    await host.dispose();
  });

  describe('auxiliary work, on the kernel', () => {
    /**
     * The path the three auxiliary services now take, end to end over the same
     * fake agent the chat turns run on — the store, the retained process, the
     * seam, and the launch that is deliberately not the chat's.
     */
    it('answers a title on a process of its own, as the auxiliary agent', async () => {
      const { execution, host, startupRefs, configOptions, prompts } = await createHarness();

      const title = await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'The user asked about tomatoes.');

      expect(title).toBe('the answer');
      // Its own launch, and nothing else has launched: no chat turn ran, so a
      // shared process would mean the auxiliary work had opened the
      // conversation's own CLI to generate a title.
      expect(startupRefs).toHaveLength(1);
      // The agent whose permissions are what stop an unattended turn from
      // writing to the vault. Set when the session opens, before the prompt.
      expect(configOptions).toEqual([
        expect.objectContaining({ configId: 'mode', value: 'grimoire-aux-passive' }),
      ]);
      expect(prompts).toHaveLength(1);
      execution.dispose();
      await host.dispose();
    });

    it('writes an agent that cannot write, and gives inline edit one that can read', async () => {
      const plugin = createPlugin();
      const { execution, host } = await createHarness({ plugin });
      const vault = plugin.app.vault.adapter.basePath as string;

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
      }, 'the message');
      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');

      // **What actually stops an unattended turn**, and the reason the mode is
      // set at all: OpenCode has no per-request permission mode, so what a turn
      // can do is the agent definition the artifacts wrote. Asserting only that
      // the session was set to an agent id proves the name, not the permissions.
      const agentOf = (purpose: string, id: string): Record<string, any> => JSON.parse(
        readFileSync(join(vault, '.grimoire', 'opencode', 'auxiliary', purpose, 'config.json'), 'utf8'),
      ).agent[id];
      expect(agentOf('title-gen', 'grimoire-aux-passive').permission).toEqual({
        '*': 'deny',
        external_directory: 'deny',
      });
      // An inline edit reads the note around what it is editing, and reads
      // nothing that looks like a credential.
      const inline = agentOf('inline', 'grimoire-aux-readonly').permission;
      expect(inline).toMatchObject({ '*': 'deny', grep: 'allow' });
      expect(inline.read).toMatchObject({ '*': 'allow', '*.env': 'deny' });
      // Each purpose keeps its own artifacts, so a title's instructions cannot
      // be the ones an edit runs under.
      expect(existsSync(join(vault, '.grimoire', 'opencode', 'auxiliary', 'inline', 'system.md')))
        .toBe(true);
      execution.dispose();
      await host.dispose();
    });

    it('sets the session to the agent this purpose runs as', async () => {
      const { execution, host, configOptions } = await createHarness();

      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');

      expect(configOptions).toEqual([
        expect.objectContaining({ configId: 'mode', value: 'grimoire-aux-readonly' }),
      ]);
      execution.dispose();
      await host.dispose();
    });

    it('launches opencode from PATH when no CLI path is configured', async () => {
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
      expect(launch.executable).toBe('opencode');
      expect(launch.arguments).toEqual(['acp']);
      execution.dispose();
      await host.dispose();
    });

    it('asks nobody, because there is nobody to ask', async () => {
      const { execution, host, permissionAnswers, askAnything } = await createHarness();

      await execution.createAuxRunner('inline').query({
        systemPrompt: 'Edit the selection.',
      }, 'make it shorter');
      await askAnything();

      // An auxiliary turn has no surface to raise a prompt on: a modal that
      // appeared over a note because a title was being generated behind it
      // would be worse than the refusal.
      expect(permissionAnswers).toEqual([{ outcome: { outcome: 'cancelled' } }]);
      execution.dispose();
      await host.dispose();
    });

    it('keeps one runner\'s conversation and gives another its own', async () => {
      const { execution, host, startupRefs } = await createHarness();
      const first = execution.createAuxRunner('inline');

      await first.query({ systemPrompt: 'Edit the selection.' }, 'make it shorter');
      await first.query({ systemPrompt: 'Edit the selection.' }, 'shorter still');
      await execution.createAuxRunner('inline').query({ systemPrompt: 'Edit the selection.' }, 'a different edit');

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

    it('applies the model the caller chose, decoding the id space it came in', async () => {
      const { execution, host, configOptions } = await createHarness();

      await execution.createAuxRunner('title-gen').query({
        systemPrompt: 'Name the conversation.',
        model: 'opencode:big-pickle-provider:big-pickle',
      }, 'the message');

      // The settings UI stores an encoded selection id and a caller elsewhere
      // may pass a raw one. An id decoded from the wrong space is a model the
      // account does not have, which the agent answers by refusing the option.
      expect(configOptions).toEqual([
        expect.objectContaining({ configId: 'mode' }),
        expect.objectContaining({ configId: 'model', value: 'big-pickle-provider:big-pickle' }),
      ]);
      execution.dispose();
      await host.dispose();
    });


    it('falls back to the model the chat is set to when the caller names none', async () => {
      const plugin = createPlugin();
      plugin.settings.savedProviderModel = { opencode: 'opencode:big-pickle-provider/big-pickle' };
      updateOpencodeProviderSettings(plugin.settings, {
        discoveredModels: [{ label: 'Big Pickle', rawId: 'big-pickle-provider/big-pickle' }],
        visibleModels: ['big-pickle-provider/big-pickle'],
      });
      const { execution, host, configOptions } = await createHarness({ plugin });

      // Inline edit and instruction refinement pass no model unless the user set
      // an override, and the runner this replaced applied the chat's selection to
      // them. Without this an auxiliary turn silently runs on whatever the CLI
      // defaults to, which is a different model and a different bill from the one
      // the vault is configured for. The first flip of this checkpoint dropped it
      // for three providers at once.
      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      expect(configOptions).toEqual([
        expect.objectContaining({ configId: 'mode' }),
        expect.objectContaining({ configId: 'model', value: 'big-pickle-provider/big-pickle' }),
      ]);
      execution.dispose();
      await host.dispose();
    });

    it('applies nothing when the vault has chosen no model of its own', async () => {
      const { execution, host, configOptions } = await createHarness();

      await execution.createAuxRunner('instructions').query({
        systemPrompt: 'Refine the instructions.',
      }, 'make this clearer');

      // The default selection is this provider's synthetic id, which names no
      // model at all. Sending it would ask the agent for a model that does not
      // exist rather than leaving it on its own default.
      expect(configOptions).toEqual([expect.objectContaining({ configId: 'mode' })]);
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