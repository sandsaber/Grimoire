import * as fs from 'fs';
import * as path from 'path';

import { ReasonixCliResolver } from '@/providers/reasonix/runtime/ReasonixCliResolver';
import { getEnhancedPath } from '@/utils/env';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

describe('ReasonixCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers the executable on the inherited PATH over a second install in a fallback directory', () => {
    const bin = path.resolve('active-node', 'bin');
    const env = jest.replaceProperty(process, 'env', { ...process.env, PATH: bin });
    try {
      const fallback = getEnhancedPath().split(path.delimiter).find(directory => directory !== bin)!;
      const name = process.platform === 'win32' ? 'reasonix.exe' : 'reasonix';
      const active = path.join(bin, name);
      const older = path.join(fallback, name);
      mockedExists.mockImplementation((file: string) => file === older || file === active);
      mockedStat.mockReturnValue({ isFile: () => true });

      expect(new ReasonixCliResolver().resolve({}, '', '')).toBe(active);
    } finally {
      env.restore();
    }
  });

  it('uses the current host path instead of another synced host path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/reasonix');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ReasonixCliResolver();
    const resolved = resolver.resolve(
      {
        'current-host': '/current/reasonix',
        'other-host': '/other/reasonix',
      },
      '/legacy/reasonix',
      '',
    );

    expect(resolved).toBe('/current/reasonix');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/reasonix');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ReasonixCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/reasonix',
      },
      '/legacy/reasonix',
      '',
    );

    expect(resolved).toBe('/legacy/reasonix');
  });

  it('returns null when neither the current host nor the legacy path resolve to a file', () => {
    mockedExists.mockReturnValue(false);

    const resolver = new ReasonixCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/reasonix',
      },
      '/legacy/reasonix',
      '',
    );

    expect(resolved).toBeNull();
  });
});
