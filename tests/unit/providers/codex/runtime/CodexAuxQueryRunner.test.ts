import '@/providers';

const mockTransportRequest = jest.fn();
const mockTransportNotify = jest.fn();
const mockTransportOnNotification = jest.fn();
const mockTransportDispose = jest.fn();
const mockTransportStart = jest.fn();
const mockProcessStart = jest.fn();
const mockProcessShutdown = jest.fn().mockResolvedValue(undefined);
const mockProcessOnExit = jest.fn();
const mockProcessOffExit = jest.fn();
const mockProcessIsAlive = jest.fn().mockReturnValue(true);

const mockResolveLaunchSpec = jest.fn();

jest.mock('@/providers/codex/runtime/CodexRpcTransport', () => ({
  CodexRpcTransport: jest.fn().mockImplementation(() => ({
    request: mockTransportRequest,
    notify: mockTransportNotify,
    onNotification: mockTransportOnNotification,
    dispose: mockTransportDispose,
    start: mockTransportStart,
  })),
}));

jest.mock('@/providers/codex/runtime/CodexAppServerProcess', () => ({
  CodexAppServerProcess: jest.fn().mockImplementation(() => ({
    start: mockProcessStart,
    shutdown: mockProcessShutdown,
    onExit: mockProcessOnExit,
    offExit: mockProcessOffExit,
    isAlive: mockProcessIsAlive,
  })),
}));

jest.mock('@/providers/codex/runtime/codexAppServerSupport', () => ({
  initializeCodexAppServerTransport: jest.fn().mockImplementation(async (transport: { notify: (method: string) => void }) => {
    transport.notify('initialized');
    return {
      userAgent: 'test/0.1',
      codexHome: '/home/user/.codex',
      platformFamily: 'unix',
      platformOs: 'linux',
    };
  }),
  resolveCodexAppServerLaunchSpec: (...args: unknown[]) => mockResolveLaunchSpec(...args),
}));

import { CodexAppServerProcess as MockedProcessClass } from '@/providers/codex/runtime/CodexAppServerProcess';
import { CodexAuxQueryRunner } from '@/providers/codex/runtime/CodexAuxQueryRunner';

describe('CodexAuxQueryRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveLaunchSpec.mockReturnValue({
      target: { method: 'wsl', platformFamily: 'unix', platformOs: 'linux', distroName: 'Ubuntu' },
      command: 'wsl.exe',
      args: ['--distribution', 'Ubuntu', '--cd', '/mnt/c/repo', 'codex', 'app-server', '--listen', 'stdio://'],
      spawnCwd: 'C:\\repo',
      targetCwd: '/mnt/c/repo',
      env: { OPENAI_API_KEY: 'sk-test' },
      pathMapper: {
        target: { method: 'wsl', platformFamily: 'unix', platformOs: 'linux', distroName: 'Ubuntu' },
        toTargetPath: jest.fn(),
        toHostPath: jest.fn(),
        mapTargetPathList: jest.fn(),
        canRepresentHostPath: jest.fn(),
      },
    });

    let turnCompletedHandler: ((params: unknown) => void) | undefined;
    let deltaHandler: ((params: unknown) => void) | undefined;
    mockTransportOnNotification.mockImplementation((method: string, handler: (params: unknown) => void) => {
      if (method === 'item/agentMessage/delta') {
        deltaHandler = handler;
      }
      if (method === 'turn/completed') {
        turnCompletedHandler = handler;
      }
    });

    mockTransportRequest.mockImplementation(async (method: string) => {
      switch (method) {
        case 'initialize':
          return {
            userAgent: 'test/0.1',
            codexHome: '/home/user/.codex',
            platformFamily: 'unix',
            platformOs: 'linux',
          };
        case 'thread/start':
          return { thread: { id: 'thread-1' } };
        case 'turn/start':
          window.setTimeout(() => {
            deltaHandler?.({ delta: 'Hello from Codex' });
            turnCompletedHandler?.({ turn: { status: 'completed', error: null } });
          }, 0);
          return { turn: { id: 'turn-1' } };
        default:
          return {};
      }
    });
  });

  it('uses the launch spec target cwd for auxiliary thread/start calls', async () => {
    const plugin = {
      settings: {},
      getActiveEnvironmentVariables: jest.fn(),
      app: {
        vault: {
          adapter: { basePath: 'C:\\repo' },
        },
      },
    } as any;

    const runner = new CodexAuxQueryRunner(plugin);
    const result = await runner.query({ systemPrompt: 'You are concise.' }, 'Summarize this');

    expect(result).toBe('Hello from Codex');
    expect(MockedProcessClass).toHaveBeenCalledWith(expect.objectContaining({
      command: 'wsl.exe',
      targetCwd: '/mnt/c/repo',
    }));
    expect(mockTransportRequest).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        cwd: '/mnt/c/repo',
        experimentalRawEvents: true,
      }),
    );
  });

  it('starts a new daemon once the last one has died', async () => {
    const plugin = {
      settings: {},
      getActiveEnvironmentVariables: jest.fn(),
      app: { vault: { adapter: { basePath: 'C:\\repo' } } },
    } as any;
    const runner = new CodexAuxQueryRunner(plugin);
    await runner.query({ systemPrompt: 'You are concise.' }, 'first');
    expect(MockedProcessClass).toHaveBeenCalledTimes(1);

    // The daemon dies. Both references stay non-null, so the guard that asked
    // only whether one had ever been started answered yes — and every later
    // inline edit and title refresh failed against a dead transport until the
    // plugin was reloaded.
    mockProcessIsAlive.mockReturnValue(false);
    await runner.query({ systemPrompt: 'You are concise.' }, 'second');

    expect(MockedProcessClass).toHaveBeenCalledTimes(2);
    // And a fresh daemon has no thread of the old one's: asking it to continue
    // `thread-1` would be asking a process that never had it.
    expect(mockTransportRequest.mock.calls.filter(([method]) => method === 'thread/start'))
      .toHaveLength(2);
  });
});
