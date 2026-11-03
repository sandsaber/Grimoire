const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const ADVISORY = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';
const LEGACY_MINIMATCH_ADVISORY = 'https://github.com/advisories/GHSA-g3hv-75wg-m249';
const EXPIRES = Date.parse('2026-11-30T00:00:00Z');
const JEST_CHAIN = new Set(['deepmerge', 'jest-config', '@jest/core', 'jest-cli', 'jest', 'ts-jest']);
const ESLINT_CHAIN = new Set([
  'minimatch', '@eslint/eslintrc', '@eslint/config-array', 'eslint', '@eslint/js',
  '@eslint-community/eslint-utils', '@eslint-community/eslint-plugin-eslint-comments',
  '@microsoft/eslint-plugin-sdl', '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser',
  '@typescript-eslint/type-utils', '@typescript-eslint/utils', 'typescript-eslint',
  'eslint-compat-utils', 'eslint-plugin-es-x', 'eslint-plugin-import', 'eslint-plugin-jest',
  'eslint-plugin-json-schema-validator', 'eslint-plugin-n', 'eslint-plugin-no-unsanitized',
  'eslint-plugin-obsidianmd', 'eslint-plugin-react', 'eslint-plugin-simple-import-sort',
]);
const POLICIES = [
  { advisory: ADVISORY, dependency: 'deepmerge', severity: 'low', chain: JEST_CHAIN,
    nodes: { 'node_modules/deepmerge': '4.3.1' } },
  { advisory: LEGACY_MINIMATCH_ADVISORY, dependency: 'minimatch', severity: 'moderate', chain: ESLINT_CHAIN,
    nodes: {
      'node_modules/@eslint/eslintrc/node_modules/minimatch': '3.1.5',
      'node_modules/eslint-plugin-obsidianmd/node_modules/minimatch': '3.1.5',
    } },
];

// Exact, expiring dev-only exceptions; see DISCLOSURES.md for their evidence.
// Modern minimatch/glob copies must be patched rather than admitted here.
function evaluateAudit(report, lockfile, now = Date.now()) {
  if (report?.auditReportVersion !== 2 || report.error || !report.vulnerabilities
    || typeof report.vulnerabilities !== 'object'
    || Array.isArray(report.vulnerabilities)
    || report.metadata?.vulnerabilities?.total !== Object.keys(report.vulnerabilities).length) {
    throw new Error('Invalid npm audit report.');
  }
  function accept(name, policy) {
    const visited = new Set();
    let reachesAdvisory = false;
    function visit(current) {
      // npm reports peer-dependency cycles (eslint <-> eslint-utils). A cycle
      // is acceptable only when the whole graph is valid and reaches a leaf
      // carrying this policy's exact advisory; a closed cycle proves nothing.
      if (visited.has(current)) return true;
      visited.add(current);
      const finding = report.vulnerabilities[current];
      if (now >= EXPIRES || !policy.chain.has(current)
        || finding?.name !== current || finding.severity !== policy.severity
        || !Array.isArray(finding.nodes) || finding.nodes.length === 0
        || !finding.nodes.every(path => lockfile.packages?.[path]?.dev === true)
        || !Array.isArray(finding.via) || finding.via.length === 0) return false;
      return finding.via.every(via => {
        if (typeof via === 'string') return visit(via);
        if (current !== policy.dependency || via?.url !== policy.advisory
          || via.dependency !== policy.dependency || via.severity !== policy.severity
          || !finding.nodes.every(path => Object.hasOwn(policy.nodes, path)
            && lockfile.packages[path].version === policy.nodes[path])) return false;
        reachesAdvisory = true;
        return true;
      });
    }
    return visit(name) && reachesAdvisory;
  }
  const accepted = Object.keys(report.vulnerabilities).filter(name => POLICIES.some(policy => accept(name, policy)));
  const blocked = Object.keys(report.vulnerabilities).filter(name => !accepted.includes(name));
  if (blocked.length) throw new Error(`Unaccepted npm audit findings: ${blocked.join(', ')}.`);
  return accepted.sort();
}

if (require.main === module) {
  try {
    if (!process.env.npm_execpath) throw new Error('Run with npm run audit:deps.');
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json', '--include=dev'], {
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error(`npm audit exited ${result.status}: ${result.stderr}`);
    process.stdout.write(result.stdout);
    const allowed = evaluateAudit(JSON.parse(result.stdout), JSON.parse(readFileSync('package-lock.json', 'utf8')));
    for (const policy of POLICIES) {
      if (allowed.includes(policy.dependency)) {
        process.stdout.write(`Temporary dev-only exception: ${policy.advisory}; expires 2026-11-30.\n`);
      }
    }
    if (allowed.length) process.stdout.write(`Accepted dev-only findings: ${allowed.join(', ')}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { evaluateAudit };
