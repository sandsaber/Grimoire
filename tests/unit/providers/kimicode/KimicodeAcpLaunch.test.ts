import '@/providers';

import {
  type AcpLaunchMockConnection,
  type AcpLaunchMockProcess,
  type AcpLaunchMockTransport,
  createAcpLaunchMockPlugin,
  createAcpMockConnection,
  createAcpMockProcess,
  createAcpMockTransport,
  WINDOWS_UNICODE_VAULT,
  wireAcpMocks,
} from '@test/helpers/acpLaunchMocks';

import { KimicodeChatRuntime } from '@/providers/kimicode/runtime/KimicodeChatRuntime';
import { prepareKimicodeLaunchArtifacts } from '@/providers/kimicode/runtime/KimicodeLaunchArtifacts';

import { AcpClientConnection, AcpJsonRpcTransport, AcpSubprocess } from '../../../../src/providers/acp';

jest.mock('../../../../src/providers/acp', () => {
  const actual = jest.requireActual('../../../../src/providers/acp');
  return {
    ...actual,
    AcpClientConnection: jest.fn(),
    AcpJsonRpcTransport: jest.fn(),
    AcpSubprocess: jest.fn(),
  };
});

jest.mock('@/providers/kimicode/runtime/KimicodeLaunchArtifacts', () => {
  const actual = jest.requireActual('@/providers/kimicode/runtime/KimicodeLaunchArtifacts');
  return {
    ...actual,
    prepareKimicodeLaunchArtifacts: jest.fn(),
  };
});

const MockAcpClientConnection = AcpClientConnection as jest.MockedClass<typeof AcpClientConnection>;
const MockAcpJsonRpcTransport = AcpJsonRpcTransport as jest.MockedClass<typeof AcpJsonRpcTransport>;
const MockAcpSubprocess = AcpSubprocess as jest.MockedClass<typeof AcpSubprocess>;
const mockPrepareKimicodeLaunchArtifacts = prepareKimicodeLaunchArtifacts as jest.MockedFunction<typeof prepareKimicodeLaunchArtifacts>;

describe('Kimi Code ACP launch', () => {
  let mockConnection: AcpLaunchMockConnection;
  let mockProcess: AcpLaunchMockProcess;
  let mockTransport: AcpLaunchMockTransport;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection = createAcpMockConnection();
    mockProcess = createAcpMockProcess();
    mockTransport = createAcpMockTransport();

    wireAcpMocks({
      connection: mockConnection,
      connectionCtor: MockAcpClientConnection,
      process: mockProcess,
      subprocessCtor: MockAcpSubprocess,
      transport: mockTransport,
      transportCtor: MockAcpJsonRpcTransport,
    });
    mockPrepareKimicodeLaunchArtifacts.mockResolvedValue({
      configPath: 'C:\\tmp\\grimoire-kimicode\\config.json',
      configContent: '{}\n',
      databasePath: null,
      launchKey: 'launch-key',
      systemPromptPath: 'C:\\tmp\\grimoire-kimicode\\system.md',
    });
  });

  // MiMoCode has had this row since its launch work; Kimi Code is its twin and
  // had no counterpart, so the Windows path handling both share was covered on
  // one side only.
  it('does not pass the workspace path through Kimi Code CLI arguments', async () => {
    const runtime = new KimicodeChatRuntime(createAcpLaunchMockPlugin({
      cliPath: 'C:\\Tools\\kimi.exe',
      providerId: 'kimicode',
    }));

    await expect(runtime.ensureReady()).resolves.toBe(true);

    expect(MockAcpSubprocess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['acp'],
      command: 'C:\\Tools\\kimi.exe',
      cwd: WINDOWS_UNICODE_VAULT,
    }));
    expect(mockConnection.newSession).toHaveBeenCalledWith({
      cwd: WINDOWS_UNICODE_VAULT,
      mcpServers: [],
    });
  });
});
