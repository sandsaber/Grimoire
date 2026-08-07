import { buildOpencodeLaunchSpec } from '@/providers/opencode/runtime/OpencodeLaunchSpecBuilder';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

function wslSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      opencode: {
        installationMethodsByHost: { 'host-a': 'wsl' },
        ...overrides,
      },
    },
  };
}

describe('buildOpencodeLaunchSpec', () => {
  it('spawns wsl.exe directly without a shell in WSL mode', () => {
    const spec = buildOpencodeLaunchSpec({
      settings: wslSettings({ wslDistroOverridesByHost: { 'host-a': 'Ubuntu' } }),
      resolvedCliCommand: 'opencode',
      hostVaultPath: 'C:\\repo',
      env: { SystemRoot: 'C:\\WINDOWS' },
      hostPlatform: 'win32',
    });

    expect(spec.command).toBe('C:\\WINDOWS\\System32\\wsl.exe');
    expect(spec.shell).toBe(false);
    expect(spec.args).toEqual([
      '--distribution',
      'Ubuntu',
      '--cd',
      '/mnt/c/repo',
      'opencode',
      'acp',
    ]);
    expect(spec.target).toMatchObject({
      method: 'wsl',
      distroName: 'Ubuntu',
      platformOs: 'linux',
    });
  });

  it('uses the default WSL distro when no override is configured', () => {
    const spec = buildOpencodeLaunchSpec({
      settings: wslSettings(),
      resolvedCliCommand: 'opencode',
      hostVaultPath: 'C:\\repo',
      env: {},
      hostPlatform: 'win32',
      resolveDefaultWslDistro: () => 'Debian',
    });

    expect(spec.command).toBe('wsl.exe');
    expect(spec.shell).toBe(false);
    expect(spec.target.distroName).toBe('Debian');
    expect(spec.args).toEqual([
      '--distribution',
      'Debian',
      '--cd',
      '/mnt/c/repo',
      'opencode',
      'acp',
    ]);
  });

  it('accepts \\wsl.localhost workspace paths and preserves that UNC flavor for mapped host paths', () => {
    const spec = buildOpencodeLaunchSpec({
      settings: wslSettings(),
      resolvedCliCommand: 'opencode',
      hostVaultPath: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      env: {},
      hostPlatform: 'win32',
      resolveDefaultWslDistro: () => 'Ubuntu',
    });

    expect(spec.command).toBe('wsl.exe');
    expect(spec.targetCwd).toBe('/home/user/repo');
    expect(spec.target.wslHostFlavor).toBe('wsl.localhost');
    expect(spec.args).toEqual([
      '--distribution',
      'Ubuntu',
      '--cd',
      '/home/user/repo',
      'opencode',
      'acp',
    ]);
    expect(spec.pathMapper.toHostPath('/home/user/repo/.grimoire/opencode')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\.grimoire\\opencode',
    );
  });

  it('drops the host PATH and remaps OPENCODE_DB for WSL launches', () => {
    const spec = buildOpencodeLaunchSpec({
      settings: wslSettings({ wslDistroOverridesByHost: { 'host-a': 'Ubuntu' } }),
      resolvedCliCommand: 'opencode',
      hostVaultPath: 'C:\\repo',
      env: {
        OPENCODE_DB: 'C:\\repo\\.opencode\\app.db',
        PATH: 'C:\\WINDOWS\\System32;C:\\Tools',
      },
      hostPlatform: 'win32',
    });

    expect(spec.env.OPENCODE_DB).toBe('/mnt/c/repo/.opencode/app.db');
    expect(spec.env.PATH).toBeUndefined();
  });

  it('leaves shell selection to the spawn heuristic for host-native launches', () => {
    const spec = buildOpencodeLaunchSpec({
      settings: {},
      resolvedCliCommand: 'opencode.cmd',
      hostVaultPath: 'C:\\repo',
      env: {},
      hostPlatform: 'win32',
    });

    expect(spec.command).toBe('opencode.cmd');
    expect(spec.shell).toBeUndefined();
    expect(spec.args).toEqual(['acp']);
    expect(spec.target).toMatchObject({ method: 'native-windows' });
  });

  it('fails fast when WSL mode cannot determine a distro', () => {
    expect(() => buildOpencodeLaunchSpec({
      settings: wslSettings(),
      resolvedCliCommand: 'opencode',
      hostVaultPath: 'C:\\repo',
      env: {},
      hostPlatform: 'win32',
      resolveDefaultWslDistro: () => undefined,
    })).toThrow(
      'Unable to determine the WSL distro. Set WSL distro override or configure a default WSL distro.',
    );
  });

  it('fails fast when the workspace path cannot be represented inside WSL', () => {
    expect(() => buildOpencodeLaunchSpec({
      settings: wslSettings({ wslDistroOverridesByHost: { 'host-a': 'Ubuntu' } }),
      resolvedCliCommand: 'opencode',
      hostVaultPath: '\\\\server\\share\\repo',
      env: {},
      hostPlatform: 'win32',
    })).toThrow('WSL mode only supports Windows drive paths and \\\\wsl$ or \\\\wsl.localhost workspace paths');
  });
});
