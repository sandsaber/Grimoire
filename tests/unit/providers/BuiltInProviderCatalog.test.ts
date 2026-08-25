import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

/**
 * Constructing the catalog is the assertion.
 *
 * Every rule in `ProviderCatalog` runs at construction, so importing this file
 * already proves the nine shipped modules agree with themselves and with each
 * other. What is left to state here is the product-visible consequence.
 */
describe('built-in provider catalog', () => {
  it('holds every shipped provider', () => {
    expect([...builtInProviderCatalog.ids()].sort()).toEqual([
      'antigravity',
      'claude',
      'codex',
      'gemini',
      'grok',
      'kimicode',
      'mimocode',
      'opencode',
      'qwen',
    ]);
  });

  it('orders providers the way the product shipped them', () => {
    // The order blank tabs, pickers, and the settings tab list have always
    // shown, written out rather than derived, because deriving it from the
    // manifests would assert only that the code equals itself. Three modules
    // reached this commit carrying the order of the provider they were forked
    // from, and the ordering the registrations had is what this pins.
    expect(builtInProviderCatalog.ids()).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'antigravity',
      'gemini',
      'qwen',
    ]);
  });

  it('names each provider as the product names it', () => {
    expect(builtInProviderCatalog.list().map(module => module.manifest.displayName)).toEqual([
      'Claude',
      'Codex',
      'OpenCode',
      'Grok Build',
      'MiMoCode',
      'Kimi Code',
      'Antigravity',
      'Gemini CLI (Legacy)',
      'Qwen Code',
    ]);
  });
});
