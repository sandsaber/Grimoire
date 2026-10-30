import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveExistingKimicodeDatabasePath,
  resolveKimicodeDatabasePath,
  resolveKimicodeDataDir,
} from '../../../../src/providers/kimicode/runtime/KimicodePaths';

describe('KimicodePaths', () => {
  it('prefers XDG data directories for Kimi Code data', () => {
    expect(resolveKimicodeDataDir({
      HOME: '/home/tester',
      XDG_DATA_HOME: '/tmp/xdg-data',
    })).toBe(path.join('/tmp/xdg-data', 'kimicode'));
  });

  it('falls back to the existing resolved database when persisted metadata points at a missing path', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-kimicode-paths-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const dbDir = path.join(xdgDataHome, 'kimicode');
    const dbPath = path.join(dbDir, 'kimicode.db');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, '');

    const env = {
      HOME: path.join(tmpRoot, 'home'),
      XDG_DATA_HOME: xdgDataHome,
    } as NodeJS.ProcessEnv;

    expect(resolveKimicodeDatabasePath(env)).toBe(dbPath);
    expect(resolveExistingKimicodeDatabasePath('/missing/kimicode.db', env)).toBe(dbPath);
  });
});
