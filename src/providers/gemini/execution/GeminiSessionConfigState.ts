import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions } from '@/core/runtime/types';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
} from '@/providers/acp';
import type { AcpSessionModelState, AcpSessionModeState } from '@/providers/acp/types';
import {
  decodeGeminiModelId,
  encodeGeminiModelId,
  GEMINI_SYNTHETIC_MODEL_ID,
} from '@/providers/gemini/models';
import { mapGeminiModeToGrimoire } from '@/providers/gemini/modes';
import {
  type GeminiDiscoveredModel,
  type GeminiMode,
  getGeminiProviderSettings,
  updateGeminiProviderSettings,
} from '@/providers/gemini/settings';

const PROVIDER_ID = 'gemini' as const;

export interface GeminiSessionConfigPorts {
  /** The whole settings object, which this both reads and seeds. */
  readonly settingsBag: () => Record<string, unknown>;
  /** Persists what was seeded; only called when something actually changed. */
  readonly saveSettings: () => Promise<void>;
}

/**
 * What a Gemini session is configured with, and what the vault knows of it.
 *
 * Extracted from the legacy runtime, which now delegates to it, because the
 * flip needs the same answers from a composition that has no runtime: which
 * model and mode a turn should be dispatched under, and what to do with the
 * lists a session reports back.
 *
 * Smaller than the OpenCode family's and than Grok's, and the difference is not
 * an omission. Gemini's session carries no config options at all — the recorded
 * `session/new` answers with `models` and `modes` and nothing else — so there is
 * no thinking level to hold, no `configId` to remember one under, and no
 * per-model option map to seed. `capabilities.ts` says the same thing as
 * `reasoningControl: 'none'`.
 */
export class GeminiSessionConfigState {
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;

  constructor(private readonly ports: GeminiSessionConfigPorts) {}

  /** The model the session is on, in Gemini's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as Gemini names it. */
  get sessionModeId(): string | null {
    return this.currentSessionModeId;
  }

  /** Records what a set actually applied, so the next turn does not repeat it. */
  markApplied(applied: { readonly modeId?: string | null; readonly modelId?: string | null }): void {
    if (applied.modeId) {
      this.currentSessionModeId = applied.modeId;
    }
    if (applied.modelId) {
      this.currentSessionModelId = applied.modelId;
    }
  }

  /**
   * Forgets what the live session was set to.
   *
   * Both together, always. They are what `applySelectedMode` and
   * `applySelectedModel` skip their call on, so a mode kept across a session
   * change means the next turn believes the new session is already in a mode
   * nobody set it to.
   */
  forgetSession(): void {
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
  }

  /** The permission mode the vault is on, in Grimoire's vocabulary. */
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
      || getGeminiProviderSettings(this.ports.settingsBag()).selectedMode;
  }

  resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    if (queryOptions?.model !== undefined) {
      return typeof queryOptions.model === 'string'
        ? decodeGeminiModelId(queryOptions.model)
        : null;
    }
    const settingsBag = this.ports.settingsBag();
    const providerSettings = getGeminiProviderSettings(settingsBag);
    const savedProviderModel = settingsBag.savedProviderModel;
    const savedGeminiModel = savedProviderModel
      && typeof savedProviderModel === 'object'
      && !Array.isArray(savedProviderModel)
      ? (savedProviderModel as Record<string, unknown>).gemini
      : null;
    return typeof savedGeminiModel === 'string'
      ? decodeGeminiModelId(savedGeminiModel)
      : providerSettings.visibleModels[0] ?? null;
  }

  /** The model a usage badge is labelled with. */
  getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string {
    const rawModelId = this.currentSessionModelId ?? this.resolveSelectedRawModelId(queryOptions);
    return rawModelId ? encodeGeminiModelId(rawModelId) : GEMINI_SYNTHETIC_MODEL_ID;
  }

  /**
   * Keeps what a session reported about itself.
   *
   * The models and modes a tab's selectors are built from are answered once,
   * when the session is created or loaded, and by nothing else afterwards — so
   * a selector fed only from later updates stays empty on a fresh vault.
   */
  syncSessionDiscovery(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: AcpSessionModelState | null;
    modes?: AcpSessionModeState | null;
  }): boolean {
    const modelState = extractAcpSessionModelState(params);
    const modeState = extractAcpSessionModeState(params);
    const updates: Parameters<typeof updateGeminiProviderSettings>[1] = {};

    if (modelState.currentModelId) {
      this.currentSessionModelId = modelState.currentModelId;
    }

    if (modelState.availableModels.length > 0) {
      updates.discoveredModels = modelState.availableModels.map((model): GeminiDiscoveredModel => ({
        description: model.description ?? undefined,
        label: model.name || model.id,
        rawId: model.id,
      }));
      updates.visibleModels = modelState.availableModels
        .map((model) => model.id.trim())
        .filter(Boolean);
    }

    if (modeState.availableModes.length > 0) {
      updates.availableModes = modeState.availableModes.map((mode): GeminiMode => ({
        description: mode.description ?? undefined,
        id: mode.id,
        name: mode.name,
      }));
    }

    if (modeState.currentModeId) {
      // Translated on the way into the vault. `selectedMode` is what the toolbar
      // reads back, and it speaks Grimoire's three values — the agent's own
      // `autoEdit` is one it cannot render. Kept raw in `currentSessionModeId`,
      // which is what the *session* is compared against.
      this.currentSessionModeId = modeState.currentModeId;
      updates.selectedMode = mapGeminiModeToGrimoire(modeState.currentModeId);
    }

    if (Object.keys(updates).length === 0) {
      return false;
    }
    updateGeminiProviderSettings(this.ports.settingsBag(), updates);
    return true;
  }
}
