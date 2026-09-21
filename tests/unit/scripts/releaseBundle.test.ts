import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createReleaseBundle } from '../../../scripts/releaseBundle.js';
import {
  verifyReleaseBundleLoads,
  verifyReleaseBundleOpensView,
} from '../../../scripts/verifyReleaseLoad.js';

describe('release bundle helpers', () => {
  it('copies only Obsidian-supported plugin files into a clean release folder', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'grimoire-release-'));
    const outputDir = join(rootDir, 'dist', 'grimoire');

    try {
      writeFileSync(join(rootDir, 'main.js'), 'main bundle');
      writeFileSync(join(rootDir, 'manifest.json'), '{"id":"grimoire"}');
      writeFileSync(join(rootDir, 'styles.css'), 'plugin styles');
      writeFileSync(join(rootDir, 'CHANGELOG.md'), '# Changelog');
      writeFileSync(join(rootDir, 'README.md'), 'not part of the release bundle');

      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'stale.txt'), 'stale release artifact');

      const result = createReleaseBundle({ rootDir, outputDir });

      expect(result).toEqual({
        outputDir,
        files: ['main.js', 'manifest.json', 'styles.css'],
      });
      expect(readdirSync(outputDir).sort()).toEqual([
        'main.js',
        'manifest.json',
        'styles.css',
      ]);
      expect(readFileSync(join(outputDir, 'main.js'), 'utf8')).toBe('main bundle');
      expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe('{"id":"grimoire"}');
      expect(readFileSync(join(outputDir, 'styles.css'), 'utf8')).toBe('plugin styles');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('verifies release bundles from an isolated install location', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'grimoire-release-load-'));
    const outputDir = join(rootDir, 'dist', 'grimoire');

    try {
      mkdirSync(join(rootDir, 'node_modules', 'repo-only-dep'), { recursive: true });
      writeFileSync(join(rootDir, 'node_modules', 'repo-only-dep', 'index.js'), 'module.exports = {};');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, 'main.js'),
        'require("repo-only-dep"); module.exports = { default: class Plugin {} };',
      );

      expect(() => verifyReleaseBundleLoads(join(outputDir, 'main.js'), { log: false })).toThrow(
        /repo-only-dep/,
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('smoke-tests that the release bundle opens the Grimoire view', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'grimoire-release-view-'));
    const outputDir = join(rootDir, 'dist', 'grimoire');

    try {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, 'main.js'),
        `
          module.exports = {
            default: class GrimoirePlugin {
              constructor() {
                this._registeredViews = new Map();
              }
              async onload() {
                this._registeredViews.set("grimoire-view", (leaf) => ({
                  contentEl: leaf.app.document.createElement("div"),
                  getViewType() { return "grimoire-view"; },
                  async onOpen() {
                    this.contentEl.createDiv({ cls: "grimoire-tab-content" });
                  }
                }));
              }
            }
          };
        `,
      );

      await expect(
        verifyReleaseBundleOpensView(join(outputDir, 'main.js'), { log: false }),
      ).resolves.toEqual({
        tabCount: 1,
        viewType: 'grimoire-view',
      });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
