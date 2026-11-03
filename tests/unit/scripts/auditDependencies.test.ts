import { evaluateAudit } from '../../../scripts/audit-dependencies.js';

function fixture() {
  return {
    report: { auditReportVersion: 2, metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
      deepmerge: { name: 'deepmerge', severity: 'low', nodes: ['node_modules/deepmerge'], via: [{
        url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4', dependency: 'deepmerge', severity: 'low',
      }] },
      'jest-config': { name: 'jest-config', severity: 'low', nodes: ['node_modules/jest-config'], via: ['deepmerge'] },
    } },
    lockfile: { packages: { 'node_modules/deepmerge': { dev: true, version: '4.3.1' },
      'node_modules/jest-config': { dev: true, version: '30.5.2' } } },
  };
}
const now = Date.parse('2026-10-30T00:00:00Z');

function legacyMinimatchFixture() {
  const path = 'node_modules/@eslint/eslintrc/node_modules/minimatch';
  const packages: Record<string, { dev: boolean; version: string }> = {
    [path]: { dev: true, version: '3.1.5' },
    'node_modules/@eslint/eslintrc': { dev: true, version: '3.3.6' },
  };
  return {
    report: { auditReportVersion: 2, metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
      minimatch: { name: 'minimatch', severity: 'moderate', nodes: [path], via: [{
        url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', dependency: 'minimatch', severity: 'moderate',
      }] },
      '@eslint/eslintrc': { name: '@eslint/eslintrc', severity: 'moderate', nodes: ['node_modules/@eslint/eslintrc'], via: ['minimatch'] },
    } },
    lockfile: { packages },
  };
}

describe('npm audit exception boundary', () => {
  it('accepts only the reviewed legacy minimatch copies and their dev-tooling findings', () => {
    const { report, lockfile } = legacyMinimatchFixture();
    expect(evaluateAudit(report, lockfile, now)).toEqual(['@eslint/eslintrc', 'minimatch']);
  });

  it.each(['production', 'unknown advisory', 'modern version', 'unreviewed path', 'severity', 'expired'])(
    'rejects a legacy minimatch exception with %s', change => {
      const { report, lockfile } = legacyMinimatchFixture();
      const path = report.vulnerabilities.minimatch.nodes[0];
      if (change === 'production') lockfile.packages[path].dev = false;
      if (change === 'unknown advisory') report.vulnerabilities.minimatch.via[0].url += '-other';
      if (change === 'modern version') lockfile.packages[path].version = '10.2.6';
      if (change === 'unreviewed path') {
        const next = 'node_modules/unreviewed/node_modules/minimatch';
        lockfile.packages[next] = lockfile.packages[path];
        report.vulnerabilities.minimatch.nodes = [next];
      }
      if (change === 'severity') report.vulnerabilities.minimatch.severity = 'high';
      expect(() => evaluateAudit(report, lockfile,
        change === 'expired' ? Date.parse('2026-11-30T00:00:00Z') : now)).toThrow();
    },
  );

  it('handles npm peer-dependency cycles only when they reach the exact reviewed advisory', () => {
    const { report, lockfile } = legacyMinimatchFixture();
    const cyclic = {
      ...report,
      metadata: { vulnerabilities: { total: 4 } },
      vulnerabilities: {
        ...report.vulnerabilities,
        eslint: { name: 'eslint', severity: 'moderate', nodes: ['node_modules/eslint'], via: ['@eslint-community/eslint-utils', '@eslint/eslintrc'] },
        '@eslint-community/eslint-utils': { name: '@eslint-community/eslint-utils', severity: 'moderate', nodes: ['node_modules/@eslint-community/eslint-utils'], via: ['eslint'] },
      },
    };
    lockfile.packages['node_modules/eslint'] = { dev: true, version: '10.13.0' };
    lockfile.packages['node_modules/@eslint-community/eslint-utils'] = { dev: true, version: '4.9.1' };
    expect(evaluateAudit(cyclic, lockfile, now)).toEqual([
      '@eslint-community/eslint-utils', '@eslint/eslintrc', 'eslint', 'minimatch',
    ]);
    cyclic.vulnerabilities.eslint.via = ['@eslint-community/eslint-utils'];
    expect(() => evaluateAudit(cyclic, lockfile, now)).toThrow();
  });

  it('reports the exact dev-only advisory and its dependent findings', () => {
    const { report, lockfile } = fixture();
    expect(evaluateAudit(report, lockfile, now)).toEqual(['deepmerge', 'jest-config']);
  });

  it.each(['production', 'production leaf', 'unknown advisory', 'mixed advisory', 'unknown dependency', 'severity', 'version', 'missing node', 'cycle', 'expired'])(
    'fails closed for %s', change => {
      const { report, lockfile } = fixture();
      if (change === 'production') lockfile.packages['node_modules/jest-config'].dev = false;
      if (change === 'production leaf') lockfile.packages['node_modules/deepmerge'].dev = false;
      if (change === 'unknown advisory') report.vulnerabilities.deepmerge.via[0].url += '-other';
      if (change === 'mixed advisory') report.vulnerabilities.deepmerge.via.push({
        ...report.vulnerabilities.deepmerge.via[0], url: 'https://github.com/advisories/GHSA-other',
      });
      if (change === 'unknown dependency') report.vulnerabilities['jest-config'].via.push('unknown');
      if (change === 'severity') report.vulnerabilities.deepmerge.severity = 'high';
      if (change === 'version') lockfile.packages['node_modules/deepmerge'].version = '4.4.0';
      if (change === 'missing node') report.vulnerabilities.deepmerge.nodes.push('node_modules/missing');
      if (change === 'cycle') report.vulnerabilities['jest-config'].via = ['jest-config'];
      expect(() => evaluateAudit(report, lockfile,
        change === 'expired' ? Date.parse('2026-11-30T00:00:00Z') : now)).toThrow();
    });

  it.each([{}, { error: 'network failed' }, { auditReportVersion: 2, vulnerabilities: {} },
    { auditReportVersion: 2, vulnerabilities: 1, metadata: { vulnerabilities: { total: 0 } } }])('rejects incomplete audit output: %j', report => {
      expect(() => evaluateAudit(report, {}, now)).toThrow('Invalid npm audit report');
    });
});
