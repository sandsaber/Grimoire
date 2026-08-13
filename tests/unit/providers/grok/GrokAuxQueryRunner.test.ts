import { AcpClientConnection, AcpJsonRpcTransport, AcpSubprocess } from '@/providers/acp';
import { GrokAuxQueryRunner } from '@/providers/grok/runtime/GrokAuxQueryRunner';
import { prepareGrokLaunchArtifacts } from '@/providers/grok/runtime/GrokLaunchArtifacts';

jest.mock('@/providers/acp', () => {
  const actual = jest.requireActual('@/providers/acp');
  return {
    ...actual,
    AcpClientConnection: jest.fn(),
    AcpJsonRpcTransport: jest.fn(),
    AcpSubprocess: jest.fn(),
  };
});

jest.mock('@/providers/grok/runtime/GrokLaunchArtifacts', () => {
  const actual = jest.requireActual('@/providers/grok/runtime/GrokLaunchArtifacts');
  return {
    ...actual,
    prepareGrokLaunchArtifacts: jest.fn(),
  };
});

const MockAcpClientConnection = AcpClientConnection as jest.MockedClass<typeof AcpClientConnection>;
const MockAcpJsonRpcTransport = AcpJsonRpcTransport as jest.MockedClass<typeof AcpJsonRpcTransport>;
const MockAcpSubprocess = AcpSubprocess as jest.MockedClass<typeof AcpSubprocess>;
const mockPrepareGrokLaunchArtifacts = prepareGrokLaunchArtifacts as jest.MockedFunction<typeof prepareGrokLaunchArtifacts>;

function createMockPlugin(settings: Record<string, unknown> = {}) {
  return {
    settings: {
      model: 'grok:openai/gpt-5',
      providerConfigs: {
        grok: {
          enabled: true,
        },
      },
      settingsProvider: 'grok',
      ...settings,
    },
    manifest: { version: '0.0.0-test' },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/grok'),
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grimoire-test-vault',
        },
      },
    },
  } as any;
}

describe('GrokAuxQueryRunner', () => {
  let mockConnection: {
    cancel: jest.Mock;
    dispose: jest.Mock;
    initialize: jest.Mock;
    newSession: jest.Mock;
    onSessionNotification: jest.Mock;
    prompt: jest.Mock;
    setModel: jest.Mock;
  };
  let mockProcess: {
    getStderrSnapshot: jest.Mock;
    isAlive: jest.Mock;
    onClose: jest.Mock;
    shutdown: jest.Mock;
    start: jest.Mock;
    stdin: Record<string, never>;
    stdout: Record<string, never>;
  };
  let mockTransport: {
    dispose: jest.Mock;
    isClosed: boolean;
    start: jest.Mock;
  };
  let sessionNotificationListener: ((notification: any) => void | Promise<void>) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionNotificationListener = null;

    mockConnection = {
      cancel: jest.fn(),
      dispose: jest.fn(),
      initialize: jest.fn().mockResolvedValue({}),
      newSession: jest.fn().mockResolvedValue({ sessionId: 'session-1' }),
      onSessionNotification: jest.fn((listener) => {
        sessionNotificationListener = listener;
        return jest.fn();
      }),
      prompt: jest.fn().mockImplementation(async () => {
        await sessionNotificationListener?.({
          sessionId: 'session-1',
          update: {
            content: { text: 'Fix title', type: 'text' },
            messageId: 'assistant-1',
            sessionUpdate: 'agent_message_chunk',
          },
        });
        await sessionNotificationListener?.({
          sessionId: 'session-1',
          update: {
            content: { text: ' now', type: 'text' },
            messageId: 'assistant-1',
            sessionUpdate: 'agent_message_chunk',
          },
        });
        return { stopReason: 'end_turn' };
      }),
      setModel: jest.fn().mockResolvedValue({ _meta: { model: { Ok: 'openai/gpt-5' } } }),
    };
    mockProcess = {
      getStderrSnapshot: jest.fn().mockReturnValue(''),
      isAlive: jest.fn().mockReturnValue(true),
      onClose: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(undefined),
      start: jest.fn(),
      stdin: {},
      stdout: {},
    };
    mockTransport = {
      dispose: jest.fn(),
      isClosed: false,
      start: jest.fn(),
    };

    MockAcpClientConnection.mockImplementation(() => mockConnection as any);
    MockAcpJsonRpcTransport.mockImplementation(() => mockTransport as any);
    MockAcpSubprocess.mockImplementation(() => mockProcess as any);
    mockPrepareGrokLaunchArtifacts.mockResolvedValue({
      configContent: 'default = "grimoire-aux-passive"\n',
      grokHomePath: '/tmp/grimoire-grok-aux',
      launchKey: 'launch-key',
      managedConfigPath: '/tmp/grimoire-grok-aux/managed_config.toml',
      systemPromptPath: '/tmp/grimoire-grok-aux/system.md',
    });
  });

  it('launches an auxiliary ACP session and streams assistant text', async () => {
    const runner = new GrokAuxQueryRunner(createMockPlugin(), {
      agentProfile: 'passive',
      artifactPurpose: 'title-gen',
    });
    const onTextChunk = jest.fn();

    await expect(runner.query({
      onTextChunk,
      systemPrompt: 'Use this custom system prompt.',
    }, 'Generate a title')).resolves.toBe('Fix title now');

    expect(mockPrepareGrokLaunchArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      artifactsSubdir: 'grok/auxiliary/title-gen',
      permissionMode: 'plan',
      systemPromptKey: 'Use this custom system prompt.',
      systemPromptText: 'Use this custom system prompt.',
    }));
    expect(mockConnection.newSession).toHaveBeenCalledWith({
      cwd: '/tmp/grimoire-test-vault',
      mcpServers: [],
    });
    expect(mockConnection.setModel).toHaveBeenCalledWith({
      modelId: 'openai/gpt-5',
      sessionId: 'session-1',
    });
    expect(onTextChunk).toHaveBeenNthCalledWith(1, 'Fix title');
    expect(onTextChunk).toHaveBeenNthCalledWith(2, 'Fix title now');
  });

  it('falls back to grok from PATH when no CLI path is configured', async () => {
    const plugin = createMockPlugin();
    plugin.getResolvedProviderCliPath.mockReturnValue(null);
    const runner = new GrokAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'title-gen',
    });

    await expect(runner.query({
      systemPrompt: 'Use this custom system prompt.',
    }, 'Generate a title')).resolves.toBe('Fix title now');

    expect(MockAcpSubprocess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['agent', 'stdio'],
      command: 'grok',
    }));
  });

  it('restarts the auxiliary ACP subprocess when the cached transport closed', async () => {
    const firstTransport = {
      dispose: jest.fn(),
      isClosed: false,
      start: jest.fn(),
    };
    const secondTransport = {
      dispose: jest.fn(),
      isClosed: false,
      start: jest.fn(),
    };
    MockAcpJsonRpcTransport
      .mockImplementationOnce(() => firstTransport as any)
      .mockImplementationOnce(() => secondTransport as any);
    const runner = new GrokAuxQueryRunner(createMockPlugin(), {
      agentProfile: 'passive',
      artifactPurpose: 'title-gen',
    });

    await expect(runner.query({
      systemPrompt: 'Use this custom system prompt.',
    }, 'Generate a title')).resolves.toBe('Fix title now');

    firstTransport.isClosed = true;

    await expect(runner.query({
      systemPrompt: 'Use this custom system prompt.',
    }, 'Generate another title')).resolves.toBe('Fix title now');

    expect(firstTransport.dispose).toHaveBeenCalledTimes(1);
    expect(MockAcpSubprocess).toHaveBeenCalledTimes(2);
    expect(MockAcpJsonRpcTransport).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit encoded Grok Build model override from the active chat tab', async () => {
    mockConnection.newSession.mockResolvedValue({
      models: {
        availableModels: [
          { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
          { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
        ],
        currentModelId: 'openai/gpt-4.1',
      },
      sessionId: 'session-1',
    });

    const runner = new GrokAuxQueryRunner(createMockPlugin(), {
      agentProfile: 'passive',
      artifactPurpose: 'title-gen',
    });

    await expect(runner.query({
      model: 'grok:openai/gpt-5.4',
      systemPrompt: 'Use this custom system prompt.',
    }, 'Generate a title')).resolves.toBe('Fix title now');

    expect(mockConnection.setModel).toHaveBeenCalledWith({
      modelId: 'openai/gpt-5.4',
      sessionId: 'session-1',
    });
  });

  it('rejects permission prompts even for the read-only aux profile', async () => {
    const runner = new GrokAuxQueryRunner(createMockPlugin(), {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    });

    await expect((runner as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'allow-now' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject-now' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'read',
        rawInput: { path: 'note.md' },
        title: 'read',
        toolCallId: 'tool-1',
      },
    })).resolves.toEqual({
      outcome: {
        optionId: 'reject-now',
        outcome: 'selected',
      },
    });

    await expect((runner as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'allow-now' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject-now' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'edit',
        rawInput: { path: 'note.md' },
        title: 'edit',
        toolCallId: 'tool-2',
      },
    })).resolves.toEqual({
      outcome: {
        optionId: 'reject-now',
        outcome: 'selected',
      },
    });
  });

  it('rejects all permissions in deny-all mode', async () => {
    const runner = new GrokAuxQueryRunner(createMockPlugin(), {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    });

    await expect((runner as any).handlePermissionRequest({
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'allow-now' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject-now' },
      ],
      sessionId: 'session-1',
      toolCall: {
        kind: 'read',
        rawInput: { path: 'note.md' },
        title: 'read',
        toolCallId: 'tool-1',
      },
    })).resolves.toEqual({
      outcome: {
        optionId: 'reject-now',
        outcome: 'selected',
      },
    });
  });

  it('rejects aux reads outside the workspace root', () => {
    const runner = new GrokAuxQueryRunner(createMockPlugin(), {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    });

    (runner as any).sessionCwds.set('session-1', '/tmp/grimoire-test-vault');

    expect(() => (runner as any).resolveSessionPath('session-1', '/tmp/outside.md')).toThrow(
      'Grok Build aux read access is limited to the current workspace.',
    );
    expect((runner as any).resolveSessionPath('session-1', '/tmp/grimoire-test-vault/notes/today.md')).toBe(
      '/tmp/grimoire-test-vault/notes/today.md',
    );
  });
});
