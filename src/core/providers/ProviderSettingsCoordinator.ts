import type { Conversation } from '../types';
import { coercePermissionMode } from '../types/settings';
import { resolveSettingsProviderId } from './modelRouting';
import { providerCatalog } from './ProviderCatalog';
import type {
  ProviderChatUiContribution,
  ProviderReasoningPresentation,
  ProviderSessionInvalidationScope,
} from './ProviderModule';
import type { ProviderId } from './types';

export interface SettingsReconciliationResult {
  changed: boolean;
  invalidatedConversations: Conversation[];
}

const PROJECTION_KEYS = new Set([
  'model',
  'effortLevel',
  'serviceTier',
  'thinkingBudget',
  'permissionMode',
]);

type ProviderProjectionMap = Partial<Record<string, string>>;

function getSettingsProviderId(settings: Record<string, unknown>): ProviderId {
  return resolveSettingsProviderId(settings);
}

function ensureProjectionMap(
  settings: Record<string, unknown>,
  key:
  | 'savedProviderModel'
  | 'savedProviderEffort'
  | 'savedProviderServiceTier'
  | 'savedProviderThinkingBudget'
  | 'savedProviderPermissionMode',
): ProviderProjectionMap {
  const current = settings[key];
  if (current && typeof current === 'object') {
    return current;
  }

  const next: ProviderProjectionMap = {};
  settings[key] = next;
  return next;
}

function cloneProviderSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    ...settings,
    savedProviderModel: { ...(settings.savedProviderModel as ProviderProjectionMap | undefined) },
    savedProviderEffort: { ...(settings.savedProviderEffort as ProviderProjectionMap | undefined) },
    savedProviderServiceTier: { ...(settings.savedProviderServiceTier as ProviderProjectionMap | undefined) },
    savedProviderThinkingBudget: { ...(settings.savedProviderThinkingBudget as ProviderProjectionMap | undefined) },
    savedProviderPermissionMode: { ...(settings.savedProviderPermissionMode as ProviderProjectionMap | undefined) },
  };
}

function normalizeToggleValue(
  value: unknown,
  allowedValues: Set<string>,
): string | undefined {
  const normalizedPermissionMode = coercePermissionMode(value);
  if (normalizedPermissionMode) {
    return allowedValues.has(normalizedPermissionMode) ? normalizedPermissionMode : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  return allowedValues.has(value) ? value : undefined;
}

function mergeProviderSettings(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (PROJECTION_KEYS.has(key)) {
      continue;
    }
    target[key] = value;
  }
}

/**
 * Called only where a reasoning group exists, which is why it takes one.
 *
 * Both call sites are guarded by `isAdaptive` or `usesBudget`, and both of
 * those are false when the contribution declares no reasoning — so a
 * `ProviderChatUiContribution` here would have to answer for a case that
 * cannot reach it.
 */
function normalizeReasoningValue(
  reasoning: ProviderReasoningPresentation,
  settings: Record<string, unknown>,
  model: string,
  value: unknown,
): string {
  const allowedValues = new Set(reasoning.options(model, settings).map(option => option.value));
  if (typeof value === 'string' && allowedValues.has(value)) {
    return value;
  }
  return reasoning.defaultValue(model, settings);
}

/**
 * Drops the session binding of every conversation that has one.
 *
 * **The host's job, and the reason the module answers a boolean.** Each
 * provider's reconciler used to walk the conversation list itself and clear
 * the binding on the ones whose own state field was set —
 * a thread id for Codex, a database path for OpenCode, a session directory for
 * Grok. Those are three spellings of one question: does this conversation have
 * a session to lose. `providerState` is opaque here, which is exactly what
 * makes "set at all" the provider-neutral form of it.
 *
 * **What comes off with the session is the provider's answer, not one rule.**
 * Claude keeps its `providerState` — subagent transcripts and a fork source live
 * there, and neither depends on the environment — while the five that hold a
 * native handle to a session the old environment created lose it with the
 * session it points at. The scope says which, and a provider that invalidates
 * nothing declares none.
 *
 * The conversations that had nothing are left out of the returned list, because
 * the caller writes one metadata file per entry.
 */
function clearSessionBindings(
  conversations: readonly Conversation[],
  scope: ProviderSessionInvalidationScope,
): Conversation[] {
  const clearsState = scope === 'session-and-state';
  const invalidated: Conversation[] = [];
  for (const conversation of conversations) {
    const bound = clearsState
      ? Boolean(conversation.sessionId) || conversation.providerState !== undefined
      : Boolean(conversation.sessionId);
    if (!bound) {
      continue;
    }
    conversation.sessionId = null;
    if (clearsState) {
      conversation.providerState = undefined;
    }
    invalidated.push(conversation);
  }
  return invalidated;
}

function chatUiFor(providerId: ProviderId): ProviderChatUiContribution {
  return providerCatalog().declarations(providerId).chatUI;
}

function normalizeProviderModel(
  chatUI: ProviderChatUiContribution,
  settings: Record<string, unknown>,
  model: string | undefined,
): string | undefined {
  if (!model) {
    return undefined;
  }
  return chatUI.models.normalizeVariant(model, settings);
}

export class ProviderSettingsCoordinator {
  static handleEnvironmentChange(
    settings: Record<string, unknown>,
    providerIds: ProviderId[],
  ): boolean {
    let anyChanged = false;
    for (const providerId of providerIds) {
      if (providerCatalog().settingsReconciliation(providerId).clearDiscoveryState?.(settings)) {
        anyChanged = true;
      }
    }
    return anyChanged;
  }

  static reconcileTitleGenerationModelSelection(settings: Record<string, unknown>): boolean {
    const currentModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    if (!currentModel) {
      return false;
    }

    const isValid = providerCatalog().ids().some((providerId) =>
      chatUiFor(providerId)
        .models.options(settings)
        .some((option) => option.value === currentModel)
    );
    if (isValid) {
      return false;
    }

    settings.titleGenerationModel = '';
    return true;
  }

  static normalizeProviderSelection(settings: Record<string, unknown>): boolean {
    const next = getSettingsProviderId(settings);

    if (settings.settingsProvider === next) {
      return false;
    }

    settings.settingsProvider = next;
    return true;
  }

  static getProviderSettingsSnapshot<T extends Record<string, unknown>>(
    settings: T,
    providerId: ProviderId,
  ): T {
    const snapshot = cloneProviderSettings(settings) as T;
    this.projectProviderState(snapshot, providerId);
    return snapshot;
  }

  static commitProviderSettingsSnapshot(
    settings: Record<string, unknown>,
    providerId: ProviderId,
    snapshot: Record<string, unknown>,
  ): void {
    this.persistProjectedProviderState(snapshot, providerId);

    if (providerId === getSettingsProviderId(settings)) {
      Object.assign(settings, snapshot);
      return;
    }

    mergeProviderSettings(settings, snapshot);
  }

  static persistProjectedProviderState(
    settings: Record<string, unknown>,
    providerId: ProviderId = getSettingsProviderId(settings),
  ): void {
    const savedModel = ensureProjectionMap(settings, 'savedProviderModel');
    const savedEffort = ensureProjectionMap(settings, 'savedProviderEffort');
    const savedServiceTier = ensureProjectionMap(settings, 'savedProviderServiceTier');
    const savedBudget = ensureProjectionMap(settings, 'savedProviderThinkingBudget');
    const savedPermissionMode = ensureProjectionMap(settings, 'savedProviderPermissionMode');
    const chatUI = chatUiFor(providerId);
    const normalizedModel = normalizeProviderModel(
      chatUI,
      settings,
      typeof settings.model === 'string' ? settings.model : undefined,
    );
    const projectedSettings = normalizedModel && normalizedModel !== settings.model
      ? { ...settings, model: normalizedModel }
      : settings;

    if (normalizedModel) {
      savedModel[providerId] = normalizedModel;
    }
    if (typeof settings.effortLevel === 'string') {
      savedEffort[providerId] = settings.effortLevel;
    }
    const serviceTierToggle = chatUI.serviceTier?.toggle(projectedSettings) ?? null;
    if (serviceTierToggle && typeof settings.serviceTier === 'string') {
      savedServiceTier[providerId] = settings.serviceTier;
    }
    // A provider with no reasoning group has no budget to keep. See
    // `projectProviderState` for why the absent group answers this rather than
    // a default standing in for the row method it replaces.
    const usesBudget = normalizedModel !== undefined
      && chatUI.reasoning !== undefined
      && !chatUI.reasoning.isTiered(normalizedModel, projectedSettings);
    if (usesBudget && typeof settings.thinkingBudget === 'string') {
      savedBudget[providerId] = settings.thinkingBudget;
    } else {
      delete savedBudget[providerId];
    }
    if (typeof settings.permissionMode === 'string' && chatUI.permissionMode?.toggle()) {
      savedPermissionMode[providerId] = settings.permissionMode;
    }
  }

  static projectProviderState(
    settings: Record<string, unknown>,
    providerId: ProviderId,
  ): void {
    const chatUI = chatUiFor(providerId);
    const savedModel = settings.savedProviderModel as ProviderProjectionMap | undefined;
    const savedEffort = settings.savedProviderEffort as ProviderProjectionMap | undefined;
    const savedServiceTier = settings.savedProviderServiceTier as ProviderProjectionMap | undefined;
    const savedBudget = settings.savedProviderThinkingBudget as ProviderProjectionMap | undefined;
    const savedPermissionMode = settings.savedProviderPermissionMode as ProviderProjectionMap | undefined;

    const shouldPreferCurrentProjection = providerId === getSettingsProviderId(settings);
    const currentModelRaw = typeof settings.model === 'string' ? settings.model : '';
    const currentModel = shouldPreferCurrentProjection
      ? (normalizeProviderModel(chatUI, settings, currentModelRaw) ?? '')
      : currentModelRaw;
    const currentEffort = typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined;
    const currentServiceTier = typeof settings.serviceTier === 'string' ? settings.serviceTier : undefined;
    const currentBudget = typeof settings.thinkingBudget === 'string' ? settings.thinkingBudget : undefined;
    const modelOptions = chatUI.models.options(settings);
    const isDefaultModelOfAnotherProvider = currentModel.length > 0
      && providerCatalog().ids()
        .filter(id => id !== providerId)
        .some(id => chatUiFor(id).models.isBuiltIn(currentModel));
    const canReuseCurrentModel = currentModel.length > 0
      && !isDefaultModelOfAnotherProvider
      && (
        shouldPreferCurrentProjection
        || modelOptions.some(option => option.value === currentModel)
      );
    const fallbackModel = canReuseCurrentModel
      ? currentModel
      : (modelOptions[0]?.value ?? currentModel);
    const savedModelValue = normalizeProviderModel(chatUI, settings, savedModel?.[providerId]);
    const isSavedModelValid = savedModelValue !== undefined
      && modelOptions.some(option => option.value === savedModelValue);
    const model = (isSavedModelValid ? savedModelValue : undefined) ?? fallbackModel;
    const canReuseCurrentProjection = canReuseCurrentModel && model === currentModel;

    if (model) {
      settings.model = model;
      chatUI.models.applyDefaults(model, settings);
    }

    const serviceTierToggle = chatUI.serviceTier?.toggle({
      ...settings,
      ...(model ? { model } : {}),
    }) ?? null;

    // **The group's absence is the answer, not a default standing in for it.**
    // Gemini and Antigravity declare `reasoningControl: { kind: 'none' }` and
    // contribute no reasoning group, while their configs still answer the row's
    // reasoning methods — and answer them differently from each other, so no
    // single fallback reproduces both. Nothing either provider ships reads an
    // effort level or a thinking budget, and neither draws a reasoning control:
    // the toolbar hides it on the same declaration. So a provider with no group
    // projects neither, which is what "no reasoning control" means.
    const reasoning = chatUI.reasoning;
    const isAdaptive = Boolean(model) && (reasoning?.isTiered(model, settings) ?? false);

    if (savedEffort?.[providerId] !== undefined) {
      settings.effortLevel = savedEffort[providerId];
    } else if (canReuseCurrentProjection && currentEffort !== undefined) {
      settings.effortLevel = currentEffort;
    } else if (isAdaptive && reasoning) {
      settings.effortLevel = reasoning.defaultValue(model, settings);
    }

    if (isAdaptive && reasoning) {
      settings.effortLevel = normalizeReasoningValue(reasoning, settings, model, settings.effortLevel);
    }

    if (savedServiceTier?.[providerId] !== undefined) {
      settings.serviceTier = savedServiceTier[providerId];
    } else if (canReuseCurrentProjection && currentServiceTier !== undefined) {
      settings.serviceTier = currentServiceTier;
    } else {
      settings.serviceTier = serviceTierToggle?.inactiveValue ?? 'default';
    }

    const usesBudget = Boolean(model) && reasoning !== undefined && !isAdaptive;

    if (usesBudget && reasoning) {
      if (savedBudget?.[providerId] !== undefined) {
        settings.thinkingBudget = savedBudget[providerId];
      } else if (canReuseCurrentProjection && currentBudget !== undefined) {
        settings.thinkingBudget = currentBudget;
      } else {
        settings.thinkingBudget = reasoning.defaultValue(model, settings);
      }
      settings.thinkingBudget = normalizeReasoningValue(reasoning, settings, model, settings.thinkingBudget);
    }

    const permissionToggle = chatUI.permissionMode?.toggle() ?? null;
    if (!permissionToggle) {
      return;
    }

    const allowedPermissionModes = new Set([
      permissionToggle.inactiveValue,
      permissionToggle.activeValue,
      ...(permissionToggle.planValue ? [permissionToggle.planValue] : []),
    ]);
    const currentPermissionMode = normalizeToggleValue(settings.permissionMode, allowedPermissionModes);
    const derivedPermissionMode = normalizeToggleValue(
      chatUI.permissionMode?.resolve?.(settings),
      allowedPermissionModes,
    );
    const savedPermissionModeValue = normalizeToggleValue(
      savedPermissionMode?.[providerId],
      allowedPermissionModes,
    );

    const projectedPermissionMode = savedPermissionModeValue
      ?? derivedPermissionMode
      ?? (shouldPreferCurrentProjection ? currentPermissionMode : undefined)
      ?? currentPermissionMode;

    if (projectedPermissionMode !== undefined) {
      settings.permissionMode = projectedPermissionMode;
    }
  }

  /** Each provider's reconciler only processes its own conversations. */
  static reconcileAllProviders(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): SettingsReconciliationResult {
    return this.reconcileProviders(
      settings,
      conversations,
      providerCatalog().ids(),
    );
  }

  static reconcileProviders(
    settings: Record<string, unknown>,
    conversations: Conversation[],
    providerIds: readonly ProviderId[],
  ): SettingsReconciliationResult {
    let anyChanged = false;
    const allInvalidated: Conversation[] = [];
    const settingsProvider = getSettingsProviderId(settings);

    for (const providerId of providerIds) {
      const providerConversations = conversations.filter(c => c.providerId === providerId);
      const targetSettings = providerId === settingsProvider
        ? settings
        : cloneProviderSettings(settings);

      if (providerId !== settingsProvider) {
        this.projectProviderState(targetSettings, providerId);
      }

      const reconciliation = providerCatalog().settingsReconciliation(providerId);
      const { changed, invalidatesSessions } = reconciliation.reconcileEnvironment(targetSettings);
      // A provider that reports an invalidation without declaring what it takes
      // is a contract error rather than a conversation to clear: the scope is
      // absent exactly for the providers that never invalidate.
      const invalidatedConversations = invalidatesSessions && reconciliation.invalidates
        ? clearSessionBindings(providerConversations, reconciliation.invalidates)
        : [];

      if (changed) {
        anyChanged = true;
        this.persistProjectedProviderState(targetSettings, providerId);
        if (providerId !== settingsProvider) {
          mergeProviderSettings(settings, targetSettings);
        }
      }
      allInvalidated.push(...invalidatedConversations);
    }

    if (this.reconcileTitleGenerationModelSelection(settings)) {
      anyChanged = true;
    }

    return { changed: anyChanged, invalidatedConversations: allInvalidated };
  }

  static normalizeAllModelVariants(settings: Record<string, unknown>): boolean {
    let anyChanged = false;
    const settingsProvider = getSettingsProviderId(settings);

    for (const providerId of providerCatalog().ids()) {
      const targetSettings = providerId === settingsProvider
        ? settings
        : cloneProviderSettings(settings);

      if (providerId !== settingsProvider) {
        this.projectProviderState(targetSettings, providerId);
      }

      const changed = providerCatalog()
        .settingsReconciliation(providerId)
        .normalizeModelVariants(targetSettings);
      if (changed) {
        anyChanged = true;
        this.persistProjectedProviderState(targetSettings, providerId);
        if (providerId !== settingsProvider) {
          mergeProviderSettings(settings, targetSettings);
        }
      }
    }

    if (this.reconcileTitleGenerationModelSelection(settings)) {
      anyChanged = true;
    }
    return anyChanged;
  }

  /**
   * Project the settings provider's saved values into the top-level
   * model/effortLevel/thinkingBudget fields.
   */
  static projectActiveProviderState(settings: Record<string, unknown>): void {
    this.projectProviderState(settings, getSettingsProviderId(settings));
  }
}
