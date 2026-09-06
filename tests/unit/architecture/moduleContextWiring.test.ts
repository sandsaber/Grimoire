import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const PROVIDERS_ROOT = resolve(process.cwd(), 'src/providers');

/**
 * How much of each provider's module context is real.
 *
 * Down from ten-to-twelve stubs per provider to at most one, and the one that
 * remains is not wiring: `listSessionCommands` faces a slot taking a session id
 * while the real loader takes a runtime, and closes with that row's reshape.
 *
 * `renderSettingsTab` used to be counted beside it, recorded as blocked because
 * the slot types its host as `unknown` while the real renderer takes a
 * container *and* a context. Codex had already answered that: `unknown` is what
 * lets a provider pass `{ container, context }` through a contract that must
 * learn no DOM vocabulary, and unpack it on its own side. The other eight now
 * do the same, and Antigravity — which had no such slot — declares one. What
 * still blocks the *row* is its consumers: both are synchronous render paths
 * and the workspace lookup is asynchronous, and one of them post-processes the
 * DOM it just drew.
 *
 * `ProviderModule` says a provider's workspace slots are filled by
 * `workspace.initialize(context)`, and all nine modules fill them. What the
 * slot-fit audit missed on its first pass is that **eight of nine fill them
 * from a context whose workspace half throws**: `listModels`, `resolveCliPath`,
 * `cachedPlanUsage` and the rest are `notWired(...)`, so a slot exists, is
 * declared, is filled, and answers with an exception.
 *
 * That is invisible to every other gate. The parity manifest sees a module in
 * the bundle, the inventory sees a row with a slot, and the row-slot-fit table
 * sees two contracts of compatible shape. Only counting the stubs says how far
 * from moving these rows really are — which is why the numbers below are the
 * record, and why they may only fall.
 *
 * A count that goes up is a contribution being stubbed rather than written.
 */

const CONTEXTS: ReadonlyArray<{ providerId: string; path: string; notWired: number }> = [
  { providerId: 'claude', path: 'src/providers/claude/app/ClaudeModuleContext.ts', notWired: 0 },
  // The context every other one was measured against: it was the only entirely
  // real one, and the pattern that made it so is what the other eight adopted.
  { providerId: 'codex', path: 'src/providers/codex/app/CodexModuleContext.ts', notWired: 0 },
  { providerId: 'gemini', path: 'src/providers/gemini/app/GeminiModuleContext.ts', notWired: 0 },
  { providerId: 'grok', path: 'src/providers/grok/app/GrokModuleContext.ts', notWired: 1 },
  { providerId: 'kimicode', path: 'src/providers/kimicode/app/KimicodeModuleContext.ts', notWired: 1 },
  { providerId: 'mimocode', path: 'src/providers/mimocode/app/MimocodeModuleContext.ts', notWired: 1 },
  { providerId: 'opencode', path: 'src/providers/opencode/app/OpencodeModuleContext.ts', notWired: 1 },
  { providerId: 'qwen', path: 'src/providers/qwen/app/QwenModuleContext.ts', notWired: 0 },
];

/**
 * Both stub forms, because the first version of this counter saw only one.
 *
 * A member returning a promise is `x: () => notWired('x')`; a member returning
 * void wraps it in a block — `renderSettingsTab` in all eight — and matching
 * only the arrow form under-reported every provider by exactly one, silently
 * and in the direction that flatters the number. A counter that can only be
 * wrong downwards is worse than no counter.
 */
/** Not in `CONTEXTS`: it stubs nothing, so it has no count to record there. */
const ANTIGRAVITY_CONTEXT = {
  providerId: 'antigravity',
  path: 'src/providers/antigravity/app/AntigravityModuleContext.ts',
};

function stubbedMembers(path: string): string[] {
  const source = readFileSync(resolve(process.cwd(), path), 'utf8');
  return [
    ...[...source.matchAll(/^\s{4}(\w+): \([^)]*\) => notWired\b/gm)],
    ...[...source.matchAll(/^\s{4}(\w+): \([^)]*\) => \{\n\s*void notWired\b/gm)],
  ].map(match => match[1]);
}

describe('provider module context wiring', () => {
  it.each(CONTEXTS)('$providerId leaves $notWired members unwired', ({ notWired, path }) => {
    expect(stubbedMembers(path)).toHaveLength(notWired);
  });

  /**
   * Every context reaches its *own* provider's services.
   *
   * The nine `renderSettingsTab` bodies were written by one scripted pass over
   * nine files, and the defect that pass produces is a provider forwarding to a
   * neighbour's accessor: it typechecks, it runs, and it draws the wrong
   * settings tab. Nothing else would catch it, because both sides are real.
   */
  it.each([...CONTEXTS, ANTIGRAVITY_CONTEXT].map(context => [context.providerId, context] as const))(
    '%s forwards to its own workspace services',
    (providerId, context) => {
      const source = readFileSync(resolve(process.cwd(), context.path), 'utf8');
      const accessors = [...source.matchAll(/maybeGet(\w+)WorkspaceServices/g)]
        .map(match => match[1].toLowerCase());

      expect([...new Set(accessors)]).toEqual([providerId]);
    },
  );

  it('says in one place how much of the module contract is real', () => {
    // Antigravity is absent because it is measured with the rest below: it has
    // a context now, with nothing stubbed in it.
    expect(CONTEXTS.map(context => `${context.providerId}: ${context.notWired}`)).toEqual([
      'claude: 0',
      'codex: 0',
      'gemini: 0',
      'grok: 1',
      'kimicode: 1',
      'mimocode: 1',
      'opencode: 1',
      'qwen: 0',
    ]);
  });

  it('forwards what a model refresh was asked for instead of dropping it', () => {
    // **A narrow rule, and it says so.** It covers one slot, because one slot
    // is where this went wrong: a context wrote `refreshModels: () =>
    // workspace.refreshModels()`, and a zero-argument function is assignable to
    // a one-optional-argument signature, so nothing failed to compile while the
    // `force` flag was silently discarded. The only caller that sets it is the
    // user asking for a rediscovery, and the provider it was dropped for could
    // then never rediscover at all.
    // Read from disk rather than from `CONTEXTS` above, which lists eight of
    // the nine — Antigravity is measured separately there, and Antigravity is
    // the one this went wrong in. A rule over a subset reads exactly like a
    // rule over everything.
    const contexts = readdirSync(PROVIDERS_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => {
        const appRoot = join(PROVIDERS_ROOT, entry.name, 'app');
        if (!existsSync(appRoot)) return [];
        return readdirSync(appRoot)
          .filter(file => file.endsWith('ModuleContext.ts'))
          .map(file => join(appRoot, file));
      });
    const offenders = contexts
      .filter(path => /refreshModels:\s*\(\)\s*=>/.test(readFileSync(path, 'utf8')))
      .map(path => relative(process.cwd(), path));

    expect(contexts).toHaveLength(9);
    expect(offenders).toEqual([]);
  });

  it('leaves no provider stubbing a member Codex has written', () => {
    // Codex is the proof that every one of these is writable. A member stubbed
    // in eight contexts and real in one is eight providers' work, not a
    // contract problem — and the distinction is what decides whether the row
    // moves or the slot changes.
    const codex = new Set(stubbedMembers('src/providers/codex/app/CodexModuleContext.ts'));

    expect([...codex]).toEqual([]);
  });
});
