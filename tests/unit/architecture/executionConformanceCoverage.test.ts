import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Which backends the shared conformance suite actually covers, and why the rest
 * need no file of their own.
 *
 * `defineExecutionBackendConformance` drives a backend through the lifecycle
 * registry — cancellation before dispatch, the output bound, the result commit,
 * a delivery for a session nobody opened, a delivery after the terminal. It is
 * the one suite that exercises a provider in the composition rather than in
 * isolation, and **five of the nine providers have a driver for it**.
 *
 * Counting that as "four uncovered" is wrong, and counting it as "covered
 * because they are all ACP" is worse. Six providers extend the shared managed
 * ACP backend with a body that is a constructor handing it a descriptor, so
 * OpenCode's and Grok's drivers exercise every line the other four would — and the argument holds exactly as long as that stays true. This
 * gate is that condition: a wrapper that grows a method stops being covered by
 * its sibling, and says so here rather than in a review months later.
 */

const PROVIDERS_ROOT = resolve(process.cwd(), 'src/providers');
const PROVIDER_TESTS_ROOT = resolve(process.cwd(), 'tests/unit/providers');

/** The wrapper body the shared coverage argument rests on, and nothing else. */
const DESCRIPTOR_ONLY_WRAPPER =
  /export class \w+ExecutionBackend extends ManagedAcpExecutionBackend \{\s*constructor\(\s*context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'>,?\s*\) \{\s*super\(\{ \.\.\.context, descriptor: \w+ \}\);\s*\}\s*\}/;

interface ProviderBackend {
  readonly providerId: string;
  readonly file: string;
  readonly source: string;
  readonly managedAcp: boolean;
}

function readProviderBackends(): ProviderBackend[] {
  return readdirSync(PROVIDERS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    // `acp` is the shared transport's home rather than a provider: the class
    // the wrappers extend lives there, and it is what their drivers drive.
    .filter(entry => entry.name !== 'acp' && entry.name !== 'shared')
    .flatMap(entry => {
      const executionRoot = join(PROVIDERS_ROOT, entry.name, 'execution');
      if (!existsSync(executionRoot)) {
        return [];
      }
      return readdirSync(executionRoot)
        .filter(file => /ExecutionBackend\.ts$/.test(file))
        .map(file => {
          const path = join(executionRoot, file);
          const source = readFileSync(path, 'utf8');
          return {
            providerId: entry.name,
            file: relative(process.cwd(), path),
            source,
            managedAcp: /extends ManagedAcpExecutionBackend/.test(source),
          };
        });
    });
}

/** The providers that call `defineExecutionBackendConformance` for themselves. */
function providersWithDrivers(): string[] {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
  return readdirSync(PROVIDER_TESTS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => walk(join(PROVIDER_TESTS_ROOT, entry.name)).some(file => (
      readFileSync(file, 'utf8').includes('defineExecutionBackendConformance(')
    )))
    .map(entry => entry.name)
    .sort();
}

describe('execution backend conformance coverage', () => {
  const backends = readProviderBackends();
  const drivers = providersWithDrivers();

  it('finds a backend for every provider, so the rules below read something', () => {
    // The guard this file needs for the reason every gate here needs one: a
    // walk that matched nothing would report perfect coverage.
    expect(backends).toHaveLength(9);
    expect(drivers.length).toBeGreaterThan(0);
  });

  it('drives every backend that has behaviour of its own through the registry', () => {
    const uncovered = backends
      .filter(backend => !backend.managedAcp && !drivers.includes(backend.providerId))
      .map(backend => backend.providerId);

    // Antigravity, Claude and Codex each own a process topology and each has a
    // driver. A fourth backend written from scratch has to bring one.
    expect(uncovered).toEqual([]);
  });

  it('keeps a managed-ACP wrapper to the descriptor its sibling proves for it', () => {
    const withBodies = backends
      .filter(backend => backend.managedAcp)
      .filter(backend => !DESCRIPTOR_ONLY_WRAPPER.test(backend.source))
      .map(backend => backend.file);

    // The whole shared-coverage argument, as a condition rather than a claim.
    expect(withBodies).toEqual([]);
  });

  it('has at least one driver for the shared managed-ACP backend itself', () => {
    const managed = backends.filter(backend => backend.managedAcp).map(b => b.providerId);
    const managedWithDrivers = managed.filter(providerId => drivers.includes(providerId));

    // Six wrappers, and the rule above says they are interchangeable — which is
    // only worth anything if at least one of them is actually driven.
    expect(managed.length).toBeGreaterThan(1);
    expect(managedWithDrivers.length).toBeGreaterThan(0);
  });
});
