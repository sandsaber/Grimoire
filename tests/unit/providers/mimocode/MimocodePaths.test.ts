import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveExistingMimocodeDatabasePath,
  resolveMimocodeDatabasePath,
  resolveMimocodeDataDir,
} from '../../../../src/providers/mimocode/runtime/MimocodePaths';

describe('MimocodePaths', () => {
  it('prefers XDG data directories for MiMoCode data', () => {
    expect(resolveMimocodeDataDir({
      HOME: '/home/tester',
      XDG_DATA_HOME: '/tmp/xdg-data',
    })).toBe(path.join('/tmp/xdg-data', 'mimocode'));
  });

  it('falls back to the existing resolved database when persisted metadata points at a missing path', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-mimocode-paths-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const dbDir = path.join(xdgDataHome, 'mimocode');
    const dbPath = path.join(dbDir, 'mimocode.db');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, '');

    const env = {
      HOME: path.join(tmpRoot, 'home'),
      XDG_DATA_HOME: xdgDataHome,
    } as NodeJS.ProcessEnv;

    expect(resolveMimocodeDatabasePath(env)).toBe(dbPath);
    expect(resolveExistingMimocodeDatabasePath('/missing/mimocode.db', env)).toBe(dbPath);
  });
});
