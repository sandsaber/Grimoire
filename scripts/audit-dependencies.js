const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const ADVISORY = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';
const EXPIRES = Date.parse('2026-11-30T00:00:00Z');
const JEST_CHAIN = new Set(['deepmerge', 'jest-config', '@jest/core', 'jest-cli', 'jest', 'ts-jest']);

// No patched deepmerge release exists. This exception covers only Jest's trusted
// local configuration, never a production node or another advisory (DISCLOSURES.md).
function evaluateAudit(report, lockfile, now = Date.now()) {
  if (report?.auditReportVersion !== 2 || report.error || !report.vulnerabilities
    || typeof report.vulnerabilities !== 'object'
    || Array.isArray(report.vulnerabilities)
    || report.metadata?.vulnerabilities?.total !== Object.keys(report.vulnerabilities).length) {
    throw new Error('Invalid npm audit report.');
  }
  const accepted = new Set();
  function accept(name, visiting = new Set()) {
    if (accepted.has(name)) return true;
    const finding = report.vulnerabilities[name];
    if (now >= EXPIRES || visiting.has(name) || !JEST_CHAIN.has(name)
      || finding?.name !== name || finding.severity !== 'low'
      || !Array.isArray(finding.nodes) || finding.nodes.length === 0
      || !finding.nodes.every(path => lockfile.packages?.[path]?.dev === true)
      || !Array.isArray(finding.via) || finding.via.length === 0) return false;
    const next = new Set([...visiting, name]);
    const allowed = finding.via.every(via => typeof via === 'string' ? accept(via, next)
      : name === 'deepmerge' && via?.url === ADVISORY && via.dependency === 'deepmerge'
        && via.severity === 'low'
        && finding.nodes.every(path => lockfile.packages[path].version === '4.3.1'));
    if (allowed) accepted.add(name);
    return allowed;
  }
  const blocked = Object.keys(report.vulnerabilities).filter(name => !accept(name));
  if (blocked.length) throw new Error(`Unaccepted npm audit findings: ${blocked.join(', ')}.`);
  return [...accepted].sort();
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
    if (allowed.length) process.stdout.write(`Temporary dev-only exception: ${ADVISORY}; expires 2026-11-30; ${allowed.join(', ')}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { evaluateAudit };
