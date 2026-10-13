import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Coverage configuration dependencies', () => {
  it('loads inherited YAML settings and rejects executable YAML tags', () => {
    const directory = mkdtempSync(join(tmpdir(), 'grimoire-coverage-config-'));
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ nyc: { reporter: ['text'] } }));
      writeFileSync(join(directory, 'base.yml'), 'all: true\ninclude: [src/**/*.ts]\nbranches: 80\n');
      writeFileSync(join(directory, '.nycrc.yml'), 'extends: ./base.yml\ncheck-coverage: true\nexclude: [tests/**]\n');
      writeFileSync(join(directory, 'unsafe.yml'), 'value: !!js/function "function () { return 1; }"\n');

      // A child uses the installed dependency graph rather than Jest's module loader.
      const result = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const { loadNycConfig } = require('@istanbuljs/load-nyc-config');
        const cwd = process.argv[1];
        (async () => {
          const config = await loadNycConfig({ cwd });
          assert.equal(config.all, true);
          assert.equal(config.checkCoverage, true);
          assert.equal(config.branches, 80);
          assert.deepEqual(config.include, ['src/**/*.ts']);
          assert.deepEqual(config.exclude, ['tests/**']);
          assert.deepEqual(config.reporter, ['text']);
          await assert.rejects(loadNycConfig({ cwd, nycrcPath: 'unsafe.yml' }), /unknown tag/);
        })().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
      `, directory], { encoding: 'utf8' });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
