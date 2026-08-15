import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { PARITY_SURFACES } from './presentationParityManifest';

/**
 * Asserts that dark migration code is absent from the built bundle.
 *
 * This replaces a check that measured nothing. Earlier checkpoints claimed the
 * release build produced "byte-identical artifacts" on the evidence of
 * `git status main.js` — but `main.js` is listed in `.gitignore`, so that
 * command reports clean no matter what the file contains. A gate that cannot
 * fail is exactly the shape of failure this migration exists to prevent, and it
 * appeared in the migration's own evidence.
 *
 * The bundle is a build artifact, so this suite skips when it is absent or
 * older than the sources it is meant to describe. Run `npm run build:release`
 * before trusting it; the release build itself is where the check belongs at
 * flip checkpoints.
 */

const BUNDLE_PATH = 'main.js';

/** Strings that appear in the bundle only if a dark module was pulled into it. */
const DARK_MARKERS = [
  { marker: '.grimoire/control', why: 'durable control store paths' },
  { marker: 'execution-runs', why: 'control record directory' },
  { marker: 'transaction-intents', why: 'transaction intent directory' },
  { marker: 'Expected current control record', why: 'lifecycle registry internals' },
  { marker: 'Execution owner kind is invalid', why: 'lifecycle registry validation' },
  { marker: 'provider-antigravity', why: 'the Antigravity execution backend descriptor' },
  { marker: 'provider-codex', why: 'the Codex execution backend descriptor' },
  { marker: 'Codex execution connection is not initialized', why: 'the Codex execution connection' },
  { marker: 'provider-claude', why: 'the Claude execution backend descriptor' },
  { marker: 'provider-opencode', why: 'the OpenCode execution backend descriptor' },
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
