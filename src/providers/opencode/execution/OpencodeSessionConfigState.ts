import { resolveSettingsProviderId } from '@/core/providers/modelRouting';
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
import { updateOpencodeDiscoveryState } from '@/providers/opencode/discoveryState';
import { ensureProviderProjectionMap } from '@/providers/opencode/internal/providerProjection';
import {
  buildOpencodeBaseModels,
  decodeOpencodeModelId,
  encodeOpencodeModelId,
  isOpencodeModelSelectionId,
  normalizeOpencodeDiscoveredModels,
  normalizeOpencodeModelVariants,
  OPENCODE_DEFAULT_THINKING_LEVEL,
  OPENCODE_SYNTHETIC_MODEL_ID,
  resolveOpencodeBaseModelRawId,
} from '@/providers/opencode/models';
import {
  getManagedOpencodeModes,
  isManagedOpencodeModeId,
  normalizeOpencodeAvailableModes,
  resolveOpencodeModeForPermissionMode,
  resolvePermissionModeForManagedOpencodeMode,
} from '@/providers/opencode/modes';
import {
  getOpencodeProviderSettings,
  updateOpencodeProviderSettings,
} from '@/providers/opencode/settings';
import {
  sameDiscoveredModels,
  sameModes,
  sameStringList,
  sameStringMap,
  sameThinkingOptionsByModel,
} from '@/utils/collections';

const PROVIDER_ID = 'opencode' as const;

export interface OpencodeSessionConfigPorts {
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
 * What an OpenCode session is configured with, and what the vault knows of it.
 *
 * Extracted from the legacy runtime, which now delegates to it, because the
 * flip needs the same answers from a composition that has no runtime: which
 * model, mode and effort a turn should be dispatched under, and what to do with
 * the model and mode lists a session reports back.
 *
 * It is the vault's memory of a live session as much as the session's own —
 * `syncSessionModelState` seeds the discovered models, the per-model thinking
 * options and, on a first run, the active selection itself. That seeding is why
 * this could not simply be recomputed per turn: an OpenCode vault learns what
 * its models are by opening a session and being told.
 */
export class OpencodeSessionConfigState {
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;

  constructor(private readonly ports: OpencodeSessionConfigPorts) {}

  /** The model the session is on, in OpenCode's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as OpenCode names it. */
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

    if (!isOpencodeModelSelectionId(selectedModel)) {
      return null;
    }

    const selectedBaseRawModelId = decodeOpencodeModelId(selectedModel);
    if (!selectedBaseRawModelId) {
      return null;
    }

    const discoveredModels = getOpencodeProviderSettings(providerSettings).discoveredModels;
    const normalizedBaseRawModelId = resolveOpencodeBaseModelRawId(selectedBaseRawModelId, discoveredModels);
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
      && selectedModel !== OPENCODE_SYNTHETIC_MODEL_ID
      && isOpencodeModelSelectionId(selectedModel)
    ) {
      const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
      return selectedRawModelId
        ? encodeOpencodeModelId(selectedRawModelId)
        : selectedModel;
    }

    return this.currentSessionModelId
      ? encodeOpencodeModelId(this.currentSessionModelId)
      : (selectedModel && isOpencodeModelSelectionId(selectedModel) ? selectedModel : undefined);
  }

  resolveSelectedModeId(): string | null {
    const providerSettings = this.providerSettings();
    const opencodeSettings = getOpencodeProviderSettings(providerSettings);
    const availableModes = getManagedOpencodeModes(opencodeSettings.availableModes);
    const mappedModeId = resolveOpencodeModeForPermissionMode(
      providerSettings.permissionMode,
      opencodeSettings.availableModes,
    );
    if (mappedModeId) {
      return mappedModeId;
    }

    if (opencodeSettings.selectedMode) {
      if (
        availableModes.some((mode) => mode.id === opencodeSettings.selectedMode)
      ) {
        return opencodeSettings.selectedMode;
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
    if (!selectedEffort || selectedEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
      return null;
    }
    return selectedEffort;
  }

  resolveSelectedEffortValue(): string | null {
    const providerSettings = this.providerSettings();
    const selectedEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel.trim()
      : '';
    if (!selectedEffort || selectedEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
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
    const discoveredModels = normalizeOpencodeDiscoveredModels(
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
    const currentSettings = getOpencodeProviderSettings(settingsBag);
    const currentBaseRawModelId = currentRawModelId
      ? resolveOpencodeBaseModelRawId(currentRawModelId, discoveredModels)
      : null;
    const thoughtLevelState = extractAcpSessionThoughtLevelState(params);
    const currentThinkingOptions = normalizeOpencodeModelVariants(
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

    const discoveredBaseModelIds = buildOpencodeBaseModels(discoveredModels)
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
      && updateOpencodeDiscoveryState(settingsBag, { discoveredModels });
    let changed = shouldSeedVisibleModels || shouldSeedPreferredThinking;

    if (currentBaseRawModelId && options.seedActiveSelection !== false) {
      const seeded = this.seedActiveModelSelection(
        settingsBag,
        encodeOpencodeModelId(currentBaseRawModelId),
        currentThinkingLevel,
      );
      changed = changed || seeded;
    }

    if (shouldUpdateThinkingOptions || shouldSeedPreferredThinking || shouldSeedVisibleModels) {
      updateOpencodeProviderSettings(settingsBag, {
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
    const savedModel = typeof savedProviderModel.opencode === 'string'
      ? savedProviderModel.opencode
      : '';
    if (!savedModel || savedModel === OPENCODE_SYNTHETIC_MODEL_ID) {
      savedProviderModel.opencode = modelSelection;
      changed = true;
    }

    if (thinkingLevel) {
      const savedProviderEffort = ensureProviderProjectionMap(settingsBag, 'savedProviderEffort');
      const savedEffort = typeof savedProviderEffort.opencode === 'string'
        ? savedProviderEffort.opencode.trim()
        : '';
      if (!savedEffort || savedEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
        savedProviderEffort.opencode = thinkingLevel;
        changed = true;
      }
    }

    if (resolveSettingsProviderId(settingsBag) !== PROVIDER_ID) {
      return changed;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === OPENCODE_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }
    if (thinkingLevel) {
      const activeEffort = typeof settingsBag.effortLevel === 'string' ? settingsBag.effortLevel : '';
      if (!activeEffort || activeEffort === OPENCODE_DEFAULT_THINKING_LEVEL) {
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
    const availableModes = normalizeOpencodeAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
      // session/new and session/load report OpenCode's default agent (`build`).
      // Pushing that into the toolbar overwrites the user's Safe/Plan/Auto pick
      // before applySelectedMode can run.
      if (params.emitPermissionSync !== false) {
        const permissionMode = resolvePermissionModeForManagedOpencodeMode(currentModeId);
        if (permissionMode) {
          this.ports.syncPermissionMode(permissionMode);
        }
      }
    }

    const settingsBag = this.ports.settingsBag();
    const currentSettings = getOpencodeProviderSettings(settingsBag);
    const shouldSeedSelectedMode = typeof currentModeId === 'string'
      && !currentSettings.selectedMode
      && isManagedOpencodeModeId(currentModeId);
    const discoveryChanged = availableModes.length > 0
      && !sameModes(currentSettings.availableModes, availableModes)
      && updateOpencodeDiscoveryState(settingsBag, { availableModes });

    if (!discoveryChanged && !shouldSeedSelectedMode) {
      return;
    }

    if (shouldSeedSelectedMode && currentModeId) {
      updateOpencodeProviderSettings(settingsBag, { selectedMode: currentModeId });
      await this.ports.saveSettings();
    }
    this.ports.refreshSelectors();
  }
}
