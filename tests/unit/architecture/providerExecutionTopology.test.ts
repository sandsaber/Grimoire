import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

        // The evidence is a literal string the record names, not a permissive
        // pattern: a broad alternation matches almost any file and would turn
        // this assertion into decoration.
        expect(source).toContain(record.isolationEvidence);
        expect(source).not.toMatch(/ChatRuntime/);
      },
    );

    it.each(PROVIDER_EXECUTION_TOPOLOGY.filter(record => record.auxiliary === 'kernel-isolated'))(
      '$providerId builds its auxiliary launch separately from the chat one',
      record => {
        const source = readFileSync(resolve(process.cwd(), record.auxiliaryOwner), 'utf8');

        // The owner here serves both paths, so "not the chat runtime" proves
        // nothing — what proves the isolation is that the auxiliary launch is
        // built separately. **What that looks like is the provider's**, and the
        // record says so: the ACP compositions are proven by the client factory
        // the auxiliary path is wired to, and Codex — which has no such factory
        // and no filesystem delegate — by the parameters its thread is started
        // with. Asserting one shape for all of them would have made this vacuous
        // for the first provider that did not share it.
        expect(source).toContain(record.isolationEvidence);
        // Guards the guard: a record with no wiring would pass every assertion
        // below by having none to fail.
        expect(record.auxiliaryWiring?.length ?? 0).toBeGreaterThan(0);
        for (const line of record.auxiliaryWiring ?? []) {
          expect(source).toContain(line);
        }
      },
    );

    it.each(PROVIDER_EXECUTION_TOPOLOGY)(
      '$providerId names isolation evidence that is specific, not generic',
      record => {
        // Guards the guard: an evidence string short enough to appear anywhere
        // proves nothing.
        expect(record.isolationEvidence.length).toBeGreaterThanOrEqual(10);
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

    it.each(PROVIDER_EXECUTION_TOPOLOGY)(
      '$providerId topology, session boundary, and resume are rendered as recorded',
      record => {
        // A basename match alone would let the topology table say anything.
        // These are the columns a reader would act on, so they are compared.
        const readable: Record<string, string> = {
          'process-per-run': 'process per run',
          'persistent-daemon': 'persistent daemon',
          'persistent-sdk-stream': 'persistent SDK stream',
          'managed-acp-subprocess': 'managed ACP subprocess',
          none: 'none',
          'native-thread': 'native thread',
          'native-sdk-session': 'native SDK session',
          'acp-session': 'ACP session',
          native: 'native',
          reconstructed: 'reconstructed',
        };

        const row = document
          .split('\n')
          .find(
            line =>
              line.startsWith('|') &&
              line.includes(readable[record.topology]) &&
              line.includes(record.concurrency),
          );

        expect(row).toBeDefined();
        expect(row).toContain(readable[record.sessionBoundary]);
        expect(row).toContain(readable[record.resume]);
      },
    );

    it('points the smoke matrix at one capability record', () => {
      expect(document).toContain('capabilities.ts');
      expect(PROVIDER_EXECUTION_TOPOLOGY.every(record => record.capabilities !== undefined)).toBe(
        true,
      );
    });

    it('names the fixture as the source of truth', () => {
      expect(document).toContain('tests/fixtures/providerExecutionTopology.ts');
    });
  });

  describe('trace fixtures agree with this record', () => {
    /**
     * The per-provider trace fixtures carry a header describing the topology
     * they were captured against, and until now nothing read it. Both existing
     * headers had drifted into private vocabularies — `per-run-process` and
     * `persistent-app-server` against this record's `process-per-run` and
     * `persistent-daemon` — so a fixture could claim any topology at all. That
     * matters at the semantic freeze, which uses these fixtures as the anchor
     * for what each topology is allowed to do.
     */
    const TRACE_DIRECTORY = 'tests/fixtures/provider-traces';

    const traces = readdirSync(resolve(process.cwd(), TRACE_DIRECTORY))
      .filter(entry => entry.endsWith('-execution.json'))
      .map(entry => ({
        file: `${TRACE_DIRECTORY}/${entry}`,
        header: JSON.parse(
          readFileSync(resolve(process.cwd(), TRACE_DIRECTORY, entry), 'utf8'),
        ) as Record<string, unknown>,
      }));

    it('has at least one trace to check', () => {
      // Guards the guard: an empty directory would make every case below vacuous.
      expect(traces.length).toBeGreaterThan(0);
    });

    it.each(traces)('$file matches the topology record', ({ header }) => {
      const record = byId.get(header.providerId as string);

      expect(record).toBeDefined();
      expect(header.backendId).toBe(`provider-${header.providerId as string}`);
      expect(header.topology).toBe(record?.topology);
      expect(header.sessionBoundary).toBe(record?.sessionBoundary);
      expect(header.resume).toBe(record?.resume);
    });

    it('has a trace for every provider with an execution backend', () => {
      // A proof without its trace is a proof that cannot be replayed.
      const proven = PROVIDER_EXECUTION_TOPOLOGY
        .map(record => record.providerId)
        .filter(providerId => existsSync(resolve(
          process.cwd(),
          `src/providers/${providerId}/execution`,
        )));
      const traced = traces.map(trace => trace.header.providerId as string);

      expect(proven.filter(providerId => !traced.includes(providerId))).toEqual([]);
    });
  });

  describe('managed-ACP artifact partitioning', () => {
    // Both isolations, because the partitioning is the same claim either way:
    // an auxiliary launch writes its artifacts somewhere the chat launch does
    // not. Filtering to `isolated` alone emptied this table the moment the last
    // managed-ACP runner was deleted, and an empty `.each` is not a passing
    // guard — it is no guard.
    const managedAcpWithAuxiliary = PROVIDER_EXECUTION_TOPOLOGY.filter(
      record => record.topology === 'managed-acp-subprocess'
        && (record.auxiliary === 'isolated' || record.auxiliary === 'kernel-isolated'),
    );

    it('has a provider to check', () => {
      expect(managedAcpWithAuxiliary.length).toBeGreaterThan(0);
    });

    it.each(managedAcpWithAuxiliary)(
      '$providerId writes auxiliary artifacts to a separate subdirectory',
      record => {
        const source = readFileSync(resolve(process.cwd(), record.auxiliaryOwner), 'utf8');

        expect(source).toContain(`${record.providerId}/auxiliary/`);
      },
    );
  });
});
