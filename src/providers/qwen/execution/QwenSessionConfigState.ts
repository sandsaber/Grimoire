import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions } from '@/core/runtime/types';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
} from '@/providers/acp';
import type { AcpSessionModelState, AcpSessionModeState } from '@/providers/acp/types';
import {
  decodeQwenModelId,
  encodeQwenModelId,
  QWEN_SYNTHETIC_MODEL_ID,
} from '@/providers/qwen/models';
import { mapQwenModeToGrimoire } from '@/providers/qwen/modes';
import {
  getQwenProviderSettings,
  normalizeQwenEffortLevel,
  type QwenDiscoveredModel,
  type QwenEffortLevel,
  type QwenMode,
  updateQwenProviderSettings,
} from '@/providers/qwen/settings';

const PROVIDER_ID = 'qwen' as const;

export interface QwenSessionConfigPorts {
  /** The whole settings object, which this both reads and seeds. */
  readonly settingsBag: () => Record<string, unknown>;
}

/**
 * What a Qwen session is configured with, and what the vault knows of it.
 *
 * Extracted from the legacy runtime, which now delegates to it, because the flip
 * needs the same answers from a composition that has no runtime: which model,
 * mode and effort a turn should be dispatched under, and what to do with the
 * lists a session reports back.
 *
 * Gemini's, plus the one thing Gemini has nothing of — a reasoning effort — and
 * **minus two defects Gemini's reviews already found and this provider still
 * carried**:
 *
 * - the mode a session *reports when it opens* was being written into
 *   `selectedMode`, which is what the toolbar reads back and what the next turn
 *   resolves its mode from. That is the fifth review's G1, and here it was
 *   worse: it was also **pushed at the toolbar**, where `updatePlanModeUI`
 *   commits it — so opening a session in a vault set to Plan switched the user
 *   to Safe and saved it. Only a `current_mode_update` moves the toolbar now;
 * - the mode was pushed **raw**, in the agent's own vocabulary, while the same
 *   three lines wrote the *translated* value into the vault. `Tab.ts` says what
 *   it expects — "ACP providers emit already-normalized Grimoire modes" — and
 *   two of Qwen's four ids only coerced correctly by accident.
 */
export class QwenSessionConfigState {
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;
  private currentSessionEffortLevel: QwenEffortLevel | null = null;

  constructor(private readonly ports: QwenSessionConfigPorts) {}

  /** The model the session is on, in Qwen's own id. */
  get sessionModelId(): string | null {
    return this.currentSessionModelId;
  }

  /** The mode the session is in, as Qwen names it. */
  get sessionModeId(): string | null {
    return this.currentSessionModeId;
  }

  /** The effort the session was last told to run at. */
  get sessionEffortLevel(): QwenEffortLevel | null {
    return this.currentSessionEffortLevel;
  }

  /** Records what a set actually applied, so the next turn does not repeat it. */
  markApplied(applied: {
    readonly modeId?: string | null;
    readonly modelId?: string | null;
    readonly effortLevel?: QwenEffortLevel | null;
  }): void {
    if (applied.modeId) {
      this.currentSessionModeId = applied.modeId;
    }
    if (applied.modelId) {
      this.currentSessionModelId = applied.modelId;
    }
    if (applied.effortLevel) {
      this.currentSessionEffortLevel = applied.effortLevel;
    }
  }

  /**
   * Forgets what the live session was set to.
   *
   * All three together, always. They are what the appliers skip their calls on,
   * so one kept across a session change means the next turn believes the new
   * session is already configured in a way nobody configured it — and for the
   * effort that costs a whole prompt the agent never received.
   */
  forgetSession(): void {
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.currentSessionEffortLevel = null;
  }

  /**
   * This provider's own permission mode, not whichever one was projected last.
   *
   * `settings.permissionMode` is a shared field: the settings coordinator
   * projects the active provider's value into it, so reading it directly answers
   * for whoever was toggled most recently. That is how another provider's
   * Auto-approve came to switch off *this* provider's workspace containment and
   * skip its write approvals.
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
      || getQwenProviderSettings(this.ports.settingsBag()).selectedMode;
  }

  /** The level the vault is set to, which a turn sends as a `/effort` prompt. */
  resolveSelectedEffortLevel(): QwenEffortLevel {
    return normalizeQwenEffortLevel(
      getQwenProviderSettings(this.ports.settingsBag()).effortLevel,
    );
  }

  resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    if (queryOptions?.model !== undefined) {
      return typeof queryOptions.model === 'string'
        ? decodeQwenModelId(queryOptions.model)
        : null;
    }
    const settingsBag = this.ports.settingsBag();
    const providerSettings = getQwenProviderSettings(settingsBag);
    const savedProviderModel = settingsBag.savedProviderModel;
    const savedQwenModel = savedProviderModel
      && typeof savedProviderModel === 'object'
      && !Array.isArray(savedProviderModel)
      ? (savedProviderModel as Record<string, unknown>).qwen
      : null;
    return typeof savedQwenModel === 'string'
      ? decodeQwenModelId(savedQwenModel)
      : providerSettings.visibleModels[0] ?? null;
  }

  /** The model a usage badge is labelled with. */
  getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string {
    const rawModelId = this.currentSessionModelId ?? this.resolveSelectedRawModelId(queryOptions);
    return rawModelId ? encodeQwenModelId(rawModelId) : QWEN_SYNTHETIC_MODEL_ID;
  }

  /**
   * Takes on a mode the session says it switched to, and answers with the
   * toolbar's word for it.
   *
   * The one door that may move the user's selection: a `current_mode_update` is
   * a switch somebody asked for — `/mode` typed into the composer, or the set
   * this turn just applied — where `session/new` merely reports where the agent
   * starts. Translated on the way out, because the toolbar speaks Grimoire's
   * three values and the agent's `auto-edit` is not one of them; kept raw in
   * `currentSessionModeId`, which is what the *session* is compared against.
   */
  adoptCurrentMode(currentModeId: string): 'normal' | 'full_access' | 'plan' {
    this.currentSessionModeId = currentModeId;
    const permissionMode = mapQwenModeToGrimoire(currentModeId);
    updateQwenProviderSettings(this.ports.settingsBag(), { selectedMode: permissionMode });
    return permissionMode;
  }

  /**
   * Keeps what a session reported about itself.
   *
   * The models and modes a tab's selectors are built from are answered once,
   * when the session is created or loaded, and by nothing else afterwards — so a
   * selector fed only from later updates stays empty on a fresh vault.
   */
  syncSessionDiscovery(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: AcpSessionModelState | null;
    modes?: AcpSessionModeState | null;
  }): boolean {
    const modelState = extractAcpSessionModelState(params);
    const modeState = extractAcpSessionModeState(params);
    const updates: Parameters<typeof updateQwenProviderSettings>[1] = {};

    if (modelState.currentModelId) {
      this.currentSessionModelId = modelState.currentModelId;
    }

    if (modelState.availableModels.length > 0) {
      updates.discoveredModels = modelState.availableModels.map((model): QwenDiscoveredModel => ({
        description: model.description ?? undefined,
        label: model.name || model.id,
        rawId: model.id,
      }));
      updates.visibleModels = modelState.availableModels
        .map((model) => model.id.trim())
        .filter(Boolean);
    }

    if (modeState.availableModes.length > 0) {
      updates.availableModes = modeState.availableModes.map((mode): QwenMode => ({
        description: mode.description ?? undefined,
        id: mode.id,
        name: mode.name,
      }));
    }

    if (modeState.currentModeId) {
      // Recorded, not adopted, and not announced. This is where the agent
      // *starts*; writing it into `selectedMode` decides what the next turn asks
      // for, and pushing it at the toolbar had `updatePlanModeUI` commit it — so
      // a vault on Plan, opening a session that reports `default`, was switched
      // to Safe and had it saved. Only `adoptCurrentMode` moves the toolbar.
      this.currentSessionModeId = modeState.currentModeId;
    }

    if (Object.keys(updates).length === 0) {
      return false;
    }
    updateQwenProviderSettings(this.ports.settingsBag(), updates);
    return true;
  }
}
