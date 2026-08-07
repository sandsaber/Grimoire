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

import { OpencodeChatRuntime } from '@/providers/opencode/runtime/OpencodeChatRuntime';
import { prepareOpencodeLaunchArtifacts } from '@/providers/opencode/runtime/OpencodeLaunchArtifacts';

import { AcpClientConnection, AcpJsonRpcTransport, AcpSubprocess } from '../../../../src/providers/acp';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

jest.mock('../../../../src/providers/acp', () => {
  const actual = jest.requireActual('../../../../src/providers/acp');
  return {
    ...actual,
    AcpClientConnection: jest.fn(),
    AcpJsonRpcTransport: jest.fn(),
    AcpSubprocess: jest.fn(),
  };
});

jest.mock('@/providers/opencode/runtime/OpencodeLaunchArtifacts', () => {
  const actual = jest.requireActual('@/providers/opencode/runtime/OpencodeLaunchArtifacts');
  return {
    ...actual,
    prepareOpencodeLaunchArtifacts: jest.fn(),
  };
});

const MockAcpClientConnection = AcpClientConnection as jest.MockedClass<typeof AcpClientConnection>;
const MockAcpJsonRpcTransport = AcpJsonRpcTransport as jest.MockedClass<typeof AcpJsonRpcTransport>;
const MockAcpSubprocess = AcpSubprocess as jest.MockedClass<typeof AcpSubprocess>;
const mockPrepareOpencodeLaunchArtifacts = prepareOpencodeLaunchArtifacts as jest.MockedFunction<typeof prepareOpencodeLaunchArtifacts>;

describe('OpenCode ACP launch', () => {
  let mockConnection: AcpLaunchMockConnection;
  let mockProcess: AcpLaunchMockProcess;
  let mockTransport: AcpLaunchMockTransport;

  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

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
    mockPrepareOpencodeLaunchArtifacts.mockResolvedValue({
      configPath: 'C:\\tmp\\grimoire-opencode\\config.json',
      configContent: '{}\n',
      databasePath: null,
      launchKey: 'launch-key',
      systemPromptPath: 'C:\\tmp\\grimoire-opencode\\system.md',
    });
  });

  it('does not pass the workspace path through OpenCode CLI arguments', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const runtime = new OpencodeChatRuntime(createAcpLaunchMockPlugin({
      cliPath: 'C:\\Tools\\opencode.exe',
      providerId: 'opencode',
    }));

    await expect(runtime.ensureReady()).resolves.toBe(true);

    expect(MockAcpSubprocess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['acp'],
      command: 'C:\\Tools\\opencode.exe',
      cwd: WINDOWS_UNICODE_VAULT,
    }));
    expect(mockConnection.newSession).toHaveBeenCalledWith({
      cwd: WINDOWS_UNICODE_VAULT,
      mcpServers: [],
    });
  });

  it('spawns WSL launches from the host vault cwd while keeping the session cwd in WSL form', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const plugin = createAcpLaunchMockPlugin({
      cliPath: 'opencode',
      providerId: 'opencode',
    });
    plugin.settings.providerConfigs.opencode = {
      enabled: true,
      installationMethodsByHost: { 'host-a': 'wsl' },
      wslDistroOverridesByHost: { 'host-a': 'Ubuntu' },
    };
    const runtime = new OpencodeChatRuntime(plugin);

    await expect(runtime.ensureReady()).resolves.toBe(true);

    expect(MockAcpSubprocess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--distribution', 'Ubuntu', '--cd', '/mnt/c/Users/Name/OneDrive - 公司/Vault 中文 (test)', 'opencode', 'acp'],
      command: expect.stringMatching(/wsl\.exe$/i),
      cwd: WINDOWS_UNICODE_VAULT,
      shell: false,
    }));
    expect(mockConnection.newSession).toHaveBeenCalledWith({
      cwd: '/mnt/c/Users/Name/OneDrive - 公司/Vault 中文 (test)',
      mcpServers: [],
    });
    expect(MockAcpSubprocess.mock.calls.at(-1)?.[0].env.PATH).toBeUndefined();
  });

  it('preserves a \\wsl.localhost workspace path when mapping WSL session paths back to the host', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const wslLocalhostVault = '\\\\wsl.localhost\\Ubuntu\\home\\user\\Vault';
    const plugin = createAcpLaunchMockPlugin({
      cliPath: 'opencode',
      providerId: 'opencode',
      vaultPath: wslLocalhostVault,
    });
    plugin.settings.providerConfigs.opencode = {
      enabled: true,
      installationMethodsByHost: { 'host-a': 'wsl' },
      wslDistroOverridesByHost: { 'host-a': 'Ubuntu' },
    };
    mockPrepareOpencodeLaunchArtifacts.mockResolvedValue({
      configPath: `${wslLocalhostVault}\\.grimoire\\opencode\\config.json`,
      configContent: '{}\n',
      databasePath: null,
      launchKey: 'launch-key',
      systemPromptPath: `${wslLocalhostVault}\\.grimoire\\opencode\\system.md`,
    });
    const runtime = new OpencodeChatRuntime(plugin);

    await expect(runtime.ensureReady()).resolves.toBe(true);

    expect(MockAcpSubprocess).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--distribution', 'Ubuntu', '--cd', '/home/user/Vault', 'opencode', 'acp'],
      command: expect.stringMatching(/wsl\.exe$/i),
      cwd: wslLocalhostVault,
      shell: false,
    }));
    expect(mockConnection.newSession).toHaveBeenCalledWith({
      cwd: '/home/user/Vault',
      mcpServers: [],
    });
    expect(MockAcpSubprocess.mock.calls.at(-1)?.[0].env.OPENCODE_CONFIG).toBe(
      '/home/user/Vault/.grimoire/opencode/config.json',
    );

    expect((runtime as any).launchSpec?.pathMapper.toHostPath('/home/user/Vault/notes/file.md')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\user\\Vault\\notes\\file.md',
    );
  });
});
