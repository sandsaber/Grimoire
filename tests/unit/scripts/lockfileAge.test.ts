const { collectLockedRegistryPackages, validateLockfileAge } = require('../../../scripts/check-lockfile-age.js');

const npmrc = 'min-release-age=7\n';
const now = new Date('2026-08-05T00:00:00.000Z');
const integrity = 'sha512-YWJjZA==';

function lock(entries: Record<string, Record<string, unknown>>) {
  return { lockfileVersion: 3, packages: { '': { name: 'fixture' }, ...entries } };
}

function registryEntry(name: string, version: string, overrides: Record<string, unknown> = {}) {
  const tarball = name.startsWith('@') ? `${name.slice(name.indexOf('/') + 1)}-${version}.tgz` : `${name}-${version}.tgz`;
  return { name, version, resolved: `https://registry.npmjs.org/${name}/-/${tarball}`, integrity, ...overrides };
}

function packumentFetch(times: Record<string, string>, name = 'example', distOverrides: Record<string, unknown> = {}) {
  return jest.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      time: times,
      versions: Object.fromEntries(Object.keys(times).map((version) => {
        const entry = registryEntry(name, version);
        return [version, { dist: { tarball: entry.resolved, integrity, ...distOverrides } }];
      })),
    }),
  }));
}

function exception(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    exceptions: [{
      package: 'example', version: '1.0.0', reason: 'Existing audited lockfile.', expiresAt: '2026-08-08T00:00:00.000Z', ...overrides,
    }],
  };
}

describe('lockfile release-age gate', () => {
  it('accepts a sufficiently old registry package', async () => {
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, {
      now,
      fetch: packumentFetch({ '1.0.0': '2026-07-01T00:00:00.000Z' }),
    })).resolves.toMatchObject({ packagesChecked: 1, minimumAgeDays: 7 });
  });

  it('rejects a version younger than the configured age', async () => {
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, {
      now,
      fetch: packumentFetch({ '1.0.0': '2026-08-01T00:00:00.000Z' }),
    })).rejects.toThrow('below the 7-day minimum');
  });

  it('accepts only an exact, temporary exception', async () => {
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, {
      now,
      exceptions: exception(),
      fetch: packumentFetch({ '1.0.0': '2026-08-01T00:00:00.000Z' }),
    })).resolves.toMatchObject({ packagesChecked: 1 });
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, {
      now,
      exceptions: exception({ version: '1.0.1' }),
      fetch: packumentFetch({ '1.0.0': '2026-08-01T00:00:00.000Z' }),
    })).rejects.toThrow('published 2026-08-01T00:00:00.000Z; eligible 2026-08-08T00:00:00.000Z');
  });

  it('rejects overlong and expired exceptions', async () => {
    const fixture = lock({ 'node_modules/example': registryEntry('example', '1.0.0') });
    const fetch = packumentFetch({ '1.0.0': '2026-08-01T00:00:00.000Z' });
    await expect(validateLockfileAge(fixture, npmrc, {
      now, fetch, exceptions: exception({ expiresAt: '2026-08-09T00:00:00.000Z' }),
    })).rejects.toThrow('after normal eligibility');
    await expect(validateLockfileAge(fixture, npmrc, {
      now: new Date('2026-08-07T00:00:00.000Z'), fetch, exceptions: exception({ expiresAt: '2026-08-06T00:00:00.000Z' }),
    })).rejects.toThrow('exception expired');
  });

  it('rejects malformed and duplicate exception policies', async () => {
    const fixture = lock({ 'node_modules/example': registryEntry('example', '1.0.0') });
    await expect(validateLockfileAge(fixture, npmrc, { now, exceptions: { version: 1, exceptions: [{}] } })).rejects.toThrow('requires non-empty');
    await expect(validateLockfileAge(fixture, npmrc, {
      now,
      exceptions: { version: 1, exceptions: [...exception().exceptions, ...exception().exceptions] },
    })).rejects.toThrow('Duplicate lockfile-age exception');
  });

  it('rejects missing publication timestamps and registry failures', async () => {
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, {
      now,
      retries: 0,
      fetch: jest.fn(async () => ({
        ok: true, status: 200, json: async () => ({
          time: {},
          versions: { '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', integrity } } },
        }),
      })),
    })).rejects.toThrow('missing or invalid npm publication timestamp');
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, {
      now, retries: 0, fetch: jest.fn(async () => { throw new Error('offline'); }),
    })).rejects.toThrow('registry fetch failed');
  });

  it('accepts scoped alias tarballs and deduplicates package/version fetches', async () => {
    const fetch = packumentFetch({ '2.0.0': '2026-07-01T00:00:00.000Z' });
    const fixture = lock({
      'node_modules/first': registryEntry('@scope/real-package', '2.0.0'),
      'node_modules/second': registryEntry('@scope/real-package', '2.0.0'),
    });
    expect(collectLockedRegistryPackages(fixture)).toHaveLength(2);
    fetch.mockImplementation(async () => ({
      ok: true, status: 200, json: async () => ({
        time: { '2.0.0': '2026-07-01T00:00:00.000Z' },
        versions: { '2.0.0': { dist: { tarball: 'https://registry.npmjs.org/@scope/real-package/-/real-package-2.0.0.tgz', integrity } } },
      }),
    }));
    await expect(validateLockfileAge(fixture, npmrc, { now, fetch })).resolves.toMatchObject({ packagesChecked: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://registry.npmjs.org/%40scope%2Freal-package');
  });

  it('rejects unexpected registry origins or integrity metadata before fetching', () => {
    expect(() => collectLockedRegistryPackages(lock({
      'node_modules/example': registryEntry('example', '1.0.0', { resolved: 'https://evil.example/example.tgz' }),
    }))).toThrow('unexpected resolved URL origin');
    expect(() => collectLockedRegistryPackages(lock({
      'node_modules/example': registryEntry('example', '1.0.0', { integrity: 'invalid' }),
    }))).toThrow('missing or invalid integrity metadata');
  });

  it('rejects same-registry tarball and valid integrity mismatches', async () => {
    const fixture = lock({ 'node_modules/example': registryEntry('example', '1.0.0') });
    await expect(validateLockfileAge(fixture, npmrc, {
      now,
      fetch: packumentFetch({ '1.0.0': '2026-07-01T00:00:00.000Z' }, 'example', { tarball: 'https://registry.npmjs.org/example/-/other.tgz' }),
    })).rejects.toThrow('does not match registry dist.tarball');
    await expect(validateLockfileAge(fixture, npmrc, {
      now,
      fetch: packumentFetch({ '1.0.0': '2026-07-01T00:00:00.000Z' }, 'example', { integrity: 'sha512-ZGlmZmVyZW50' }),
    })).rejects.toThrow('does not match registry dist.integrity');
  });

  it('rejects missing dist metadata and divergent duplicate lock entries', async () => {
    const missingDist = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ time: { '1.0.0': '2026-07-01T00:00:00.000Z' }, versions: { '1.0.0': {} } }) }));
    await expect(validateLockfileAge(lock({ 'node_modules/example': registryEntry('example', '1.0.0') }), npmrc, { now, fetch: missingDist })).rejects.toThrow('missing dist metadata');
    const duplicate = lock({
      'node_modules/one': registryEntry('example', '1.0.0'),
      'node_modules/two': registryEntry('example', '1.0.0', { integrity: 'sha512-ZGlmZmVyZW50' }),
    });
    await expect(validateLockfileAge(duplicate, npmrc, {
      now, fetch: packumentFetch({ '1.0.0': '2026-07-01T00:00:00.000Z' }),
    })).rejects.toThrow('does not match registry dist.integrity');
  });

  it('reports an expired exception as prunable rather than keeping it forever', async () => {
    // A waiver that has expired waives nothing: the package it covered is
    // either old enough now or already failing on its own. Forty-two of them
    // accumulated in the repository before anyone noticed, because nothing
    // said so — the gate passed and said only that it passed.
    const result = await validateLockfileAge(
      lock({ 'node_modules/example': registryEntry('example', '1.0.0') }),
      npmrc,
      {
        now,
        fetch: packumentFetch({ '1.0.0': '2026-07-01T00:00:00.000Z' }),
        exceptions: exception({ expiresAt: '2026-08-01T00:00:00.000Z' }),
      },
    );

    expect(result.expiredExceptions).toEqual(['example@1.0.0']);
  });

});
