import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions } from '@/core/runtime/types';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  extractAcpSessionThoughtLevelState,
} from '@/providers/acp';
import type {
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
} from '@/providers/acp/types';
import { updateMimocodeDiscoveryState } from '@/providers/mimocode/discoveryState';
import { ensureProviderProjectionMap } from '@/providers/mimocode/internal/providerProjection';
import {
  buildMimocodeBaseModels,
  decodeMimocodeModelId,
  encodeMimocodeModelId,
  isMimocodeModelSelectionId,
  MIMOCODE_DEFAULT_THINKING_LEVEL,
  MIMOCODE_SYNTHETIC_MODEL_ID,
  normalizeMimocodeDiscoveredModels,
  normalizeMimocodeModelVariants,
  resolveMimocodeBaseModelRawId,
} from '@/providers/mimocode/models';
import {
  getManagedMimocodeModes,
  isManagedMimocodeModeId,
  normalizeMimocodeAvailableModes,
  resolveMimocodeModeForPermissionMode,
  resolvePermissionModeForManagedMimocodeMode,
} from '@/providers/mimocode/modes';
import {
  getMimocodeProviderSettings,
  updateMimocodeProviderSettings,
} from '@/providers/mimocode/settings';
import {
  sameDiscoveredModels,
  sameModes,
  sameStringList,
  sameStringMap,
  sameThinkingOptionsByModel,
} from '@/utils/collections';

const PROVIDER_ID = 'mimocode' as const;

export interface MimocodeSessionConfigPorts {
  /** The whole settings object, which this both reads and seeds. */
  readonly settingsBag: () => Record<string, unknown>;
  /** Persists what was seeded; only called when something actually changed. */
  readonly saveSettings: () => Promise<void>;
  /** Tells the open views to redraw their model and mode selectors. */
  readonly refreshSelectors: () => void;
  /**
   * Reports a mode the session switched to, in Grimoire's own vocabulary.
   *
   * Translated here rather than at the two call sites, because a mode id that
   * maps to no permission mode must reach neither of them.
   */
  readonly syncPermissionMode: (permissionMode: 'normal' | 'plan' | 'full_access') => void;
}

/**
 * What a MiMoCode session is configured with, and what the vault knows of it.
 *
 * Extracted from the legacy runtime, which now delegates to it, because the
 * flip needs the same answers from a composition that has no runtime: which
 * model, mode and effort a turn should be dispatched under, and what to do with
 * the model and mode lists a session reports back.
 *
 * It is the vault's memory of a live session as much as the session's own —
 * `syncSessionModelState` seeds the discovered models, the per-model thinking
 * options and, on a first run, the active selection itself. That seeding is why
 * this could not simply be recomputed per turn: a MiMoCode vault learns what
 * its models are by opening a session and being told.
 */
export class MimocodeSessionConfigState {
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;

  constructor(private readonly ports: MimocodeSessionConfigPorts) {}

  /** The model the session is on, in MiMoCode's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as MiMoCode names it. */
  get sessionModeId(): string | null {
    return this.currentSessionModeId;
  }

  /** The config option a thinking level is set through, where there is one. */
  get effortConfigId(): string | null {
    return this.currentSessionEffortConfigId;
  }

  /** The thinking level the session is on. */
  get effortValue(): string | null {
    return this.currentSessionEffortValue;
  }

  /** Records what a set actually applied, so the next turn does not repeat it. */
  markApplied(applied: {
    readonly modeId?: string | null;
    readonly modelId?: string | null;
    readonly effortValue?: string | null;
  }): void {
    if (applied.modeId) {
      this.currentSessionModeId = applied.modeId;
    }
    if (applied.modelId) {
      this.currentSessionModelId = applied.modelId;
    }
    if (applied.effortValue) {
      this.currentSessionEffortValue = applied.effortValue;
    }
  }

  /**
   * Forgets the live session, keeping nothing of what it was set to.
   *
   * A tab that moves to another conversation is on another session, and
   * reporting the previous one's model as this one's would skip the set that
   * puts it right.
   */
  forgetSession(): void {
    this.currentSessionEffortConfigId = null;
    this.currentSessionEffortValue = null;
    this.currentSessionEffortValues = new Set<string>();
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
  }

  /**
   * Forgets which model the session is on, keeping everything else.
   *
   * So the next turn sends `set_config_option` again. A session that rejected a
   * model is still bound to the rejected one until the provider confirms the
   * fallback, and a state that still believed the set had taken would skip it.
   */
  forgetSessionModel(): void {
    this.currentSessionModelId = null;
  }

  /**
   * Forgets the model and the mode, and keeps what levels the session reported.
   *
   * The narrower of the two, and the difference is not cosmetic: this is what
   * the legacy runtime clears when the *process* goes away rather than when the
   * conversation does. The model and the mode belonged to a session that no
   * longer exists; the thinking levels are refilled by the next session's own
   * answer before anything reads them, and clearing them here would be a change
   * to behaviour rather than a move of it.
   */
  forgetProcessSelection(): void {
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
  }

  private providerSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.ports.settingsBag(),
      PROVIDER_ID,
    );
  }

  resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.providerSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (!isMimocodeModelSelectionId(selectedModel)) {
      return null;
    }

    const selectedBaseRawModelId = decodeMimocodeModelId(selectedModel);
    if (!selectedBaseRawModelId) {
      return null;
    }

    const discoveredModels = getMimocodeProviderSettings(providerSettings).discoveredModels;
    const normalizedBaseRawModelId = resolveMimocodeBaseModelRawId(selectedBaseRawModelId, discoveredModels);
    if (!normalizedBaseRawModelId) {
      return null;
    }

    const availableModelIds = new Set(discoveredModels.map((model) => model.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(normalizedBaseRawModelId)) {
      return null;
    }

    return normalizedBaseRawModelId;
  }

  getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const providerSettings = this.providerSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (
      selectedModel
      && selectedModel !== MIMOCODE_SYNTHETIC_MODEL_ID
      && isMimocodeModelSelectionId(selectedModel)
    ) {
      const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
      return selectedRawModelId
        ? encodeMimocodeModelId(selectedRawModelId)
        : selectedModel;
    }

    return this.currentSessionModelId
      ? encodeMimocodeModelId(this.currentSessionModelId)
      : (selectedModel && isMimocodeModelSelectionId(selectedModel) ? selectedModel : undefined);
  }

  resolveSelectedModeId(): string | null {
    const providerSettings = this.providerSettings();
    const mimocodeSettings = getMimocodeProviderSettings(providerSettings);
    const availableModes = getManagedMimocodeModes(mimocodeSettings.availableModes);
    const mappedModeId = resolveMimocodeModeForPermissionMode(
      providerSettings.permissionMode,
      mimocodeSettings.availableModes,
    );
    if (mappedModeId) {
      return mappedModeId;
    }

    if (mimocodeSettings.selectedMode) {
      if (
        availableModes.some((mode) => mode.id === mimocodeSettings.selectedMode)
      ) {
        return mimocodeSettings.selectedMode;
      }
    }

    return availableModes[0]?.id || null;
  }

  /**
   * The thinking level the vault is set to, before any session has said which
   * levels it has.
   *
   * `resolveSelectedEffortValue` answers for a session that has reported its
   * options; a tab's first turn is dispatched before one exists, and the
   * legacy runtime applied the level after the session opened rather than
   * losing it. This is what the applier resolves against the session's own
   * config id once it has one.
   */
  desiredEffortValue(): string | null {
    const providerSettings = this.providerSettings();
    const selectedEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel.trim()
      : '';
    if (!selectedEffort || selectedEffort === MIMOCODE_DEFAULT_THINKING_LEVEL) {
      return null;
    }
    return selectedEffort;
  }

  resolveSelectedEffortValue(): string | null {
    const providerSettings = this.providerSettings();
    const selectedEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel.trim()
      : '';
    if (!selectedEffort || selectedEffort === MIMOCODE_DEFAULT_THINKING_LEVEL) {
      return null;
    }

    return this.currentSessionEffortValues.has(selectedEffort)
      ? selectedEffort
      : null;
  }

  async syncSessionModelState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
  }, options: {
    currentRawModelId?: string | null;
    seedActiveSelection?: boolean;
  } = {}): Promise<void> {
    const acpState = extractAcpSessionModelState(params);
    const forcedCurrentRawModelId = typeof options.currentRawModelId === 'string'
      ? options.currentRawModelId.trim()
      : '';
    const currentRawModelId = forcedCurrentRawModelId || acpState.currentModelId || this.currentSessionModelId;
    const discoveredModels = normalizeMimocodeDiscoveredModels(
      acpState.availableModels.map((model) => ({
        ...(model.description ? { description: model.description } : {}),
        label: model.name,
        rawId: model.id,
      })),
    );
    if (currentRawModelId) {
      this.currentSessionModelId = currentRawModelId;
    }

    const settingsBag = this.ports.settingsBag();
    const currentSettings = getMimocodeProviderSettings(settingsBag);
    const currentBaseRawModelId = currentRawModelId
      ? resolveMimocodeBaseModelRawId(currentRawModelId, discoveredModels)
      : null;
    const thoughtLevelState = extractAcpSessionThoughtLevelState(params);
    const currentThinkingOptions = normalizeMimocodeModelVariants(
      thoughtLevelState.availableLevels.map((level) => ({
        ...(level.description ? { description: level.description } : {}),
        label: level.name,
        value: level.id,
      })),
    );
    const currentThinkingLevel = thoughtLevelState.currentLevel;
    this.currentSessionEffortConfigId = currentThinkingOptions.length > 0
      ? thoughtLevelState.configId
      : null;
    this.currentSessionEffortValue = currentThinkingOptions.length > 0
      ? currentThinkingLevel
      : null;
    this.currentSessionEffortValues = new Set(currentThinkingOptions.map((option) => option.value));

    const nextThinkingOptionsByModel = { ...currentSettings.thinkingOptionsByModel };
    if (currentBaseRawModelId) {
      if (currentThinkingOptions.length > 0) {
        nextThinkingOptionsByModel[currentBaseRawModelId] = currentThinkingOptions;
      } else {
        delete nextThinkingOptionsByModel[currentBaseRawModelId];
      }
    }

    const discoveredBaseModelIds = buildMimocodeBaseModels(discoveredModels)
      .map((model) => model.rawId);
    const nextVisibleModels = currentSettings.visibleModels.length === 0
      ? (discoveredBaseModelIds.length > 0
        ? discoveredBaseModelIds
        : (currentBaseRawModelId ? [currentBaseRawModelId] : []))
      : currentSettings.visibleModels;
    const currentPreferredThinking = currentBaseRawModelId
      ? currentSettings.preferredThinkingByModel[currentBaseRawModelId]
      : '';
    const shouldSeedCurrentThinking = currentBaseRawModelId
      && currentThinkingLevel
      && (
        !currentPreferredThinking
        || (
          currentThinkingOptions.length > 0
          && !this.currentSessionEffortValues.has(currentPreferredThinking)
        )
      );
    const nextPreferredThinkingByModel = shouldSeedCurrentThinking && currentBaseRawModelId && currentThinkingLevel
      ? {
        ...currentSettings.preferredThinkingByModel,
        [currentBaseRawModelId]: currentThinkingLevel,
      }
      : currentSettings.preferredThinkingByModel;
    const shouldSeedVisibleModels = !sameStringList(currentSettings.visibleModels, nextVisibleModels);
    const shouldSeedPreferredThinking = !sameStringMap(
      currentSettings.preferredThinkingByModel,
      nextPreferredThinkingByModel,
    );
    const shouldUpdateDiscoveredModels = discoveredModels.length > 0
      && !sameDiscoveredModels(currentSettings.discoveredModels, discoveredModels);
    const shouldUpdateThinkingOptions = !sameThinkingOptionsByModel(
      currentSettings.thinkingOptionsByModel,
      nextThinkingOptionsByModel,
    );
    const discoveryChanged = shouldUpdateDiscoveredModels
      && updateMimocodeDiscoveryState(settingsBag, { discoveredModels });
    let changed = shouldSeedVisibleModels || shouldSeedPreferredThinking;

    if (currentBaseRawModelId && options.seedActiveSelection !== false) {
      const seeded = this.seedActiveModelSelection(
        settingsBag,
        encodeMimocodeModelId(currentBaseRawModelId),
        currentThinkingLevel,
      );
      changed = changed || seeded;
    }

    if (shouldUpdateThinkingOptions || shouldSeedPreferredThinking || shouldSeedVisibleModels) {
      updateMimocodeProviderSettings(settingsBag, {
        ...(shouldSeedPreferredThinking ? { preferredThinkingByModel: nextPreferredThinkingByModel } : {}),
        ...(shouldUpdateThinkingOptions ? { thinkingOptionsByModel: nextThinkingOptionsByModel } : {}),
        ...(shouldSeedVisibleModels ? { visibleModels: nextVisibleModels } : {}),
      });
    }

    if (!changed && !discoveryChanged && !shouldUpdateThinkingOptions) {
      return;
    }

    if (changed || shouldUpdateThinkingOptions) {
      await this.ports.saveSettings();
    }
    this.ports.refreshSelectors();
  }

  private seedActiveModelSelection(
    settingsBag: Record<string, unknown>,
    modelSelection: string,
    thinkingLevel: string | null,
  ): boolean {
    let changed = false;
    const savedProviderModel = ensureProviderProjectionMap(settingsBag, 'savedProviderModel');
    const savedModel = typeof savedProviderModel.mimocode === 'string'
      ? savedProviderModel.mimocode
      : '';
    if (!savedModel || savedModel === MIMOCODE_SYNTHETIC_MODEL_ID) {
      savedProviderModel.mimocode = modelSelection;
      changed = true;
    }

    if (thinkingLevel) {
      const savedProviderEffort = ensureProviderProjectionMap(settingsBag, 'savedProviderEffort');
      const savedEffort = typeof savedProviderEffort.mimocode === 'string'
        ? savedProviderEffort.mimocode.trim()
        : '';
      if (!savedEffort || savedEffort === MIMOCODE_DEFAULT_THINKING_LEVEL) {
        savedProviderEffort.mimocode = thinkingLevel;
        changed = true;
      }
    }

    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) !== PROVIDER_ID) {
      return changed;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === MIMOCODE_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }
    if (thinkingLevel) {
      const activeEffort = typeof settingsBag.effortLevel === 'string' ? settingsBag.effortLevel : '';
      if (!activeEffort || activeEffort === MIMOCODE_DEFAULT_THINKING_LEVEL) {
        settingsBag.effortLevel = thinkingLevel;
        changed = true;
      }
    }
    return changed;
  }

  async syncSessionModeState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    currentModeId?: string | null;
    emitPermissionSync?: boolean;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModeState(params);
    const availableModes = normalizeMimocodeAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
      // session/new and session/load report MiMoCode's default agent, which the
      // recorded session names as `build`. Pushing that into the toolbar
      // overwrites the user's Safe/Plan/Auto pick before applySelectedMode can
      // run.
      if (params.emitPermissionSync !== false) {
        const permissionMode = resolvePermissionModeForManagedMimocodeMode(currentModeId);
        if (permissionMode) {
          this.ports.syncPermissionMode(permissionMode);
        }
      }
    }

    const settingsBag = this.ports.settingsBag();
    const currentSettings = getMimocodeProviderSettings(settingsBag);
    const shouldSeedSelectedMode = typeof currentModeId === 'string'
      && !currentSettings.selectedMode
      && isManagedMimocodeModeId(currentModeId);
    const discoveryChanged = availableModes.length > 0
      && !sameModes(currentSettings.availableModes, availableModes)
      && updateMimocodeDiscoveryState(settingsBag, { availableModes });

    if (!discoveryChanged && !shouldSeedSelectedMode) {
      return;
    }

    if (shouldSeedSelectedMode && currentModeId) {
      updateMimocodeProviderSettings(settingsBag, { selectedMode: currentModeId });
      await this.ports.saveSettings();
    }
    this.ports.refreshSelectors();
  }
}
