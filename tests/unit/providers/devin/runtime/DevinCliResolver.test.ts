import * as fs from 'fs';

import { DevinCliResolver } from '@/providers/devin/runtime/DevinCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

describe('DevinCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the current host path instead of another synced host path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/devin');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new DevinCliResolver();
    const resolved = resolver.resolve(
      {
        'current-host': '/current/devin',
        'other-host': '/other/devin',
      },
      '/legacy/devin',
      '',
    );

    expect(resolved).toBe('/current/devin');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/devin');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new DevinCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/devin',
      },
      '/legacy/devin',
      '',
    );

    expect(resolved).toBe('/legacy/devin');
  });

  it('returns null when neither the current host nor the legacy path resolve to a file', () => {
    mockedExists.mockReturnValue(false);

    const resolver = new DevinCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/devin',
      },
      '/legacy/devin',
      '',
    );

    expect(resolved).toBeNull();
  });
});
