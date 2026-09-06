import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  encodeVaultPathForSDK,
  getSDKSessionPath,
  locateSDKSessions,
} from '@/providers/claude/history/sdkSessionPaths';

describe('sdkSessionPaths', () => {
  let tempDir: string;

  /** The plural is what production calls; the singular wrapper had no caller. */
  async function locateOne(vaultPath: string, sessionId: string): Promise<unknown> {
    return (await locateSDKSessions(vaultPath, [sessionId], {
      environment: { CLAUDE_CONFIG_DIR: tempDir },
    })).get(sessionId) ?? { availability: 'unknown' };
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-claude-sessions-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it('uses CLAUDE_CONFIG_DIR for the expected project path', () => {
    expect(getSDKSessionPath('/vault', 'session-1', {
      environment: { CLAUDE_CONFIG_DIR: tempDir },
    })).toBe(path.join(
      tempDir,
      'projects',
      encodeVaultPathForSDK('/vault'),
      'session-1.jsonl',
    ));
  });

  it('finds a session relocated under another Claude project directory', async () => {
    const relocatedPath = path.join(tempDir, 'projects', 'older-project', 'session-1.jsonl');
    await fs.mkdir(path.dirname(relocatedPath), { recursive: true });
    await fs.writeFile(relocatedPath, '{}\n', 'utf8');

    await expect(locateOne('/current/vault', 'session-1')).resolves.toEqual({
      availability: 'relocated',
      sessionPath: relocatedPath,
    });
  });

  it('reports unknown for unsafe session identifiers without scanning', async () => {
    await expect(locateOne('/vault', '../session')).resolves.toEqual({ availability: 'unknown' });
  });
});
