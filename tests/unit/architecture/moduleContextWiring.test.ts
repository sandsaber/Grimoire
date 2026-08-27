import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * How much of each provider's module context is real.
 *
 * `ProviderModule` says a provider's workspace slots are filled by
 * `workspace.initialize(context)`, and all nine modules fill them. What the
 * slot-fit audit missed on its first pass is that **eight of nine fill them
 * from a context whose workspace half throws**: `listModels`, `resolveCliPath`,
 * `readPlanUsage` and the rest are `notWired(...)`, so a slot exists, is
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
  {
    // One left: the settings tab, whose slot types the host as `unknown` and
    // whose real contract is a seven-member context the host supplies. It
    // closes with that row's reshape, not with wiring.
    providerId: 'claude', path: 'src/providers/claude/app/ClaudeModuleContext.ts', notWired: 1,
  },
  // The only context that is entirely real, which is why Codex is the only
  // provider whose workspace is initialized today.
  { providerId: 'codex', path: 'src/providers/codex/app/CodexModuleContext.ts', notWired: 0 },
  { providerId: 'gemini', path: 'src/providers/gemini/app/GeminiModuleContext.ts', notWired: 10 },
  { providerId: 'grok', path: 'src/providers/grok/app/GrokModuleContext.ts', notWired: 11 },
  { providerId: 'kimicode', path: 'src/providers/kimicode/app/KimicodeModuleContext.ts', notWired: 11 },
  { providerId: 'mimocode', path: 'src/providers/mimocode/app/MimocodeModuleContext.ts', notWired: 11 },
  { providerId: 'opencode', path: 'src/providers/opencode/app/OpencodeModuleContext.ts', notWired: 11 },
  { providerId: 'qwen', path: 'src/providers/qwen/app/QwenModuleContext.ts', notWired: 10 },
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

  it('says in one place how much of the module contract is real', () => {
    // Antigravity has no module context at all: its workspace contribution is
    // built inline and covers two slots, so there is nothing here to stub.
    expect(CONTEXTS.map(context => `${context.providerId}: ${context.notWired}`)).toEqual([
      'claude: 1',
      'codex: 0',
      'gemini: 10',
      'grok: 11',
      'kimicode: 11',
      'mimocode: 11',
      'opencode: 11',
      'qwen: 10',
    ]);
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
