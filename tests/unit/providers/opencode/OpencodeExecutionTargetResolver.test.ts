import { execFileSync } from 'child_process';

import {
  decodeWslListOutput,
  inferWslDistroFromWindowsPath,
  parseDefaultWslDistroListOutput,
  resolveOpencodeExecutionTarget,
} from '@/providers/opencode/runtime/OpencodeExecutionTargetResolver';

jest.mock('child_process');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

const mockedExecFileSync = execFileSync as jest.Mock;

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

describe('OpencodeExecutionTargetResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseDefaultWslDistroListOutput', () => {
    it('returns the distro marked with an asterisk', () => {
      const output = [
        '  NAME                   STATE           VERSION',
        '* Ubuntu                 Running         2',
        '  Debian                 Stopped         2',
      ].join('\r\n');

      expect(parseDefaultWslDistroListOutput(output)).toBe('Ubuntu');
    });

    it('strips a UTF-8 BOM before parsing', () => {
      const output = '\uFEFF  NAME                   STATE           VERSION\n* Ubuntu                 Running         2';

      expect(parseDefaultWslDistroListOutput(output)).toBe('Ubuntu');
    });

    it('returns undefined when no distro is marked as default', () => {
      const output = [
        '  NAME                   STATE           VERSION',
        '  Ubuntu                 Running         2',
        '  Debian                 Stopped         2',
      ].join('\n');

      expect(parseDefaultWslDistroListOutput(output)).toBeUndefined();
    });

    it('returns undefined for empty output', () => {
      expect(parseDefaultWslDistroListOutput('')).toBeUndefined();
    });
  });

  describe('decodeWslListOutput', () => {
    it('decodes UTF-16LE output carrying a BOM', () => {
      const text = '  NAME                   STATE           VERSION\r\n* Ubuntu                 Running         2';
      const raw = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

      expect(decodeWslListOutput(raw)).toBe(text);
    });

    it('decodes plain UTF-8 output unchanged', () => {
      const raw = Buffer.from('* Ubuntu                 Running         2', 'utf8');

      expect(decodeWslListOutput(raw)).toBe('* Ubuntu                 Running         2');
    });
  });

  describe('inferWslDistroFromWindowsPath', () => {
    it('extracts the distro from a wsl$ vault path', () => {
      expect(inferWslDistroFromWindowsPath('\\\\wsl$\\Ubuntu\\notes')).toBe('Ubuntu');
    });

    it('extracts the distro from a wsl.localhost vault path', () => {
      expect(inferWslDistroFromWindowsPath('\\\\wsl.localhost\\Ubuntu\\notes')).toBe('Ubuntu');
    });

    it('returns undefined for a non-wsl path', () => {
      expect(inferWslDistroFromWindowsPath('C:\\notes')).toBeUndefined();
    });

    it('returns undefined for missing input', () => {
      expect(inferWslDistroFromWindowsPath(undefined)).toBeUndefined();
      expect(inferWslDistroFromWindowsPath('')).toBeUndefined();
    });
  });

  describe('resolveOpencodeExecutionTarget', () => {
    it('returns host-native for a non-Windows host', () => {
      const target = resolveOpencodeExecutionTarget({ settings: {}, hostPlatform: 'linux' });

      expect(target).toEqual({ method: 'host-native', platformFamily: 'unix', platformOs: 'linux' });
    });

    it('returns native-windows when the installation method is not wsl', () => {
      const target = resolveOpencodeExecutionTarget({ settings: {}, hostPlatform: 'win32' });

      expect(target).toEqual({
        method: 'native-windows',
        platformFamily: 'windows',
        platformOs: 'windows',
      });
    });

    it('prefers the WSL distro override', () => {
      const target = resolveOpencodeExecutionTarget({
        settings: wslSettings({ wslDistroOverridesByHost: { 'host-a': 'Arch' } }),
        hostPlatform: 'win32',
      });

      expect(target).toEqual({
        method: 'wsl',
        platformFamily: 'unix',
        platformOs: 'linux',
        distroName: 'Arch',
        wslHostFlavor: undefined,
      });
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('infers the distro from a wsl$ vault path when no override is set', () => {
      const target = resolveOpencodeExecutionTarget({
        settings: wslSettings(),
        hostPlatform: 'win32',
        hostVaultPath: '\\\\wsl$\\Ubuntu\\notes',
      });

      expect(target).toEqual({
        method: 'wsl',
        platformFamily: 'unix',
        platformOs: 'linux',
        distroName: 'Ubuntu',
        wslHostFlavor: 'wsl$',
      });
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('infers the distro from a wsl.localhost vault path when no override is set', () => {
      const target = resolveOpencodeExecutionTarget({
        settings: wslSettings(),
        hostPlatform: 'win32',
        hostVaultPath: '\\\\wsl.localhost\\Ubuntu\\notes',
      });

      expect(target).toEqual({
        method: 'wsl',
        platformFamily: 'unix',
        platformOs: 'linux',
        distroName: 'Ubuntu',
        wslHostFlavor: 'wsl.localhost',
      });
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('uses an injected default-distro resolver before probing wsl.exe', () => {
      const target = resolveOpencodeExecutionTarget({
        settings: wslSettings(),
        hostPlatform: 'win32',
        resolveDefaultWslDistro: () => 'Debian',
      });

      expect(target.distroName).toBe('Debian');
      expect(mockedExecFileSync).not.toHaveBeenCalled();
    });

    it('probes wsl.exe with WSL_UTF8 and parses UTF-16LE output as a last resort', () => {
      const text = '  NAME                   STATE           VERSION\r\n* Ubuntu                 Running         2';
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
      mockedExecFileSync.mockReturnValue(utf16);

      const target = resolveOpencodeExecutionTarget({
        settings: wslSettings(),
        hostPlatform: 'win32',
      });

      expect(target).toEqual({
        method: 'wsl',
        platformFamily: 'unix',
        platformOs: 'linux',
        distroName: 'Ubuntu',
        wslHostFlavor: undefined,
      });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/wsl\.exe$/i),
        ['--list', '--verbose'],
        expect.objectContaining({ env: expect.objectContaining({ WSL_UTF8: '1' }) }),
      );
    });
  });
});
