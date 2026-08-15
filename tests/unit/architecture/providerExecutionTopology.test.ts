import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROVIDER_EXECUTION_TOPOLOGY } from '@test/fixtures/providerExecutionTopology';

/**
 * Validates the per-provider topology and shared-resource inventory.
 *
 * The M2 flip's auxiliary-contention check runs against this fixture, so a row
 * that quietly stops matching the code would turn that check into theater.
 * Claims that can be verified cheaply are verified here; the rest are anchored
 * to the modules they were read from, which at least fail when those modules
 * move.
 */
describe('provider execution topology', () => {
  const byId = new Map(PROVIDER_EXECUTION_TOPOLOGY.map(record => [record.providerId, record]));

  /** The providers the registration hub actually attaches, read from the hub itself. */
  const registeredProviderIds = [
    ...readFileSync(resolve(process.cwd(), 'src/providers/index.ts'), 'utf8').matchAll(
      /ProviderRegistry\.register\('([^']+)'/g,
    ),
  ].map(match => match[1]);

  it('covers every registered provider exactly once', () => {
    expect([...byId.keys()].sort()).toEqual([...registeredProviderIds].sort());
    expect(PROVIDER_EXECUTION_TOPOLOGY).toHaveLength(registeredProviderIds.length);
  });

  it.each(PROVIDER_EXECUTION_TOPOLOGY)('$providerId cites modules that exist', record => {
    const missing = [record.auxiliaryOwner, ...record.evidence].filter(
      module => !existsSync(resolve(process.cwd(), module)),
    );

    expect(missing).toEqual([]);
  });

  it.each(PROVIDER_EXECUTION_TOPOLOGY)(
    '$providerId declares no contended resource between the chat and auxiliary paths',
    record => {
      // A contended entry is a stop condition for that provider's flip. It is
      // legal to record one — it is not legal to flip while it stands.
      const contended = record.sharedResources.filter(entry => entry.sharing === 'contended');

      expect(contended).toEqual([]);
    },
  );

  it.each(PROVIDER_EXECUTION_TOPOLOGY)('$providerId lists at least one shared resource', record => {
    // "Nothing is shared" is almost always an unexamined claim. Providers with
    // no auxiliary execution say so explicitly instead of leaving the list empty.
    expect(record.sharedResources.length).toBeGreaterThan(0);
  });

  describe('auxiliary isolation matches the code', () => {
    it.each(PROVIDER_EXECUTION_TOPOLOGY.filter(record => record.auxiliary === 'noop'))(
      '$providerId registers no-op auxiliary services',
      record => {
        const source = readFileSync(resolve(process.cwd(), record.auxiliaryOwner), 'utf8');

        expect(record.auxiliaryOwner).toContain('NoopServices');
        expect(source).toMatch(/TitleGenerationService/);
      },
    );

    it.each(PROVIDER_EXECUTION_TOPOLOGY.filter(record => record.auxiliary === 'isolated'))(
      '$providerId runs auxiliary work on its own process or session',
      record => {
        const source = readFileSync(resolve(process.cwd(), record.auxiliaryOwner), 'utf8');

        // Each isolated owner establishes its own transport, process, or cold
        // query rather than reaching into the chat runtime.
        expect(source).toMatch(/private (process|transport|connection)|persistSession|createRunner|options\./);
        expect(source).not.toMatch(/ChatRuntime/);
      },
    );
  });

  describe('the rendered document agrees with the fixture', () => {
    const document = readFileSync(
      resolve(process.cwd(), 'docs/provider-capability-topology.md'),
      'utf8',
    );

    it.each(PROVIDER_EXECUTION_TOPOLOGY)('$providerId appears with its auxiliary owner', record => {
      const ownerBasename = record.auxiliaryOwner.split('/').pop() as string;

      expect(document).toContain(ownerBasename);
    });

    it('names the fixture as the source of truth', () => {
      expect(document).toContain('tests/fixtures/providerExecutionTopology.ts');
    });
  });

  describe('managed-ACP artifact partitioning', () => {
    const managedAcpWithAuxiliary = PROVIDER_EXECUTION_TOPOLOGY.filter(
      record => record.topology === 'managed-acp-subprocess' && record.auxiliary === 'isolated',
    );

    it.each(managedAcpWithAuxiliary)(
      '$providerId writes auxiliary artifacts to a separate subdirectory',
      record => {
        const source = readFileSync(resolve(process.cwd(), record.auxiliaryOwner), 'utf8');

        expect(source).toContain(`${record.providerId}/auxiliary/`);
      },
    );
  });
});
