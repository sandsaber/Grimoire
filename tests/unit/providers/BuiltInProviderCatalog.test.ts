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

  describe('enablement', () => {
    it.each(builtInProviderCatalog.list().map(module => [module.manifest.id, module] as const))(
      '%s toggles without rewriting the rest of its config',
      (providerId, module) => {
        // A stored config carrying two things a whole-config write would
        // destroy: a string the provider's own encoder would normalize, and a
        // key it does not model at all.
        const encodedDefaults = module.settings.encode(module.settings.defaults());
        const stringKey = Object.keys(encodedDefaults)
          .find(key => typeof encodedDefaults[key] === 'string');
        expect(stringKey).toBeDefined();

        const settings: Record<string, unknown> = {
          providerConfigs: {
            [providerId]: {
              ...encodedDefaults,
              [stringKey as string]: '  not normalized  ',
              grimoireUnmodelledKey: 'kept',
            },
          },
        };
        const before = builtInProviderCatalog.isEnabled(settings, providerId);

        builtInProviderCatalog.setEnabled(settings, providerId, !before);

        const configs = settings.providerConfigs as Record<string, Record<string, unknown>>;
        const stored = configs[providerId];
        expect(builtInProviderCatalog.isEnabled(settings, providerId)).toBe(!before);
        expect(stored[stringKey as string]).toBe('  not normalized  ');
        expect(stored.grimoireUnmodelledKey).toBe('kept');
      },
    );

    it('enables exactly the default provider on a vault that has configured none', () => {
      // A fresh vault gets one provider, not nine. Which one is product copy as
      // much as the display names are, so it is pinned rather than derived.
      expect(builtInProviderCatalog.enabledIds({})).toEqual(['codex']);
    });
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
