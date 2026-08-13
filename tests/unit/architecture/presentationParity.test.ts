import { readFileSync } from 'node:fs';

import {
  findReachableModules,
  findUnreachableModules,
  listAllSourceModules,
} from '@test/helpers/moduleReachability';

import {
  PRESENTATION_PARITY_MANIFEST,
  STUBBED_ENTRY_POINTS,
} from './presentationParityManifest';

/**
 * Presentation parity gate.
 *
 * The Phase 9 cutover satisfied every automated gate in this repository while
 * leaving most of the product surface unreachable from `src/main.ts`. Unit
 * tests could not detect it because they import modules directly rather than
 * through the entry point, so this suite asserts the import graph itself.
 *
 * Every assertion is bidirectional on purpose. A surface may not silently
 * regress, and it may not silently be repaired either: restoring one without
 * updating the manifest fails the build. That keeps the manifest an accurate
 * ledger of remaining Phase 12 work instead of a stale narrative.
 */

const allModules = listAllSourceModules();
const knownModules = new Set(allModules);
const reachableModules = findReachableModules();
const unreachableModules = findUnreachableModules();

const wiredSurfaces = PRESENTATION_PARITY_MANIFEST.filter(s => s.state === 'wired');
const pendingSurfaces = PRESENTATION_PARITY_MANIFEST.filter(s => s.state === 'pending');
const removedSurfaces = PRESENTATION_PARITY_MANIFEST.filter(s => s.state === 'intentionally-removed');
const surfacesWithModules = PRESENTATION_PARITY_MANIFEST.filter(s => s.modules.length > 0);

describe('manifest integrity', () => {
  it('declares unique surface identifiers', () => {
    const ids = PRESENTATION_PARITY_MANIFEST.map(surface => surface.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns an owning remediation phase to every pending surface', () => {
    const unowned = pendingSurfaces
      .filter(surface => surface.phase === undefined)
      .map(surface => surface.id);
    expect(unowned).toEqual([]);
  });

  it('claims each module at most once', () => {
    const claims = surfacesWithModules.flatMap(surface => surface.modules);
    const duplicates = claims.filter((module, index) => claims.indexOf(module) !== index);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it('names only modules that exist', () => {
    const missing = surfacesWithModules.flatMap(surface => surface.modules
      .filter(module => !knownModules.has(module))
      .map(module => `${surface.id}: ${module}`));
    expect(missing).toEqual([]);
  });
});

describe('surface states agree with the import graph', () => {
  it('keeps every wired surface reachable from the production entry point', () => {
    // Aggregated rather than per-surface so the suite stays valid while the
    // wired list is empty. Failures name the surface and the module.
    const orphaned = wiredSurfaces.flatMap(surface => surface.modules
      .filter(module => !reachableModules.has(module))
      .map(module => `${surface.id}: ${module}`));
    expect(orphaned).toEqual([]);
  });

  it('keeps every pending surface orphaned until the manifest is updated', () => {
    const restored = pendingSurfaces.flatMap(surface => surface.modules
      .filter(module => reachableModules.has(module))
      .map(module => `${surface.id}: ${module}`));
    expect(restored).toEqual([]);
  });

  it('leaves nothing in the tree for intentionally removed surfaces', () => {
    const surviving = removedSurfaces.flatMap(surface => surface.modules
      .filter(module => knownModules.has(module))
      .map(module => `${surface.id}: ${module}`));
    expect(surviving).toEqual([]);
  });
});

describe('no unaccounted orphans', () => {
  it('attributes every unreachable module to a manifest surface', () => {
    // The anti-regression rule. A newly orphaned module fails here until someone
    // decides whether it is a surface to restore or code to delete. Silent
    // orphaning is exactly what produced the Phase 9 regression.
    const claimed = new Set(surfacesWithModules.flatMap(surface => surface.modules));
    const unaccounted = unreachableModules.filter(module => !claimed.has(module));
    expect(unaccounted).toEqual([]);
  });
});

describe('stubbed production entry points', () => {
  // Reachability cannot see these: the call site exists, runs, and succeeds with
  // nothing. Each marker disappears when the stub is replaced.
  it.each(STUBBED_ENTRY_POINTS.map(stub => [`${stub.module} :: ${stub.symbol}`, stub] as const))(
    '%s is still stubbed; remove it from the ledger once it routes through the catalog',
    (_label, stub) => {
      expect(knownModules.has(stub.module)).toBe(true);
      const source = readFileSync(stub.module, 'utf8');
      expect(source).toContain(stub.marker);
    },
  );
});

describe('walker consistency', () => {
  it('partitions every source module into reachable or unreachable', () => {
    expect(reachableModules.size + unreachableModules.length).toBe(allModules.length);
  });

  it('resolves only modules that exist under src/', () => {
    const stray = [...reachableModules].filter(module => !knownModules.has(module));
    expect(stray).toEqual([]);
  });
});
