import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { GeminiChatRuntime } from '@/providers/gemini/runtime/GeminiChatRuntime';
import { GrokChatRuntime } from '@/providers/grok/runtime/GrokChatRuntime';
import { KimicodeChatRuntime } from '@/providers/kimicode/runtime/KimicodeChatRuntime';
import { MimocodeChatRuntime } from '@/providers/mimocode/runtime/MimocodeChatRuntime';
import { QwenChatRuntime } from '@/providers/qwen/runtime/QwenChatRuntime';

/**
 * The five ACP runtimes still on the legacy path.
 *
 * OpenCode left this list at its flip: its servers reach a session through the
 * kernel now, asserted where they are passed —
 * `OpencodeExecutionComposition.test.ts` for the launch key that restarts on a
 * change, and `OpencodeExecutionBackend.test.ts` for the `session/new` that
 * carries them.
 */
const cases = [
  ['grok', GrokChatRuntime],
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
    runtime.syncSessionModelState = jest.fn().mockResolvedValue(undefined);
    runtime.syncSessionModeState = jest.fn().mockResolvedValue(undefined);
    runtime.updateSessionPaths = jest.fn();

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
    await expect(runtime.loadSession('resumed-session', '/tmp/grimoire-acp-mcp-vault'))
      .resolves.toBe(true);

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
