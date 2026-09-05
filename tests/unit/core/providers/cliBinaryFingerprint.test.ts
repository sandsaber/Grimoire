import * as fs from 'fs';

import { getCliBinaryFingerprint } from '@/core/providers/cliBinaryFingerprint';

jest.mock('fs');

const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('getCliBinaryFingerprint', () => {
  beforeEach(() => mockedStatSync.mockReset());

  it('describes the installed build by size and modification time', () => {
    mockedStatSync.mockReturnValue({ mtimeMs: 1_700_000_000_123.456, size: 4096 } as fs.Stats);

    expect(getCliBinaryFingerprint('/usr/local/bin/claude')).toBe('4096:1700000000123');
    expect(mockedStatSync).toHaveBeenCalledWith('/usr/local/bin/claude');
  });

  it('falls back to an empty fingerprint when the path cannot be inspected', () => {
    mockedStatSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(getCliBinaryFingerprint('/missing/claude')).toBe('');
    expect(getCliBinaryFingerprint('')).toBe('');
  });
});
