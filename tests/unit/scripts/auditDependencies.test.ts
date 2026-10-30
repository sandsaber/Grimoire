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

describe('npm audit exception boundary', () => {
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
