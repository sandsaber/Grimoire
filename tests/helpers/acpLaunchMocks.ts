import type {
  AcpClientConnection,
  AcpJsonRpcTransport,
  AcpSubprocess,
} from '@/providers/acp';

export const WINDOWS_UNICODE_VAULT = 'C:\\Users\\Name\\OneDrive - 公司\\Vault 中文 (test)';

export type AcpLaunchMockConnection = {
  dispose: jest.Mock;
  initialize: jest.Mock;
  newSession: jest.Mock;
  onRequestPermission: jest.Mock;
  onSessionNotification: jest.Mock;
};

export type AcpLaunchMockProcess = {
  getStderrSnapshot: jest.Mock;
  isAlive: jest.Mock;
  onClose: jest.Mock;
  shutdown: jest.Mock;
  start: jest.Mock;
  stdin: Record<string, never>;
  stdout: Record<string, never>;
};

export type AcpLaunchMockTransport = {
  dispose: jest.Mock;
  isClosed: boolean;
  notify: jest.Mock;
  onClose: jest.Mock;
  onNotification: jest.Mock;
  onRequest: jest.Mock;
  request: jest.Mock;
  signal: AbortSignal;
  start: jest.Mock;
};

export interface AcpLaunchMockPluginParams {
  cliPath: string;
  /**
   * The three ACP CLIs this helper launches for.
   *
   * Kimi Code was missing, which is why it had no launch row: the helper it
   * would have used did not admit it.
   */
  providerId: 'opencode' | 'mimocode' | 'kimicode';
  vaultPath?: string;
}

export interface WireAcpMocksParams {
  connection: AcpLaunchMockConnection;
  connectionCtor: jest.MockedClass<typeof AcpClientConnection>;
  process: AcpLaunchMockProcess;
  subprocessCtor: jest.MockedClass<typeof AcpSubprocess>;
  transport: AcpLaunchMockTransport;
  transportCtor: jest.MockedClass<typeof AcpJsonRpcTransport>;
}

export function createAcpLaunchMockPlugin(params: AcpLaunchMockPluginParams): any {
  return {
    settings: {
      providerConfigs: {
        [params.providerId]: {
          enabled: true,
        },
      },
    },
    manifest: { version: '0.0.0-test' },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue(params.cliPath),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    app: {
      vault: {
        adapter: {
          basePath: params.vaultPath ?? WINDOWS_UNICODE_VAULT,
        },
      },
    },
  };
}

export function createAcpMockConnection(): AcpLaunchMockConnection {
  return {
    dispose: jest.fn(),
    initialize: jest.fn().mockResolvedValue({}),
    newSession: jest.fn().mockResolvedValue({ sessionId: 'session-1' }),
    onRequestPermission: jest.fn(),
    onSessionNotification: jest.fn(),
  };
}

export function createAcpMockProcess(): AcpLaunchMockProcess {
  return {
    getStderrSnapshot: jest.fn().mockReturnValue(''),
    isAlive: jest.fn().mockReturnValue(true),
    onClose: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    start: jest.fn(),
    stdin: {},
    stdout: {},
  };
}

export function createAcpMockTransport(): AcpLaunchMockTransport {
  return {
    dispose: jest.fn(),
    isClosed: false,
    notify: jest.fn(),
    onClose: jest.fn().mockReturnValue(jest.fn()),
    onNotification: jest.fn().mockReturnValue(jest.fn()),
    onRequest: jest.fn().mockReturnValue(jest.fn()),
    request: jest.fn(async (method: string) => {
      if (method === 'session/new' || method === 'newSession') {
        return { sessionId: 'session-1' };
      }
      return {};
    }),
    signal: new AbortController().signal,
    start: jest.fn(),
  };
}

export function wireAcpMocks(params: WireAcpMocksParams): void {
  params.connectionCtor.mockImplementation(() => params.connection as any);
  params.transportCtor.mockImplementation(() => params.transport as any);
  params.subprocessCtor.mockImplementation(() => params.process as any);
}
