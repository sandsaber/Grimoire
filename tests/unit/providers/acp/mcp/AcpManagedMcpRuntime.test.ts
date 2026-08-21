import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { GeminiChatRuntime } from '@/providers/gemini/runtime/GeminiChatRuntime';
import { KimicodeChatRuntime } from '@/providers/kimicode/runtime/KimicodeChatRuntime';
import { MimocodeChatRuntime } from '@/providers/mimocode/runtime/MimocodeChatRuntime';
import { QwenChatRuntime } from '@/providers/qwen/runtime/QwenChatRuntime';

/**
 * The four ACP runtimes still on the legacy path.
 *
 * OpenCode left this list at its flip and Grok at its own: their servers reach
 * a session through the kernel now, asserted where they are passed — each
 * provider's `*ExecutionComposition.test.ts` for the launch key that restarts
 * on a change, and `OpencodeExecutionBackend.test.ts` for the `session/new`
 * that carries them.
 */
const cases = [
  ['mimocode', MimocodeChatRuntime],
  ['kimicode', KimicodeChatRuntime],
  ['qwen', QwenChatRuntime],
  ['gemini', GeminiChatRuntime],
] as const;

function createPlugin(): any {
  return {
    app: {
      vault: {
        adapter: { basePath: '/tmp/grimoire-acp-mcp-vault' },
      },
    },
    getAllViews: () => [],
    manifest: { version: '0.0.0-test' },
    recordDebugLog: jest.fn(),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings: {},
  };
}

describe('ACP managed MCP runtime integration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(cases)('passes %s servers to new and resumed ACP sessions', async (providerId, Runtime) => {
    jest.spyOn(ProviderWorkspaceRegistry, 'getMcpServerManager').mockImplementation((requestedId) => (
      requestedId === providerId
        ? {
            getServers: () => [{
              name: 'project-tools',
              config: { command: 'node', args: ['server.js'] },
              contextSaving: false,
              enabled: true,
            }],
          } as any
        : null
    ));

    const runtime = new Runtime(createPlugin()) as any;
    runtime.syncSessionDiscovery = jest.fn();
    runtime.updateSessionPaths = jest.fn();
    // What a session answers with is read by the runtime for all four that are
    // left; the two that flipped read it on an extracted state instead. The
    // stub goes wherever the reading lives, so this row survives the next flip.
    const sessionConfig = runtime.sessionConfig ?? runtime;
    sessionConfig.syncSessionModelState = jest.fn().mockResolvedValue(undefined);
    sessionConfig.syncSessionModeState = jest.fn().mockResolvedValue(undefined);

    const newSession = jest.fn().mockResolvedValue({
      configOptions: null,
      models: null,
      modes: null,
      sessionId: 'created-session',
    });
    const loadSession = jest.fn().mockResolvedValue({
      configOptions: null,
      models: null,
      modes: null,
      sessionId: 'resumed-session',
    });
    runtime.connection = { loadSession, newSession };

    await expect(runtime.createSession('/tmp/grimoire-acp-mcp-vault'))
      .resolves.toBe('created-session');
    // Two of the four now answer *what happened* rather than whether it worked:
    // a session that is gone and one the agent could not load right now are
    // different answers, and only the first may erase a binding. The other two
    // still answer a boolean, and both shapes mean the same thing to this row.
    const loaded = await runtime.loadSession('resumed-session', '/tmp/grimoire-acp-mcp-vault');
    expect(loaded === true || loaded === 'loaded').toBe(true);

    const expectedServers = [{
      args: ['server.js'],
      command: 'node',
      name: 'project-tools',
    }];
    expect(newSession).toHaveBeenCalledWith({
      cwd: '/tmp/grimoire-acp-mcp-vault',
      mcpServers: expectedServers,
    });
    expect(loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/grimoire-acp-mcp-vault',
      mcpServers: expectedServers,
      sessionId: 'resumed-session',
    });
  });

  it.each(cases)('reloads %s storage and restarts its ACP process', async (providerId, Runtime) => {
    const loadServers = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(ProviderWorkspaceRegistry, 'getMcpServerManager').mockImplementation((requestedId) => (
      requestedId === providerId ? { loadServers } as any : null
    ));
    const runtime = new Runtime(createPlugin()) as any;
    const shutdownProcess = jest.spyOn(runtime, 'shutdownProcess').mockResolvedValue(undefined);

    await runtime.reloadMcpServers();

    expect(loadServers).toHaveBeenCalledTimes(1);
    expect(shutdownProcess).toHaveBeenCalledTimes(1);
  });
});
