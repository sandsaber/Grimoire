import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findReachableModules } from '@test/helpers/moduleReachability';

/**
 * Arms the persistence decisions before the code they govern exists.
 *
 * The durable control store reaches production at the first M2 flip, not at
 * M4, so the rules about where it lives, what may go in it, and how a revert
 * behaves have to be enforceable from now rather than written afterwards about
 * data users already have.
 *
 * Decisions: `docs/provider-execution-persistence-decisions.md`.
 */

const DECISIONS_PATH = 'docs/provider-execution-persistence-decisions.md';
const CONTROL_STORE_PATH = '.grimoire/control/';

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('persistence decisions', () => {
  const decisions = read(DECISIONS_PATH);

  it('names one location for the control store', () => {
    expect(decisions).toContain(CONTROL_STORE_PATH);
  });

  it.each([
    'secrets',
    'hidden reasoning',
    'environment digest inputs',
    'arbitrary raw protocol payloads',
    'Local shell output',
  ])('forbids persisting %s', forbidden => {
    expect(decisions.toLowerCase()).toContain(forbidden.toLowerCase());
  });

  it('states the schema-version rule for unknown future records', () => {
    expect(decisions).toContain('schemaVersion');
    expect(decisions).toContain('unknown future');
    expect(decisions).toContain('read-only');
    expect(decisions).toContain('migration-required');
  });

  describe('coupling to the code', () => {
    // These pass trivially today because the control store does not exist yet.
    // That is the point: they fire the moment it does, at the checkpoint where
    // forgetting them is easiest.
    const sourceModules = [...findReachableModules()];

    /**
     * Matches the literal path and the constant that composes it.
     *
     * The first version of this guard looked only for the literal string, which
     * made it blind the moment the paths were assembled from
     * `GRIMOIRE_CONTROL_PATH` — exactly how they are actually written.
     */
    const CONTROL_STORE_REFERENCE = /\.grimoire\/control|GRIMOIRE_CONTROL_PATH|EXECUTION_(RUNS|SESSIONS|INTERACTIONS|RECONCILIATIONS)_PATH/;

    function modulesMentioningControlStore(filter: (module: string) => boolean): string[] {
      return sourceModules
        .filter(filter)
        .filter(module => CONTROL_STORE_REFERENCE.test(read(module)));
    }

    it('documents the control store in the storage boundary table once code writes to it', () => {
      const writesControlStore = modulesMentioningControlStore(() => true);
      if (writesControlStore.length === 0) {
        return;
      }

      expect(read('AGENTS.md')).toContain(CONTROL_STORE_PATH.replace(/\/$/, ''));
    });

    it('keeps the control store unreadable to the legacy runtime path', () => {
      // Revert safety: a release that reverts a flip must not break on the
      // presence of these files, which holds only while the old path never
      // reads them.
      const legacyReaders = modulesMentioningControlStore(
        module => module.startsWith('src/core/runtime/') || module.endsWith('ChatRuntime.ts'),
      );

      expect(legacyReaders).toEqual([]);
    });
  });
});
