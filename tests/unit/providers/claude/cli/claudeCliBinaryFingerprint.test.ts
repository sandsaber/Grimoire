import * as fs from 'fs';

import { getClaudeCliBinaryFingerprint } from '@/providers/claude/cli/claudeCliBinaryFingerprint';

jest.mock('fs');

const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('getClaudeCliBinaryFingerprint', () => {
  beforeEach(() => mockedStatSync.mockReset());

  it('describes the installed build by size and modification time', () => {
    mockedStatSync.mockReturnValue({ mtimeMs: 1_700_000_000_123.456, size: 4096 } as fs.Stats);

    expect(getClaudeCliBinaryFingerprint('/usr/local/bin/claude')).toBe('4096:1700000000123');
    expect(mockedStatSync).toHaveBeenCalledWith('/usr/local/bin/claude');
  });

  it('falls back to an empty fingerprint when the path cannot be inspected', () => {
    mockedStatSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(getClaudeCliBinaryFingerprint('/missing/claude')).toBe('');
    expect(getClaudeCliBinaryFingerprint('')).toBe('');
  });
});
