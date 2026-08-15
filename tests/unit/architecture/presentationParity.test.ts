import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { findReachableModules, findUnreachableModules } from '@test/helpers/moduleReachability';

import {
  ORPHANED_MODULES,
  PARITY_SURFACES,
} from './presentationParityManifest';

/**
 * The parity gate.
 *
 * It fails in both directions on purpose. A wired surface that drops out of
 * the bundle fails, so the product cannot be quietly disassembled the way the
 * v1 cutover disassembled it. An orphan that comes back, or a pending surface
 * that becomes reachable, also fails, so progress has to be recorded in the
 * manifest rather than assumed.
 */
describe('presentation parity', () => {
  const reachable = findReachableModules();
  const unreachable = new Set(findUnreachableModules());

  const manifestModules = PARITY_SURFACES.flatMap(surface => surface.modules);
  const orphanModules = ORPHANED_MODULES.map(record => record.module);

  it('lists only modules that exist', () => {
    const missing = [...manifestModules, ...orphanModules].filter(
      module => !existsSync(resolve(process.cwd(), module)),
    );

    expect(missing).toEqual([]);
  });

  it('uses unique surface ids and claims each module once', () => {
    const ids = PARITY_SURFACES.map(surface => surface.id);
    expect(ids).toEqual([...new Set(ids)]);

    const duplicated = manifestModules.filter(
      (module, index) => manifestModules.indexOf(module) !== index,
    );
    expect(duplicated).toEqual([]);
  });

  it('requires an owner for every surface that is not wired', () => {
    const unowned = PARITY_SURFACES.filter(
      surface => surface.state !== 'wired' && !surface.owner,
    ).map(surface => surface.id);

    expect(unowned).toEqual([]);
  });

  it('keeps every wired surface reachable from the production entry point', () => {
    const dropped = PARITY_SURFACES.filter(surface => surface.state === 'wired').flatMap(surface =>
      surface.modules.filter(module => !reachable.has(module)).map(module => `${surface.id}: ${module}`),
    );

    expect(dropped).toEqual([]);
  });

  it('keeps every pending and intentionally-removed surface out of the bundle', () => {
    const restored = PARITY_SURFACES.filter(surface => surface.state !== 'wired').flatMap(surface =>
      surface.modules.filter(module => reachable.has(module)).map(module => `${surface.id}: ${module}`),
    );

    expect(restored).toEqual([]);
  });

  it('keeps every recorded orphan orphaned', () => {
    const restored = orphanModules.filter(module => !unreachable.has(module));

    expect(restored).toEqual([]);
  });

  it('attributes every unreachable module to a manifest entry', () => {
    const attributed = new Set([
      ...orphanModules,
      ...PARITY_SURFACES.filter(surface => surface.state !== 'wired').flatMap(
        surface => surface.modules,
      ),
    ]);
    const unattributed = [...unreachable].filter(module => !attributed.has(module)).sort();

    expect(unattributed).toEqual([]);
  });
});
