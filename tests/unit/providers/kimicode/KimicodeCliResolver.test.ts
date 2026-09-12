import * as os from 'node:os';
import * as path from 'node:path';

import * as fs from 'fs';

import { KimicodeCliResolver } from '@/providers/kimicode/runtime/KimicodeCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

describe('KimicodeCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the current host path instead of another synced host path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/kimicode');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new KimicodeCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/kimicode',
        'current-host': '/current/kimicode',
      },
      '/legacy/kimicode',
      '',
    );

    expect(resolved).toBe('/current/kimicode');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/kimicode');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new KimicodeCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/kimicode',
      },
      '/legacy/kimicode',
      '',
    );

    expect(resolved).toBe('/legacy/kimicode');
  });

  it('returns null when neither the current host nor the legacy path resolve to a file', () => {
    mockedExists.mockReturnValue(false);

    const resolver = new KimicodeCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/kimicode',
      },
      '/legacy/kimicode',
      '',
    );

    expect(resolved).toBeNull();
  });

  it('detects the default Windows kimi.exe installation', () => {
    const defaultExecutable = path.join(os.homedir(), '.kimi-code', 'bin', 'kimi.exe');
    mockedExists.mockImplementation((filePath: string) => filePath === defaultExecutable);
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new KimicodeCliResolver();
    const resolved = resolver.resolve({}, '', '');

    expect(resolved).toBe(defaultExecutable);
  });
});
