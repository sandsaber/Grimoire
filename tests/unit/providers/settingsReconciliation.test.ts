import '@/providers';

import { DEFAULT_GRIMOIRE_SETTINGS } from '@/app/settings/defaultSettings';
import { providerCatalog } from '@/core/providers/ProviderCatalog';

/**
 * What the module's settings reconciliation answers, for all nine at once.
 *
 * This replaces nine per-provider blocks that tested the codec's own
 * `reconcile` — an implementation **no production caller ever reached**, and
 * one that disagreed with the reconciler the product runs in three ways: it
 * hashed the provider's own environment scope rather than the shared scope
 * joined with it, it hashed the whole text rather than a named key list, and
 * for Gemini and Qwen it claimed sessions were invalidated where the shipped
 * reconciler invalidates nothing. Those nine blocks passed while describing
 * behavior no user has ever had.
 *
 * The provider-specific facts — which variables each hash covers — belong to
 * the reconcilers, and are tested beside them. What is here is the contract the
 * host now depends on, and the two things a per-provider block could not see:
 * that the shared environment scope reaches every provider's hash, and which
 * providers reconcile nothing at all.
 */

/** The app record, which is what these members take — never a decoded config. */
function appSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ ...DEFAULT_GRIMOIRE_SETTINGS, ...overrides }));
}

/**
 * The providers whose reconciler answers `changed` for an environment it reads.
 *
 * Gemini, Qwen and Antigravity are absent because their reconcilers return no
 * change unconditionally — Antigravity starts a fresh process per run and has
 * no session to lose, and the other two simply have no reconciliation written.
 * Recorded as a list rather than left to a loop's silence: this is the one
 * place the module's deleted design and the shipped behavior disagreed, and a
 * test that skipped the disagreement is how it would come back.
 */
const RECONCILING: ReadonlyArray<readonly [string, string]> = [
  ['claude', 'ANTHROPIC_BASE_URL=https://example.invalid'],
  ['codex', 'OPENAI_BASE_URL=https://example.invalid'],
  ['opencode', 'OPENCODE_CONFIG=/vault/opencode.json'],
  ['grok', 'XAI_API_KEY=xai-test'],
  ['kimicode', 'KIMICODE_CONFIG=/vault/kimi.json'],
  ['mimocode', 'MIMOCODE_CONFIG=/vault/mimo.json'],
];

const SILENT = ['gemini', 'qwen', 'antigravity'];

/** Exactly the providers that cache a model catalogue keyed to an environment. */
const CLEARS_DISCOVERY = ['opencode', 'grok', 'kimicode', 'mimocode'];

describe('provider settings reconciliation', () => {
  const catalog = providerCatalog();

  it.each(catalog.ids())('%s reports no change over the shipped defaults', (providerId) => {
    const reconciliation = catalog.settingsReconciliation(providerId);
    const settings = appSettings();

    expect(reconciliation.reconcileEnvironment(settings)).toEqual({
      changed: false,
      invalidatesSessions: false,
    });
    expect(reconciliation.normalizeModelVariants(appSettings())).toBe(false);
  });

  it.each(RECONCILING)(
    '%s invalidates its sessions when the shared environment scope changes',
    (providerId, envLine) => {
      // **The shared scope, not the provider's own.** The deleted codec
      // implementation hashed `settings.environmentVariables`, so a user who
      // set their key once for every provider would have stopped invalidating
      // anything. This assertion is the whole reason the row's parameter is
      // the app record.
      const settings = appSettings({ sharedEnvironmentVariables: `${envLine}\n` });

      expect(catalog.settingsReconciliation(providerId).reconcileEnvironment(settings))
        .toEqual({ changed: true, invalidatesSessions: true });
    },
  );

  it.each(SILENT)('%s reconciles nothing, and says so for any environment', (providerId) => {
    const settings = appSettings({
      sharedEnvironmentVariables: 'GEMINI_API_KEY=abc\nQWEN_API_KEY=abc\n',
    });

    expect(catalog.settingsReconciliation(providerId).reconcileEnvironment(settings))
      .toEqual({ changed: false, invalidatesSessions: false });
  });

  it('declares an invalidation scope exactly where it invalidates', () => {
    const declared = catalog.ids()
      .filter(providerId => catalog.settingsReconciliation(providerId).invalidates);

    // The three that reconcile nothing declare no scope: a scope on a provider
    // that never invalidates is a claim nothing can check, and an absent one on
    // a provider that does is a conversation the host would leave bound.
    expect(declared.sort()).toEqual(RECONCILING.map(([id]) => id).sort());
  });

  it('keeps Claude opaque state, and takes it from the providers that hold a session handle', () => {
    // **The one difference no delegation could read off the reconcilers.**
    // Claude's `providerState` holds subagent transcripts and a fork source,
    // and its reconciler clears the session id alone. Codex, OpenCode, Grok,
    // Kimi Code and MiMoCode keep a native handle there to a session the old
    // environment created, and clear both. A single rule loses one or strands
    // the other.
    expect(catalog.settingsReconciliation('claude').invalidates).toBe('session');
    for (const providerId of ['codex', 'opencode', 'grok', 'kimicode', 'mimocode']) {
      expect(catalog.settingsReconciliation(providerId).invalidates).toBe('session-and-state');
    }
  });

  it('offers a discovery-state clear only where the provider caches one', () => {
    const clearing = catalog.ids()
      .filter(providerId => catalog.settingsReconciliation(providerId).clearDiscoveryState);

    expect(clearing.sort()).toEqual([...CLEARS_DISCOVERY].sort());
  });
});
