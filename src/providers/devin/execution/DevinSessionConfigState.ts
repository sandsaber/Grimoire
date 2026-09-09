import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions } from '@/core/runtime/types';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
} from '@/providers/acp';
import type { AcpSessionModelState, AcpSessionModeState } from '@/providers/acp/types';
import {
  decodeDevinModelId,
  DEVIN_SYNTHETIC_MODEL_ID,
  encodeDevinModelId,
} from '@/providers/devin/models';
import { mapDevinModeToGrimoire } from '@/providers/devin/modes';
import {
  type DevinDiscoveredModel,
  type DevinMode,
  getDevinProviderSettings,
  updateDevinProviderSettings,
} from '@/providers/devin/settings';

const PROVIDER_ID = 'devin' as const;

export interface DevinSessionConfigPorts {
  /** The whole settings object, which this both reads and seeds. */
  readonly settingsBag: () => Record<string, unknown>;
}

/**
 * What a Devin session is configured with, and what the vault knows of it.
 *
 * Qwen's, minus the reasoning effort Devin has no channel for. The models and
 * modes come from the `configOptions` of the `session/new` reply — a `model`
 * select and a `mode` select — which is what the wire recording shows, and
 * which `extractAcpSessionModelState` already reads.
 *
 * The mode a session *reports when it opens* is recorded and never adopted:
 * only a `current_mode_update` moves the toolbar, and it is translated on the
 * way, because the toolbar speaks Grimoire's three values and the agent's
 * `smart` and `ask` are not among them.
 */
export class DevinSessionConfigState {
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;

  constructor(private readonly ports: DevinSessionConfigPorts) {}

  /** The model the session is on, in Devin's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as Devin names it. */
  get sessionModeId(): string | null {
    return this.currentSessionModeId;
  }

  /** Records what a set actually applied, so the next turn does not repeat it. */
  markApplied(applied: {
    readonly modeId?: string | null;
    readonly modelId?: string | null;
  }): void {
    if (applied.modeId) {
      this.currentSessionModeId = applied.modeId;
    }
    if (applied.modelId) {
      this.currentSessionModelId = applied.modelId;
    }
  }

  /** Forgets what the live session was set to. */
  forgetSession(): void {
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
  }

  /**
   * This provider's own permission mode, not whichever one was projected last.
   *
   * `settings.permissionMode` is a shared field the coordinator projects the
   * active provider's value into; reading it directly answers for whoever was
   * toggled most recently.
   */
  permissionMode(): string {
    const snapshot = ProviderSettingsCoordinator
      .getProviderSettingsSnapshot(this.ports.settingsBag(), PROVIDER_ID);
    return typeof snapshot.permissionMode === 'string' ? snapshot.permissionMode : '';
  }

  /** Whether this session may reach outside the workspace. */
  fullAccess(): boolean {
    return this.permissionMode() === 'full_access';
  }

  /** What a turn should ask the session to switch to, before translation. */
  resolveSelectedModeId(): string {
    return this.permissionMode()
      || getDevinProviderSettings(this.ports.settingsBag()).selectedMode;
  }

  resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    if (queryOptions?.model !== undefined) {
      return typeof queryOptions.model === 'string'
        ? decodeDevinModelId(queryOptions.model)
        : null;
    }
    const settingsBag = this.ports.settingsBag();
    const providerSettings = getDevinProviderSettings(settingsBag);
    const savedProviderModel = settingsBag.savedProviderModel;
    const savedDevinModel = savedProviderModel
      && typeof savedProviderModel === 'object'
      && !Array.isArray(savedProviderModel)
      ? (savedProviderModel as Record<string, unknown>).devin
      : null;
    return typeof savedDevinModel === 'string'
      ? decodeDevinModelId(savedDevinModel)
      : providerSettings.visibleModels[0] ?? null;
  }

  /** The model a usage badge is labelled with. */
  getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string {
    const rawModelId = this.currentSessionModelId ?? this.resolveSelectedRawModelId(queryOptions);
    return rawModelId ? encodeDevinModelId(rawModelId) : DEVIN_SYNTHETIC_MODEL_ID;
  }

  /**
   * Takes on a mode the session says it switched to, and answers with the
   * toolbar's word for it. The one door that may move the user's selection.
   */
  adoptCurrentMode(currentModeId: string): 'normal' | 'full_access' | 'plan' {
    this.currentSessionModeId = currentModeId;
    const permissionMode = mapDevinModeToGrimoire(currentModeId);
    updateDevinProviderSettings(this.ports.settingsBag(), { selectedMode: permissionMode });
    return permissionMode;
  }

  /**
   * Keeps what a session reported about itself.
   *
   * Answered once, when the session is created or loaded; a selector fed only
   * from later updates stays empty on a fresh vault.
   */
  syncSessionDiscovery(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: AcpSessionModelState | null;
    modes?: AcpSessionModeState | null;
  }): boolean {
    const modelState = extractAcpSessionModelState(params);
    const modeState = extractAcpSessionModeState(params);
    const updates: Parameters<typeof updateDevinProviderSettings>[1] = {};

    if (modelState.currentModelId) {
      this.currentSessionModelId = modelState.currentModelId;
    }

    if (modelState.availableModels.length > 0) {
      updates.discoveredModels = modelState.availableModels.map((model): DevinDiscoveredModel => ({
        description: model.description ?? undefined,
        label: model.name || model.id,
        rawId: model.id,
      }));
      updates.visibleModels = modelState.availableModels
        .map((model) => model.id.trim())
        .filter(Boolean);
    }

    if (modeState.availableModes.length > 0) {
      updates.availableModes = modeState.availableModes.map((mode): DevinMode => ({
        description: mode.description ?? undefined,
        id: mode.id,
        name: mode.name,
      }));
    }

    if (modeState.currentModeId) {
      // Recorded, not adopted: where the agent starts is not what the user
      // picked. Only `adoptCurrentMode` moves the toolbar.
      this.currentSessionModeId = modeState.currentModeId;
    }

    if (Object.keys(updates).length === 0) {
      return false;
    }
    updateDevinProviderSettings(this.ports.settingsBag(), updates);
    return true;
  }
}
