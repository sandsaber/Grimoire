import '@/providers';

import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ClaudeExecution } from '@/app/execution/claude/ClaudeExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, runId } from '@/core/execution/ExecutionIds';
import type { StreamChunk } from '@/core/types';
import { getClaudeWorkspaceServices } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { CLAUDE_EXECUTION_DESCRIPTOR } from '@/providers/claude/execution/ClaudeExecutionBackend';
import type { ClaudeSdkQueryFunction } from '@/providers/claude/execution/ClaudeSdkExecutionAdapter';
import { updateClaudeProviderSettings } from '@/providers/claude/settings';

jest.mock('@/providers/claude/app/ClaudeWorkspaceServices');

/**
 * The half of the Claude flip that only exists in production.
 *
 * The backend takes a request reference and knows nothing about what is inside
 * it; the store that holds one knows nothing about the SDK. This module is the
 * only place that knows both, and wave 1 proved that a seam both sides stub is
 * a seam nobody tests: the first end-to-end turn written there failed on the
 * registry's identifier rule, because the reference had been built to carry the
 * prompt itself.
 *
 * So this drives a whole turn — a reference minted here, dispatched by the
 * kernel, resolved into an invocation, started as an SDK query with options
 * built from the vault's live settings, and answered — with the SDK's own
 * `query` as the only fake in the path.
 */
describe('Claude execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'1'.repeat(32)}`);
  const RUN_ID = runId(`run-${'1'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'claude-tab' };

  beforeEach(() => {
    (getClaudeWorkspaceServices as jest.Mock).mockReturnValue({
      mcpManager: {
        getAllDisallowedMcpTools: () => ['mcp__vault__delete'],
        getActiveServers: () => ({}),
        getDisallowedMcpTools: () => [],
        extractMentions: () => new Set<string>(),
        transformMentions: (text: string) => text,
      },
      pluginManager: {
        getPluginsKey: () => 'plugins-1',
        getEnabledPlugins: () => [],
        getSdkPlugins: () => [],
      },
    });
  });

  function createPlugin(overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'default',
      model: 'claude-opus-5',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
      ...overrides,
    };
    updateClaudeProviderSettings(settings, { enabled: true });
    return {
      settings,
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/claude',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
    };
  }

  /**
   * One SDK query, without an SDK.
   *
   * It answers whatever it is sent, correlating its result with the user
   * message's own uuid the way the SDK does — which is what the backend matches
   * a finished turn against.
   */
  function createFakeSdk(script: {
    readonly askAbout?: { readonly toolName: string; readonly input: Record<string, unknown> };
    readonly toolCall?: { readonly id: string; readonly name: string };
  } = {}): {
    queryFunction: ClaudeSdkQueryFunction;
    startedWith: Options[];
    permissions: unknown[];
  } {
    const startedWith: Options[] = [];
    const permissions: unknown[] = [];
    const queryFunction = ((input: {
      prompt: AsyncIterable<SDKUserMessage>;
      options: Options;
    }) => {
      startedWith.push(input.options);
      const messages = (async function* respond(): AsyncGenerator<SDKMessage> {
        for await (const sent of input.prompt) {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'native-session',
            uuid: 'init-1',
          } as unknown as SDKMessage;
          if (script.askAbout) {
            // The SDK asks before it runs a tool, which is the only path an
            // approval reaches the tab through.
            const canUseTool = input.options.canUseTool as ((
              toolName: string,
              toolInput: Record<string, unknown>,
              options: Record<string, unknown>,
            ) => Promise<unknown>) | undefined;
            try {
              permissions.push(await canUseTool?.(
                script.askAbout.toolName,
                script.askAbout.input,
                { signal: new AbortController().signal, requestId: 'req-1', toolUseID: 'tool-use-1' },
              ));
            } catch (error) {
              permissions.push({ threw: String(error) });
            }
          }
          if (script.toolCall) {
            yield {
              type: 'assistant',
              parent_tool_use_id: null,
              message: {
                role: 'assistant',
                content: [{
                  type: 'tool_use',
                  id: script.toolCall.id,
                  name: script.toolCall.name,
                  input: { file_path: 'note.md' },
                }],
              },
              uuid: `assistant-${script.toolCall.id}`,
              session_id: 'native-session',
            } as unknown as SDKMessage;
          }
          yield {
            type: 'stream_event',
            session_id: 'native-session',
            uuid: 'delta-1',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'the answer' },
            },
          } as unknown as SDKMessage;
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'the answer',
            user_message_uuid: sent.uuid,
            uuid: 'result-1',
            session_id: 'native-session',
          } as unknown as SDKMessage;
        }
      })();
      return {
        [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
        interrupt: async () => undefined,
        setPermissionMode: async () => undefined,
        setModel: async () => undefined,
        applyFlagSettings: async () => undefined,
        setMcpServers: async () => undefined,
        rewindFiles: async () => ({ filesChanged: [] }),
        stopTask: async () => undefined,
        close: () => messages.return(undefined),
      };
    }) as unknown as ClaudeSdkQueryFunction;
    return { queryFunction, startedWith, permissions };
  }

  async function createHarness(
    plugin: any = createPlugin(),
    script: Parameters<typeof createFakeSdk>[0] = {},
  ): Promise<{
    execution: ClaudeExecution;
    host: ExecutionKernelHost;
    startedWith: Options[];
    permissions: unknown[];
    events: ExecutionEventEnvelope[];
  }> {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new ClaudeExecution(plugin, host.registry);
    const { queryFunction, startedWith, permissions } = createFakeSdk(script);
    host.registerBackend(execution.createBackendRegistration(queryFunction));
    await host.start();
    await host.registry.createSession({
      backendId: CLAUDE_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => {
      events.push(envelope);
    });
    return { execution, host, startedWith, permissions, events };
  }

  /**
   * Waits for the run to finish, bounded.
   *
   * `waitForIdle` settles the registry's own work; the SDK query answering is
   * the backend's, and a turn that never ends must fail here rather than as a
   * suite timeout with nothing to read.
   */
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

  it('renders a turn a tab can draw, and learns the session it is on', async () => {
    // The runtime half end to end: a tab prepares a turn, the kernel dispatches
    // it, the SDK answers, and what comes back is what the surface draws — the
    // text the kernel carries and the tool card the presenter makes from the
    // message it carried beside it.
    const { execution, host } = await createHarness(createPlugin(), {
      toolCall: { id: 'tool-1', name: 'Read' },
    });
    const runtime = execution.createRuntime();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'what now?' })));

    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('the answer')))
      .toBe(true);
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name === 'Read')).toBe(true);
    // Without this a tab starts a new session every turn: no resume across a
    // reload, and nothing to fork from.
    expect(runtime.getSessionId()).toBe('native-session');
    expect(runtime.consumeTurnMetadata()).toMatchObject({ wasSent: true });
    execution.dispose();
    await host.dispose();
  });

  it('asks the tab before a tool runs, and answers the SDK with what it chose', async () => {
    const { execution, host, permissions } = await createHarness(createPlugin(), {
      askAbout: { toolName: 'Bash', input: { command: 'ls' } },
    });
    const runtime = execution.createRuntime();
    const asked: Array<{ toolName: string; description: string }> = [];
    runtime.setApprovalCallback(async (toolName, _input, description) => {
      asked.push({ toolName, description });
      return 'allow';
    });

    await drain(runtime.query(runtime.prepareTurn({ text: 'run it' })));

    expect(asked).toEqual([{ toolName: 'Bash', description: 'Run command: ls' }]);
    // What the tab chose, in the SDK's own vocabulary: the whole point of the
    // bridge is that this arrives as a permission rather than as a chunk.
    expect(permissions[0]).toMatchObject({ behavior: 'allow' });
    execution.dispose();
    await host.dispose();
  });

  it('carries a whole turn from the reference to the SDK query and back', async () => {
    const { execution, host, startedWith, events } = await createHarness();

    const requestRef = execution.turnRequests.reference({
      prompt: 'what now?',
      session: () => ({ kind: 'new' }),
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);

    // The options the SDK was actually started with, built from this vault's
    // live settings rather than from anything the reference carried.
    expect(startedWith).toHaveLength(1);
    expect(startedWith[0]).toMatchObject({ cwd: '/vault' });
    expect(startedWith[0]?.disallowedTools).toContain('mcp__vault__delete');
    const kinds = events.map(envelope => envelope.event.kind);
    expect(kinds).toContain('run-started');
    expect(kinds).toContain('output-delta');
    const terminal = events.find(envelope => envelope.event.kind === 'terminal');
    expect(terminal?.event).toMatchObject({ terminal: 'succeeded' });
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
      requestRef: 'claudereq-0000000000000000000000000000000f',
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(host.registry.getRun(RUN_ID)).toMatchObject({ state: 'invalidated' });
    execution.dispose();
    await host.dispose();
  });
});
