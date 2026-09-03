import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  findImportantDeclarations,
  findPartialCssSupportFeatures,
} from '../../../scripts/reviewCss.js';
import { getReviewSourceEslintArgs } from '../../../scripts/reviewSource.js';

interface PackageJson {
  scripts: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
}

function runDependencyGate(packages: Record<string, { version?: string }>) {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'grimoire-review-deps-'));
  const fixturePath = join(fixtureDir, 'package-lock.json');
  writeFileSync(fixturePath, JSON.stringify({ lockfileVersion: 3, packages }));

  try {
    return spawnSync(process.execPath, ['scripts/check-review-dependencies.mjs', fixturePath], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(fixtureDir, { force: true, recursive: true });
  }
}

describe('Obsidian review gate', () => {
  it('runs source, CSS, and dependency review checks before release builds', () => {
    const scripts = readPackageJson().scripts;

    expect(scripts['review:source']).toBe('node scripts/check-review-source.mjs');
    expect(scripts['review:css']).toBe('node scripts/check-review-css.mjs');
    expect(scripts['prebuild:release']).toBe('npm run lint && npm run review:source && npm run review:css && npm run review:deps');
  });

  it('lints source and tests', () => {
    const scripts = readPackageJson().scripts;

    expect(scripts.lint).toBe('eslint "src/**/*.ts" "tests/**/*.ts" --max-warnings=0');
  });

  it('uses an isolated npm 12 prefix in CI and release workflows', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const contents = readFileSync(workflow, 'utf8');

      expect(contents).toContain('npm install --global --prefix "${RUNNER_TEMP}/npm-12.0.2" npm@12.0.2 --ignore-scripts --no-audit --no-fund');
      expect(contents).toContain('echo "${RUNNER_TEMP}/npm-12.0.2/bin" >> "${GITHUB_PATH}"');
      expect(contents).toContain('test "$(npm --version)" = "12.0.2"');
      expect(contents).not.toContain('npm install --global npm@12.0.2');
    }
  });

  it('allows the community scanner to install with its npm version', () => {
    const npmConfig = readFileSync('.npmrc', 'utf8');

    expect(npmConfig).not.toContain('engine-strict=true');
  });

  it('tracks the current Hono, Fast URI, and brace-expansion advisory floors', () => {
    const dependencyGate = readFileSync('scripts/check-review-dependencies.mjs', 'utf8');

    expect(dependencyGate).toContain('GHSA-8j4g-w8fx-2239');
    expect(dependencyGate).toContain('lessThan(version, "4.12.34")');
    expect(dependencyGate).toContain('GHSA-7p8r-x3mc-p8w7');
    // 3.1.5 moved from the first patched release to the last vulnerable one
    // when the September 2026 fast-uri advisories landed.
    expect(dependencyGate).toContain('GHSA-jqff-g426-hqxp');
    expect(dependencyGate).toContain('lessThanOrEqual(version, "3.1.5")');
    expect(dependencyGate).toContain('GHSA-4mjr-xmp4-gh2g');
    expect(dependencyGate).toContain('lessThan(version, "6.16.0")');
    expect(dependencyGate).toContain('GHSA-rgw5-rvv9-x895');
    expect(dependencyGate).toContain('lessThan(version, "1.1.18")');
    expect(dependencyGate).toContain('lessThan(version, "2.1.4")');
    expect(dependencyGate).toContain('lessThan(version, "5.0.9")');
  });

  it('rejects vulnerable hoisted, scoped, and nested lockfile packages', () => {
    const result = runDependencyGate({
      '': { version: '1.0.0' },
      'node_modules/hono': { version: '4.12.33' },
      'node_modules/@hono/node-server': { version: '2.0.4' },
      'node_modules/brace-expansion': { version: '5.0.8' },
      'node_modules/example/node_modules/brace-expansion': { version: '1.1.17' },
      'node_modules/fast-uri': { version: '3.1.5' },
      'node_modules/qs': { version: '6.15.3' },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hono@4.12.33');
    expect(result.stderr).toContain('@hono/node-server@2.0.4');
    expect(result.stderr).toContain('brace-expansion@5.0.8');
    expect(result.stderr).toContain('brace-expansion@1.1.17');
    expect(result.stderr).toContain('fast-uri@3.1.5');
    expect(result.stderr).toContain('qs@6.15.3');
  });

  it('accepts patched hoisted, scoped, and nested lockfile packages', () => {
    const result = runDependencyGate({
      '': { version: '1.0.0' },
      'node_modules/hono': { version: '4.12.34' },
      'node_modules/@hono/node-server': { version: '2.0.5' },
      'node_modules/fast-uri': { version: '3.1.6' },
      'node_modules/qs': { version: '6.16.0' },
      'node_modules/brace-expansion': { version: '5.0.9' },
      'node_modules/example/node_modules/brace-expansion': { version: '1.1.18' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Obsidian review dependency check passed.');
  });

  it('passes Obsidian source-review rules to eslint without shell quoting', () => {
    const args = getReviewSourceEslintArgs();

    expect(args).toEqual(expect.arrayContaining([
      'src/**/*.ts',
      '--max-warnings=0',
      '--rule',
      '@typescript-eslint/no-deprecated:error',
      '@typescript-eslint/no-unsafe-assignment:error',
      '@typescript-eslint/no-unsafe-return:error',
      '@typescript-eslint/no-unsafe-call:error',
      '@typescript-eslint/no-unsafe-member-access:error',
      '@typescript-eslint/no-unsafe-argument:error',
    ]));
    expect(args.some((arg) => arg.includes("'"))).toBe(false);
  });

  it('reports important CSS declarations but ignores comments', () => {
    const findings = findImportantDeclarations([
      {
        file: 'src/style/example.css',
        contents: [
          '.example {',
          '  color: var(--text-normal) !important;',
          '  background: transparent;',
          '}',
          '/* docs: avoid !important in new styles */',
        ].join('\n'),
      },
    ]);

    expect(findings).toEqual([
      {
        declaration: 'color: var(--text-normal) !important;',
        file: 'src/style/example.css',
        line: 2,
      },
    ]);
  });

  it('reports CSS features that Obsidian review only partially supports', () => {
    const findings = findPartialCssSupportFeatures([
      {
        file: 'src/style/example.css',
        contents: [
          '.section {',
          '  display: contents;',
          '  color: var(--text-normal);',
          '}',
          '/* display: contents is fine inside comments */',
        ].join('\n'),
      },
    ]);

    expect(findings).toEqual([
      {
        declaration: 'display: contents;',
        featureId: 'css-display-contents',
        file: 'src/style/example.css',
        line: 2,
        message:
          'Unexpected browser feature "css-display-contents" is only partially supported by Obsidian 1.11.4',
      },
    ]);
  });
});
