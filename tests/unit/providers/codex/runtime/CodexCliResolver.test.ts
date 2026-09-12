import * as os from 'node:os';
import * as path from 'node:path';

import * as fs from 'fs';

import { CodexCliResolver } from '@/providers/codex/runtime/CodexCliResolver';
import { getHostnameKey } from '@/utils/env';

jest.mock('fs');
jest.mock('@/utils/env', () => {
  const actual = jest.requireActual('@/utils/env');
  return {
    ...actual,
    getHostnameKey: jest.fn(() => 'current-host'),
  };
});

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;
const mockedDeviceKey = getHostnameKey as jest.Mock;

describe('CodexCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDeviceKey.mockReturnValue('current-host');
  });

  it('uses the current host path instead of another synced host path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/codex');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new CodexCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/codex',
        'current-host': '/current/codex',
      },
      '/legacy/codex',
      '',
    );

    expect(resolved).toBe('/current/codex');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/codex');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new CodexCliResolver();
    const resolved = resolver.resolve(
      { 'other-host': '/other/codex' },
      '/legacy/codex',
      '',
    );

    expect(resolved).toBe('/legacy/codex');
  });

  it('auto-detects from the runtime PATH when no configured path is valid', () => {
    const runtimeExecutable = path.join('/custom/bin', 'codex');
    mockedExists.mockImplementation((filePath: string) => filePath === runtimeExecutable);
    mockedStat.mockImplementation((filePath: string) => ({
      isFile: () => filePath === runtimeExecutable,
    }));

    const resolver = new CodexCliResolver();
    const resolved = resolver.resolve(
      { 'other-host': '/other/codex' },
      '',
      'PATH=/custom/bin',
      { hostPlatform: 'linux' },
    );

    expect(resolved).toBe(runtimeExecutable);
  });

  it('detects the default Windows desktop-app codex.exe installation', () => {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(os.homedir(), 'AppData', 'Local');
    const defaultExecutable = path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    mockedExists.mockImplementation((filePath: string) => filePath === defaultExecutable);
    mockedStat.mockImplementation((filePath: string) => ({
      isFile: () => filePath === defaultExecutable,
    }));

    const resolver = new CodexCliResolver();

    expect(resolver.resolve({}, '', '', { hostPlatform: 'win32' })).toBe(defaultExecutable);
  });

  it('returns a Linux-side command in WSL mode without host filesystem validation', () => {
    mockedExists.mockReturnValue(false);

    const resolver = new CodexCliResolver();
    const resolved = resolver.resolve(
      {
        'current-host': 'codex',
      },
      '',
      '',
      { installationMethod: 'wsl', hostPlatform: 'win32' },
    );

    expect(resolved).toBe('codex');
  });

  it('falls back to the Linux command when a Windows-native CLI path is configured in WSL mode', () => {
    mockedExists.mockReturnValue(false);

    const resolver = new CodexCliResolver();
    const resolved = resolver.resolve(
      {
        'current-host': 'C:\\Users\\user\\AppData\\Roaming\\npm\\codex.exe',
      },
      '',
      '',
      { installationMethod: 'wsl', hostPlatform: 'win32' },
    );

    expect(resolved).toBe('codex');
  });
});
