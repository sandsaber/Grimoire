import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { PARITY_SURFACES } from './presentationParityManifest';

/**
 * Asserts what the built bundle does and does not contain, in both directions.
 *
 * It began as an absence-only check, and that was right while the whole kernel
 * was dark. The first provider flip ends that: the kernel, its control store,
 * the presentation adapter, and one provider's backend are now production code,
 * and the rest is still dark. So the gate now names both — a flip that silently
 * failed to reach the bundle fails here just as loudly as a dark module that
 * leaked into it.
 *
 * It replaces an earlier check that measured nothing. Checkpoints claimed the
 * release build produced "byte-identical artifacts" on the evidence of
 * `git status main.js` — but `main.js` is listed in `.gitignore`, so that
 * command reports clean no matter what the file contains.
 *
 * The bundle is a build artifact, so this suite skips when it is absent or
 * older than the sources it is meant to describe. Run `npm run build:release`
 * before trusting it; the release build itself is where the check belongs at
 * flip checkpoints.
 */

const BUNDLE_PATH = 'main.js';

/**
 * Strings the first flip put into the bundle, and must keep there.
 *
 * Every one is a literal that survives bundling. A composed path is not: the
 * original list opened with `.grimoire/control`, which the control-path module
 * builds by template from the shared storage root, so no such literal has ever
 * existed in the bundle and that marker could never have fired — in either
 * direction. Its two composed children below are real literals, which is why
 * they are the ones kept.
 */
const LIVE_MARKERS = [
  { marker: 'execution-runs', why: 'the control record directory' },
  { marker: 'transaction-intents', why: 'the transaction intent directory' },
  { marker: 'Expected current control record', why: 'the lifecycle registry' },
  { marker: 'Execution owner kind is invalid', why: 'lifecycle registry validation' },
  { marker: 'Execution lifecycle registry is not accepting shutdown', why: 'the kernel host' },
  { marker: 'provider-antigravity', why: 'the flipped Antigravity execution backend' },
  { marker: 'provider-codex', why: 'the flipped Codex execution backend' },
  {
    marker: 'Codex execution connection is not initialized',
    why: 'the Codex execution connection the flipped backend speaks through',
  },
  {
    marker: 'The provider ended the turn without producing a result',
    why: 'the presentation adapter',
  },
];

/** Strings that appear in the bundle only if a still-dark module was pulled in. */
const DARK_MARKERS = [
  { marker: 'provider-claude', why: 'the Claude execution backend descriptor' },
  { marker: 'provider-opencode', why: 'the OpenCode execution backend descriptor' },
  { marker: 'internal-deterministic-fake', why: 'the test-only fake backend' },
];

function readBundle(): string | null {
  const path = resolve(process.cwd(), BUNDLE_PATH);
  if (!existsSync(path)) {
    return null;
  }
  const bundleAge = statSync(path).mtimeMs;
  const newestSource = statSync(resolve(process.cwd(), 'src/main.ts')).mtimeMs;
  return bundleAge >= newestSource ? readFileSync(path, 'utf8') : null;
}

describe('dark code stays out of the shipped bundle', () => {
  const bundle = readBundle();

  it.each(LIVE_MARKERS)('the bundle contains $why', ({ marker }) => {
    if (bundle === null) {
      return;
    }

    expect(bundle).toContain(marker);
  });

  it.each(DARK_MARKERS)('the bundle contains no $why', ({ marker }) => {
    if (bundle === null) {
      // No stale verdict: an absent or outdated bundle proves nothing either
      // way, and pretending otherwise is how the previous check went wrong.
      return;
    }

    expect(bundle).not.toContain(marker);
  });

  it('keeps every pending surface out of the bundle by module basename', () => {
    if (bundle === null) {
      return;
    }

    // esbuild strips paths, but class and function names survive, so a module
    // that got pulled in leaves its identifiers behind.
    const pendingIdentifiers = PARITY_SURFACES
      .filter(surface => surface.state === 'pending')
      .flatMap(surface => surface.modules)
      .map(module => (module.split('/').pop() as string).replace(/\.ts$/, ''))
      .filter(name => /^[A-Z]/.test(name));

    const leaked = pendingIdentifiers.filter(name => bundle.includes(`class ${name}`));

    expect(leaked).toEqual([]);
  });
});
