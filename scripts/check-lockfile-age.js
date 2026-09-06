const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const REGISTRY_ORIGIN = 'https://registry.npmjs.org';
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EXCEPTION_POLICY = 'lockfile-age-exceptions.json';

async function validateLockfileAge(lockfile, npmrc, options = {}) {
  if (lockfile.lockfileVersion !== 3 || !lockfile.packages || typeof lockfile.packages !== 'object') {
    throw new Error('Expected a package-lock v3 file with a packages object.');
  }

  const minimumAgeDays = parseMinimumReleaseAge(npmrc);
  const exceptions = validateExceptionPolicy(options.exceptions ?? { version: 1, exceptions: [] });
  const packages = collectLockedRegistryPackages(lockfile);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available to validate npm publication times.');

  const now = options.now ?? new Date();
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('The validation clock is invalid.');

  const failures = [];
  const packageGroups = groupByPackageVersion(packages);
  await mapWithConcurrency([...packageGroups.values()], options.concurrency ?? DEFAULT_CONCURRENCY, async (lockedEntries) => {
    const locked = lockedEntries[0];
    try {
      const packument = await fetchPackument(locked.name, fetchImpl, options);
      for (const entry of lockedEntries) validateAuthoritativeDist(packument, entry);
      const publishedAt = parsePublicationTime(packument, locked);
      const ageMs = nowMs - publishedAt.getTime();
      const eligibleAt = new Date(publishedAt.getTime() + minimumAgeDays * 24 * 60 * 60 * 1000);
      if (ageMs < minimumAgeDays * 24 * 60 * 60 * 1000) {
        const exception = exceptions.get(`${locked.name}@${locked.version}`);
        if (exception) validateExceptionEligibility(exception, publishedAt, eligibleAt, nowMs, locked);
        else throw new Error(`published ${publishedAt.toISOString()}; eligible ${eligibleAt.toISOString()}; below the ${minimumAgeDays}-day minimum`);
      }
    } catch (error) {
      failures.push(`${locked.name}@${locked.version}: ${error.message}`);
    }
  });

  if (failures.length > 0) throw new Error(`Lockfile release-age validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  // An exception is a temporary waiver, and an expired one waives nothing: the
  // package it covered is either old enough now or already failing above. They
  // accumulated to forty-two before anyone noticed, because nothing said so.
  const expired = [...exceptions.values()]
    .filter((entry) => nowMs > entry.expiresAt.getTime())
    .map((entry) => `${entry.package}@${entry.version}`);
  return { minimumAgeDays, packagesChecked: packages.length, expiredExceptions: expired };
}

function validateExceptionPolicy(policy) {
  if (!policy || policy.version !== 1 || !Array.isArray(policy.exceptions)) {
    throw new Error('Lockfile-age exception policy must contain version 1 and an exceptions array.');
  }
  const exceptions = new Map();
  for (const entry of policy.exceptions) {
    if (!entry || typeof entry.package !== 'string' || typeof entry.version !== 'string'
      || typeof entry.reason !== 'string' || typeof entry.expiresAt !== 'string'
      || entry.package.length === 0 || entry.version.length === 0 || entry.reason.length === 0) {
      throw new Error('Each lockfile-age exception requires non-empty package, version, reason, and expiresAt fields.');
    }
    const expiresAt = new Date(entry.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error(`Lockfile-age exception ${entry.package}@${entry.version} has an invalid expiresAt.`);
    const key = `${entry.package}@${entry.version}`;
    if (exceptions.has(key)) throw new Error(`Duplicate lockfile-age exception for ${key}.`);
    exceptions.set(key, { ...entry, expiresAt });
  }
  return exceptions;
}

function validateExceptionEligibility(exception, publishedAt, eligibleAt, nowMs, locked) {
  if (exception.expiresAt.getTime() > eligibleAt.getTime()) {
    throw new Error(`exception expires ${exception.expiresAt.toISOString()}, after normal eligibility ${eligibleAt.toISOString()}`);
  }
  if (nowMs > exception.expiresAt.getTime()) {
    throw new Error(`exception expired ${exception.expiresAt.toISOString()}; published ${publishedAt.toISOString()}; eligible ${eligibleAt.toISOString()}`);
  }
  if (exception.package !== locked.name || exception.version !== locked.version) {
    throw new Error(`exception does not exactly match ${locked.name}@${locked.version}`);
  }
}

function collectLockedRegistryPackages(lockfile) {
  const lockedPackages = [];
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue;
    if (entry?.link === true || (typeof entry?.resolved === 'string' && entry.resolved.startsWith('file:'))) continue;

    const name = entry?.name ?? packageNameFromLockfilePath(path);
    if (typeof name !== 'string' || typeof entry?.version !== 'string') {
      throw new Error(`Locked package at ${path} is missing a package name or version.`);
    }
    validateRegistryMetadata(path, entry);
    lockedPackages.push({ name, version: entry.version, path, resolved: entry.resolved, integrity: entry.integrity });
  }
  return lockedPackages;
}

function groupByPackageVersion(packages) {
  const groups = new Map();
  for (const entry of packages) {
    const key = `${entry.name}@${entry.version}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

function validateRegistryMetadata(path, entry) {
  let resolved;
  try {
    resolved = new URL(entry.resolved);
  } catch {
    throw new Error(`Locked package at ${path} has an invalid resolved URL.`);
  }
  if (resolved.origin !== REGISTRY_ORIGIN || resolved.protocol !== 'https:') {
    throw new Error(`Locked package at ${path} has an unexpected resolved URL origin: ${entry.resolved}`);
  }
  if (typeof entry.integrity !== 'string' || !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)) {
    throw new Error(`Locked package at ${path} has missing or invalid integrity metadata.`);
  }
}

async function fetchPackument(name, fetchImpl, options) {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${REGISTRY_ORIGIN}/${encodeURIComponent(name)}`;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response?.ok) throw new Error(`registry returned HTTP ${response?.status ?? 'unknown'}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`registry fetch failed after ${retries + 1} attempts: ${lastError?.message ?? 'unknown error'}`);
}

function validateAuthoritativeDist(packument, locked) {
  const dist = packument?.versions?.[locked.version]?.dist;
  if (!dist || typeof dist.tarball !== 'string' || typeof dist.integrity !== 'string') {
    throw new Error(`registry packument is missing dist metadata for ${locked.name}@${locked.version}`);
  }
  if (!/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(dist.integrity)) {
    throw new Error(`registry packument has invalid dist integrity for ${locked.name}@${locked.version}`);
  }
  if (normalizeTarballUrl(locked.resolved) !== normalizeTarballUrl(dist.tarball)) {
    throw new Error(`locked tarball does not match registry dist.tarball for ${locked.name}@${locked.version}`);
  }
  if (locked.integrity !== dist.integrity) {
    throw new Error(`locked integrity does not match registry dist.integrity for ${locked.name}@${locked.version}`);
  }
}

function normalizeTarballUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid tarball URL: ${value}`);
  }
  if (url.origin !== REGISTRY_ORIGIN || url.protocol !== 'https:') {
    throw new Error(`unexpected tarball URL origin: ${value}`);
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new Error(`invalid tarball URL encoding: ${value}`);
  }
  return `${url.origin}${pathname}${url.search}`;
}

function parsePublicationTime(packument, locked) {
  const value = packument?.time?.[locked.version];
  const timestamp = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(timestamp.getTime())) throw new Error('has a missing or invalid npm publication timestamp');
  return timestamp;
}

function parseMinimumReleaseAge(npmrc) {
  const match = npmrc.match(/^\s*min-release-age\s*=\s*(\d+)\s*$/m);
  if (!match) throw new Error('.npmrc must define a non-negative min-release-age.');
  return Number(match[1]);
}

function packageNameFromLockfilePath(path) {
  const packagePath = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = packagePath.split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

async function mapWithConcurrency(items, limit, worker) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency must be a positive integer.');
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  }));
}

async function main() {
  try {
    const lockfile = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8'));
    const npmrc = readFileSync(resolve(process.cwd(), '.npmrc'), 'utf8');
    const exceptions = JSON.parse(readFileSync(resolve(process.cwd(), DEFAULT_EXCEPTION_POLICY), 'utf8'));
    const result = await validateLockfileAge(lockfile, npmrc, { exceptions });
    process.stdout.write(`Lockfile release-age validation passed (${result.packagesChecked} packages, ${result.minimumAgeDays}-day minimum).\n`);
    if (result.expiredExceptions.length > 0) {
      process.stdout.write(
        `${result.expiredExceptions.length} lockfile-age exception(s) have expired and can be pruned: `
        + `${result.expiredExceptions.join(', ')}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { collectLockedRegistryPackages, parseMinimumReleaseAge, validateLockfileAge };

if (require.main === module) void main();
