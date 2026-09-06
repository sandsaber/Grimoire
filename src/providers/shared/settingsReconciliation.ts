import type {
  ProviderSessionInvalidationScope,
  ProviderSettingsReconcileOutcome,
  ProviderSettingsReconciliation,
} from '../../core/providers/ProviderModule';
import type { ProviderSettingsReconciler } from '../../core/providers/types';

/**
 * A provider's settings reconciliation, over the reconciler it already has.
 *
 * **A delegation, not a second implementation** — the same shape
 * `chatUiContributionFor` takes, and for a sharper reason. Every module carried
 * a hand-written `reconcile` that no production caller ever reached, and each
 * one disagreed with the reconciler the product actually runs:
 *
 * - it hashed `settings.environmentVariables`, the provider's **own** scope,
 *   while every reconciler hashes `getRuntimeEnvironmentText`, which joins the
 *   shared scope with the provider's. A user who sets `XAI_API_KEY` in the
 *   shared scope would stop invalidating Grok's model cache;
 * - it hashed the whole environment text, while each reconciler hashes a named
 *   key list — so any unrelated variable would have invalidated every session;
 * - and for Gemini and Qwen it reported `invalidatesSessions` on a hash change
 *   while their reconcilers invalidate nothing, ever.
 *
 * None of that was visible, because nothing called it. Wiring the module's
 * version up would have shipped all three at once, to nine providers, as a side
 * effect of a refactor. So the module's reconciliation *is* the live reconciler,
 * grouped — which is what makes moving this row a move rather than a rewrite.
 */
export function settingsReconciliationFor(
  reconciler: ProviderSettingsReconciler,
  /**
   * What this provider's invalidation clears, where it has one.
   *
   * Passed rather than derived: it is the one thing the nine reconcilers do
   * differently that no delegation could read off them, and getting it wrong is
   * silent. Claude clears the session id and keeps its `providerState` —
   * subagent transcripts and a fork source live there — while the five that
   * keep a native session handle clear both.
   */
  invalidates?: ProviderSessionInvalidationScope,
): ProviderSettingsReconciliation {
  return {
    ...(invalidates ? { invalidates } : {}),

    // Offered only where the provider has one: five providers cache no
    // environment-keyed discovery state, and a required member delegating to an
    // absent hook would report "nothing to clear" and "no such state" with the
    // same answer.
    ...(reconciler.handleEnvironmentChange
      ? {
        clearDiscoveryState: settings => reconciler.handleEnvironmentChange?.(settings) ?? false,
      }
      : {}),

    reconcileEnvironment(settings): ProviderSettingsReconcileOutcome {
      // No conversations are passed, so none are edited: the row builds its
      // invalidated list by mutating the conversations it is handed, and the
      // conversation list is the host's. `changed` and `invalidatesSessions`
      // are the same fact in all nine — each reconciler changes exactly when
      // its environment hash moved, and that is exactly when it drops the
      // sessions bound to the old one.
      const { changed } = reconciler.reconcileModelWithEnvironment(settings, []);
      return { changed, invalidatesSessions: changed };
    },

    normalizeModelVariants: settings => reconciler.normalizeModelVariantSettings(settings),
  };
}
