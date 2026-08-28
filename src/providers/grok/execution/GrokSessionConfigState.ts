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
import { getGrokDiscoveryState, updateGrokDiscoveryState } from '@/providers/grok/discoveryState';
import { ensureProviderProjectionMap } from '@/providers/grok/internal/providerProjection';
import {
  buildGrokBaseModels,
  decodeGrokModelId,
  encodeGrokModelId,
  GROK_DEFAULT_THINKING_LEVEL,
  GROK_SYNTHETIC_MODEL_ID,
  type GrokDiscoveredModel,
  isGrokModelSelectionId,
  normalizeGrokDiscoveredModels,
  normalizeGrokModelVariants,
  resolveGrokBaseModelRawId,
} from '@/providers/grok/models';
import {
  getManagedGrokModes,
  normalizeGrokAvailableModes,
  resolveGrokModeForPermissionMode,
} from '@/providers/grok/modes';
import {
  expandGrokVisibleModelsWithFrontier,
  mergeGrokDiscoveredModels,
  readGrokNativeModelCatalog,
  resolveGrokCatalogDefaultModel,
  shouldUpgradeGrokFrontierDefault,
} from '@/providers/grok/runtime/GrokModelsCache';
import { resolveManagedGrokHomePath } from '@/providers/grok/runtime/GrokPaths';
import { buildGrokRuntimeEnv } from '@/providers/grok/runtime/GrokRuntimeEnvironment';
import { normalizeGrokAcpSessionModels } from '@/providers/grok/runtime/normalizeGrokAcpSessionState';
import {
  getGrokProviderSettings,
  updateGrokProviderSettings,
} from '@/providers/grok/settings';
import {
  sameDiscoveredModels,
  sameModes,
  sameStringList,
  sameStringMap,
  sameThinkingOptionsByModel,
} from '@/utils/collections';

const PROVIDER_ID = 'grok' as const;

export interface GrokSessionConfigPorts {
  /** The whole settings object, which this both reads and seeds. */
  readonly settingsBag: () => Record<string, unknown>;
  /** Persists what was seeded; only called when something actually changed. */
  readonly saveSettings: () => Promise<void>;
  /** Tells the open views to redraw their model and mode selectors. */
  readonly refreshSelectors: () => void;
  /** Where the vault is, for the native catalog this reads beside the CLI. */
  readonly workspaceRoot: () => string;
  /** The CLI the managed home is derived from. */
  readonly cliPath: () => string;
  /** Records a diagnostic, in the provider's own debug channel. */
  readonly recordDebug: (event: string, data: Record<string, unknown>) => void;
}

/**
 * What a Grok session is configured with, and what the vault knows of it.
 *
 * Extracted from the legacy runtime, which now delegates to it, for the reason
 * wave 4 extracted OpenCode's: the flip needs the same answers from a
 * composition that has no runtime — which model and mode a turn dispatches
 * under, and what to keep of the lists a session reports back.
 *
 * Not shared with OpenCode's, though the shape rhymes. Every line of it reaches
 * a Grok-specific helper: how a model id is encoded, which modes are managed,
 * what a frontier default upgrades to, and a native catalog read from beside
 * the CLI that OpenCode has no equivalent of.
 */
export class GrokSessionConfigState {
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;
  private currentSessionModeConfigId: string | null = null;

  constructor(private readonly ports: GrokSessionConfigPorts) {}

  /** The model the session is on, in Grok's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as Grok names it. */
  get sessionModeId(): string | null {
    return this.currentSessionModeId;
  }

  /** The config option a mode is set through, where the session advertised one. */
  get sessionModeConfigId(): string | null {
    return this.currentSessionModeConfigId;
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

  /** Forgets the live session, keeping nothing of what it was set to. */
  forgetSession(): void {
    this.currentSessionEffortConfigId = null;
    this.currentSessionEffortValue = null;
    this.currentSessionEffortValues = new Set<string>();
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.currentSessionModeConfigId = null;
  }

  private providerSettings(): Record<string, unknown> {
    const settingsBag = this.ports.settingsBag();
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      settingsBag,
      PROVIDER_ID,
    );
    // The snapshot is the provider's saved configuration; what a running Grok
    // told us about its models lives beside it, and every resolution below is
    // against the catalog the session actually has. Without this, a model that
    // was discovered once but is gone now resolves as selectable.
    updateGrokDiscoveryState(snapshot, getGrokDiscoveryState(settingsBag));
    return snapshot;
  }

  resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.providerSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (!isGrokModelSelectionId(selectedModel)) {
      return null;
    }

    const selectedBaseRawModelId = decodeGrokModelId(selectedModel);
    if (!selectedBaseRawModelId) {
      return null;
    }

    const discoveredModels = getGrokProviderSettings(providerSettings).discoveredModels;
    const normalizedBaseRawModelId = resolveGrokBaseModelRawId(selectedBaseRawModelId, discoveredModels);
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
      && selectedModel !== GROK_SYNTHETIC_MODEL_ID
      && isGrokModelSelectionId(selectedModel)
    ) {
      const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
      return selectedRawModelId
        ? encodeGrokModelId(selectedRawModelId)
        : (this.currentSessionModelId
          ? encodeGrokModelId(this.currentSessionModelId)
          : selectedModel);
    }

    return this.currentSessionModelId
      ? encodeGrokModelId(this.currentSessionModelId)
      : (selectedModel && isGrokModelSelectionId(selectedModel) ? selectedModel : undefined);
  }

  resolveSelectedModeId(): string | null {
    const providerSettings = this.providerSettings();
    const grokSettings = getGrokProviderSettings(providerSettings);
    const availableModes = getManagedGrokModes(grokSettings.availableModes);
    const mappedModeId = resolveGrokModeForPermissionMode(
      providerSettings.permissionMode,
      grokSettings.availableModes,
    );
    if (mappedModeId) {
      return mappedModeId;
    }

    if (grokSettings.selectedMode) {
      if (
        availableModes.some((mode) => mode.id === grokSettings.selectedMode)
      ) {
        return grokSettings.selectedMode;
      }
    }

    return availableModes[0]?.id || null;
  }

  resolveSelectedEffortValue(): string | null {
    const providerSettings = this.providerSettings();
    const selectedEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel.trim()
      : '';
    if (!selectedEffort || selectedEffort === GROK_DEFAULT_THINKING_LEVEL) {
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
    const acpState = extractAcpSessionModelState({
      ...params,
      models: normalizeGrokAcpSessionModels(params.models),
    });
    const forcedCurrentRawModelId = typeof options.currentRawModelId === 'string'
      ? options.currentRawModelId.trim()
      : '';
    const currentRawModelId = forcedCurrentRawModelId || acpState.currentModelId || this.currentSessionModelId;
    const acpDiscoveredModels = normalizeGrokDiscoveredModels(
      acpState.availableModels.map((model) => ({
        ...(model.description ? { description: model.description } : {}),
        label: model.name,
        rawId: model.id,
      })),
    );
    const nativeCatalog = this.readNativeModelCatalog();
    const discoveredModels = nativeCatalog.models.length > 0
      ? mergeGrokDiscoveredModels(nativeCatalog.models, acpDiscoveredModels)
      : acpDiscoveredModels;
    if (currentRawModelId) {
      this.currentSessionModelId = currentRawModelId;
    }

    const settingsBag = this.ports.settingsBag();
    const currentSettings = getGrokProviderSettings(settingsBag);
    const currentBaseRawModelId = currentRawModelId
      ? resolveGrokBaseModelRawId(currentRawModelId, discoveredModels)
      : null;
    const thoughtLevelState = extractAcpSessionThoughtLevelState(params);
    const currentThinkingOptions = normalizeGrokModelVariants(
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

    const discoveredBaseModelIds = buildGrokBaseModels(discoveredModels)
      .map((model) => model.rawId);
    const discoveredBaseModelIdSet = new Set(discoveredBaseModelIds);
    const availableVisibleModels = currentSettings.visibleModels.filter((rawId) =>
      discoveredBaseModelIdSet.has(rawId)
    );
    const removedUnavailableVisibleModels = discoveredBaseModelIds.length > 0
      && availableVisibleModels.length !== currentSettings.visibleModels.length;
    const reconciledVisibleModels = currentSettings.visibleModels.length === 0
      ? (discoveredBaseModelIds.length > 0
        ? discoveredBaseModelIds
        : (currentBaseRawModelId ? [currentBaseRawModelId] : []))
      : removedUnavailableVisibleModels
      ? [
          ...(currentBaseRawModelId && discoveredBaseModelIdSet.has(currentBaseRawModelId)
            ? [currentBaseRawModelId]
            : []),
          ...availableVisibleModels.filter((rawId) => rawId !== currentBaseRawModelId),
          ...(availableVisibleModels.length === 0
            ? discoveredBaseModelIds.filter((rawId) => rawId !== currentBaseRawModelId)
            : []),
        ]
      : currentSettings.visibleModels;
    const nextVisibleModels = expandGrokVisibleModelsWithFrontier(
      reconciledVisibleModels,
      discoveredModels,
    );
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
    const upgradedDefault = this.upgradeFrontierDefaultSelection(
      settingsBag,
      discoveredModels,
      currentSettings.visibleModels,
      nativeCatalog.defaultModelId,
    );
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
      && updateGrokDiscoveryState(settingsBag, { discoveredModels });
    if (discoveredModels.length > 0 || discoveryChanged) {
      this.ports.recordDebug('models.discovered', {
        currentModelId: currentRawModelId,
        discoveryChanged,
        modelCount: discoveredModels.length,
        modelIds: discoveredModels.map(model => model.rawId).slice(0, 12),
      });
    }
    let changed = shouldSeedVisibleModels || shouldSeedPreferredThinking || upgradedDefault;

    if (currentBaseRawModelId && options.seedActiveSelection !== false) {
      const seeded = this.seedActiveModelSelection(
        settingsBag,
        encodeGrokModelId(currentBaseRawModelId),
        currentThinkingLevel,
      );
      changed = changed || seeded;
    }

    if (shouldUpdateThinkingOptions || shouldSeedPreferredThinking || shouldSeedVisibleModels) {
      updateGrokProviderSettings(settingsBag, {
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
    const savedModel = typeof savedProviderModel.grok === 'string'
      ? savedProviderModel.grok
      : '';
    if (!savedModel || savedModel === GROK_SYNTHETIC_MODEL_ID) {
      savedProviderModel.grok = modelSelection;
      changed = true;
    }

    if (thinkingLevel) {
      const savedProviderEffort = ensureProviderProjectionMap(settingsBag, 'savedProviderEffort');
      const savedEffort = typeof savedProviderEffort.grok === 'string'
        ? savedProviderEffort.grok.trim()
        : '';
      if (!savedEffort || savedEffort === GROK_DEFAULT_THINKING_LEVEL) {
        savedProviderEffort.grok = thinkingLevel;
        changed = true;
      }
    }

    if (resolveSettingsProviderId(settingsBag) !== PROVIDER_ID) {
      return changed;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === GROK_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }
    if (thinkingLevel) {
      const activeEffort = typeof settingsBag.effortLevel === 'string' ? settingsBag.effortLevel : '';
      if (!activeEffort || activeEffort === GROK_DEFAULT_THINKING_LEVEL) {
        settingsBag.effortLevel = thinkingLevel;
        changed = true;
      }
    }
    return changed;
  }

  async syncSessionModeState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    currentModeId?: string | null;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModeState(params);
    const availableModes = normalizeGrokAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (acpState.configId) {
      this.currentSessionModeConfigId = acpState.configId;
    }
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
    }

    const settingsBag = this.ports.settingsBag();
    const currentSettings = getGrokProviderSettings(settingsBag);
    const discoveryChanged = availableModes.length > 0
      && !sameModes(currentSettings.availableModes, availableModes)
      && updateGrokDiscoveryState(settingsBag, { availableModes });

    if (!discoveryChanged) {
      return;
    }

    this.ports.refreshSelectors();
  }

  /**
   * Grok's own model list, read from beside the CLI.
   *
   * Public because the settings surfaces ask for it too: a catalog the vault
   * can see without opening a session is what fills a model browser before the
   * first turn.
   */
  readNativeModelCatalog() {
    const cwd = this.ports.workspaceRoot();
    const runtimeEnv = buildGrokRuntimeEnv(
      this.ports.settingsBag(),
      this.ports.cliPath(),
      resolveManagedGrokHomePath(cwd),
    );
    return readGrokNativeModelCatalog({
      env: runtimeEnv,
      managedGrokHomePath: runtimeEnv.GROK_HOME ?? null,
    });
  }

  private upgradeFrontierDefaultSelection(
    settingsBag: Record<string, unknown>,
    discoveredModels: readonly { rawId: string }[],
    visibleModels: readonly string[],
    configuredDefault?: string | null,
  ): boolean {
    const savedProviderModel = ensureProviderProjectionMap(settingsBag, 'savedProviderModel');
    const savedRawId = typeof savedProviderModel.grok === 'string'
      ? resolveGrokBaseModelRawId(
        decodeGrokModelId(savedProviderModel.grok) ?? '',
        discoveredModels as GrokDiscoveredModel[],
      )
      : null;
    const defaultRawId = resolveGrokCatalogDefaultModel(
      discoveredModels as GrokDiscoveredModel[],
      configuredDefault,
    );
    if (!shouldUpgradeGrokFrontierDefault({
      defaultRawId,
      savedRawId: savedRawId || null,
      visibleModels,
    }) || !defaultRawId) {
      return false;
    }

    const nextModelId = encodeGrokModelId(defaultRawId);
    savedProviderModel.grok = nextModelId;
    if (resolveSettingsProviderId(settingsBag) === PROVIDER_ID) {
      settingsBag.model = nextModelId;
    }
    return true;
  }
}
