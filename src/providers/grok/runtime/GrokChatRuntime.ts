import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCapabilities,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  ApprovalDecisionOption,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { coercePermissionMode } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import {
  sameDiscoveredModels,
  sameModes,
  sameStringList,
  sameStringMap,
  sameThinkingOptionsByModel,
} from '../../../utils/collections';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  type AcpAskUserQuestionRequest,
  type AcpAskUserQuestionResponse,
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionConfigOption,
  type AcpSessionModelState,
  type AcpSessionModeState,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  type AcpUsage,
  type AcpUsageUpdate,
  type AcpWriteTextFileRequest,
  approveAcpWriteTextFile,
  buildAcpUsageInfo,
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  extractAcpSessionThoughtLevelState,
  isAcpRetryableTransportClose,
  isAcpSessionGone,
  JsonRpcErrorResponse,
  resolveWorkspacePath,
} from '../../acp';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import { grokPlanUsageStore } from '../app/GrokPlanUsageStore';
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import { getGrokDiscoveryState, updateGrokDiscoveryState } from '../discoveryState';
import {
  GrokNativeTranscriptRecovery,
  type GrokTranscriptRecoveryPort,
} from '../history/GrokTranscriptRecovery';
import {
  loadGrokSessionContextUsage,
  loadGrokSessionCost,
} from '../history/GrokUsageMetadataStore';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
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
  normalizeGrokThinkingOptionsByModel,
  resolveGrokBaseModelRawId,
} from '../models';
import {
  getManagedGrokModes,
  type GrokPermissionMode,
  normalizeGrokAvailableModes,
  resolveGrokAcpModeId,
  resolveGrokModeForPermissionMode,
  resolveGrokPermissionModeForSettings,
} from '../modes';
import { normalizeGrokSubagentExtensionNotification } from '../normalization/grokSubagentNormalization';
import { createGrokToolStreamAdapter } from '../normalization/grokToolNormalization';
import { getGrokProviderSettings, updateGrokProviderSettings } from '../settings';
import { getGrokState, type GrokProviderState } from '../types';
import { buildGrokPromptBlocks, buildGrokPromptText } from './buildGrokPrompt';
import { formatGrokAskUserQuestionResponse } from './formatGrokAskUserQuestionResponse';
import {
  grokAuthPathExists,
  logGrokDebug,
  summarizeGrokCliText,
} from './grokDebugLog';
import { buildGrokAgentProcessArgs } from './GrokLaunchArgs';
import { prepareGrokLaunchArtifacts } from './GrokLaunchArtifacts';
import {
  applyGrokNativeModelCatalog,
  expandGrokVisibleModelsWithFrontier,
  mergeGrokDiscoveredModels,
  readGrokNativeModelCatalog,
  resolveGrokCatalogDefaultModel,
  shouldUpgradeGrokFrontierDefault,
} from './GrokModelsCache';
import {
  buildManagedGrokProcessEnv,
  resolveGrokSessionDirectory,
  resolveManagedGrokHomePath,
} from './GrokPaths';
import { resolveGrokProviderAuthPath } from './GrokRuntimeEnvironment';
import { buildGrokRuntimeEnv } from './GrokRuntimeEnvironment';
import { GrokSessionNotificationMirrorDeduplicator } from './GrokSessionNotificationMirrorDeduplicator';
import {
  GROK_SESSION_NOTIFICATION_METHODS,
  type GrokSessionNotificationSource,
  isGrokTurnCompletedUpdate,
  isSupportedAcpSessionUpdate,
  parseGrokSessionNotification,
} from './GrokSessionNotifications';
import {
  normalizeGrokAcpSessionModels,
  readGrokAcpModelThinkingOptions,
} from './normalizeGrokAcpSessionState';

/** Upper bound for an answer read back from Grok's own session log. */
const GROK_RECOVERED_ANSWER_LIMIT_BYTES = 1_000_000;

interface ActiveTurn {
  queue: StreamChunkQueue;
  sawAssistantText: boolean;
  sawOutput: boolean;
  sessionId: string;
}

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }

    if (this.closed) {
      return null;
    }

    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class GrokChatRuntime implements ChatRuntime {
  readonly providerId = 'grok' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private askUserQuestionAbortController: AbortController | null = null;
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private readonly billingReaderOwner = {};
  private connection: AcpClientConnection | null = null;
  private contextUsage: AcpUsageUpdate | null = null;
  private currentSessionDirPath: string | null = null;
  private currentWorkspacePath: string | null = null;
  private currentLaunchKey: string | null = null;
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeConfigId: string | null = null;
  private currentSessionModeId: string | null = null;
  private currentTurnSawAcpCost = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private ensureReadyChain: Promise<unknown> = Promise.resolve(true);
  private loadedSessionId: string | null = null;
  private process: AcpSubprocess | null = null;
  private promptUsage: AcpUsage | null = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private sessionInvalidated = false;
  private readonly supportedCommandWaiters: Array<(commands: SlashCommand[]) => void> = [];
  private supportedCommands: SlashCommand[] = [];
  private sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly sessionNotificationDeduplicator = new GrokSessionNotificationMirrorDeduplicator();
  private readonly toolStreamAdapter = createGrokToolStreamAdapter();
  private readonly transcriptRecovery: GrokTranscriptRecoveryPort
    = new GrokNativeTranscriptRecovery();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterGrokSessionNotifications: Array<() => void> = [];
  private unregisterTransportClose: (() => void) | null = null;

  constructor(
    private readonly plugin: GrimoirePlugin,
  ) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return GROK_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: request.text,
      prompt: buildGrokPromptText(request),
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.push(listener);
    return () => {
      const index = this.readyListeners.indexOf(listener);
      if (index >= 0) {
        this.readyListeners.splice(index, 1);
      }
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(
    conversation: { providerState?: Record<string, unknown>; sessionId?: string | null } | null,
  ): void {
    const previousSessionId = this.sessionId;
    const nextSessionId = conversation?.sessionId ?? null;
    if (this.sessionId !== nextSessionId) {
      this.currentSessionEffortConfigId = null;
      this.currentSessionEffortValue = null;
      this.currentSessionEffortValues = new Set<string>();
      this.currentSessionModelId = null;
      this.currentSessionModeConfigId = null;
      this.currentSessionModeId = null;
      this.sessionInvalidated = false;
      this.setSupportedCommands([]);
    }
    this.sessionId = nextSessionId;
    const state = getGrokState(conversation?.providerState);
    if (!nextSessionId && state.sessionDropped) {
      this.sessionInvalidated = true;
    }
    if (state.sessionDirPath) {
      this.currentSessionDirPath = state.sessionDirPath;
    }
    if (state.workspacePath) {
      this.currentWorkspacePath = state.workspacePath;
    }

    if (!nextSessionId || nextSessionId !== previousSessionId) {
      if (!state.sessionDirPath) {
        this.currentSessionDirPath = null;
      }
      if (!state.workspacePath) {
        this.currentWorkspacePath = null;
      }
    }
  }

  async reloadMcpServers(): Promise<void> {
    await ProviderWorkspaceRegistry.getMcpServerManager('grok')?.loadServers();
    await this.shutdownProcess();
  }

  async warmModelMetadata(model: string): Promise<boolean> {
    const selectedRawModelId = decodeGrokModelId(model);
    if (!selectedRawModelId) {
      return false;
    }

    if (!(await this.ensureReady({ allowSessionCreation: true }))) {
      return false;
    }
    if (!this.connection || !this.sessionId) {
      return false;
    }

    const discoveredModels = getGrokProviderSettings(this.plugin.settings).discoveredModels;
    const selectedBaseRawModelId = resolveGrokBaseModelRawId(selectedRawModelId, discoveredModels);
    if (!selectedBaseRawModelId) {
      return false;
    }

    const availableModelIds = new Set(discoveredModels.map((entry) => entry.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(selectedBaseRawModelId)) {
      return false;
    }

    await this.connection.setModel({
      modelId: selectedBaseRawModelId,
      sessionId: this.sessionId,
    });
    this.currentSessionModelId = selectedBaseRawModelId;
    await this.syncSessionModelState({}, {
      currentRawModelId: selectedBaseRawModelId,
      seedActiveSelection: false,
    });
    return true;
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    // Serialize readiness checks: concurrent callers (the send path and the
    // slash-menu command catalog) each evaluate restart reasons against shared
    // process/transport state. Without serialization, a caller that evaluates
    // mid-restart sees partial state, shuts the fresh process down, and races
    // its own start — the first turn then fails with a start error.
    const run = this.ensureReadyChain.then(
      () => this.runEnsureReady(options),
      () => this.runEnsureReady(options),
    );
    this.ensureReadyChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async runEnsureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getGrokProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      logGrokDebug(this.plugin, 'ensureReady.skipped', {
        reason: 'disabled',
      });
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const targetSessionId = this.sessionId;
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('grok') ?? 'grok';
    const promptSettings = this.getSystemPromptSettings(cwd);
    const providerSettings = this.getProviderSettings();
    const permissionMode = resolveGrokPermissionModeForSettings(
      providerSettings.permissionMode,
    );
    this.hydrateNativeModelCatalog();
    const artifacts = await prepareGrokLaunchArtifacts({
      defaultModel: this.resolveLaunchDefaultModel(),
      permissionMode,
      settings: promptSettings,
      workspaceRoot: cwd,
    });
    const runtimeEnv = this.buildRuntimeEnv(
      resolvedCliPath,
      artifacts.grokHomePath,
    );
    const grokAuthPath = resolveGrokProviderAuthPath(this.plugin.settings, runtimeEnv);

    // Already clamped to the selected model's levels: the settings snapshot
    // runs effortLevel through getReasoningOptions for this model, which now
    // reflects what the agent reported for it.
    const reasoningEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel
      : null;
    const nextLaunchKey = JSON.stringify({
      artifactKey: artifacts.launchKey,
      command: resolvedCliPath,
      envText: getRuntimeEnvironmentText(this.plugin.settings, 'grok'),
      grokHomePath: artifacts.grokHomePath,
      permissionMode,
      promptKey: computeSystemPromptKey(promptSettings),
      reasoningEffort,
    });

    const restartReasons = resolveGrokRestartReasons({
      connection: this.connection,
      currentLaunchKey: this.currentLaunchKey,
      force: options?.force === true,
      nextLaunchKey,
      process: this.process,
      transport: this.transport,
    });
    const shouldRestart = restartReasons.length > 0;

    logGrokDebug(this.plugin, 'ensureReady.started', {
      allowSessionCreation: options?.allowSessionCreation !== false,
      cliPath: resolvedCliPath,
      grokAuthPath,
      grokHomePath: artifacts.grokHomePath,
      hasExplicitApiKey: Boolean(
        runtimeEnv.XAI_API_KEY?.trim()
        || runtimeEnv.GROK_CODE_XAI_API_KEY?.trim(),
      ),
      nativeAuthExists: grokAuthPathExists(grokAuthPath),
      permissionMode,
      restartReasons,
      sessionInvalidated: this.sessionInvalidated,
      shouldRestart,
      targetSessionId,
    });

    if (shouldRestart) {
      logGrokDebug(this.plugin, 'runtime.restart', {
        restartReasons,
      });
      try {
        await this.shutdownProcess();
        await this.startProcess({
          command: resolvedCliPath,
          cwd,
          permissionMode,
          reasoningEffort,
          runtimeEnv,
        });
        logGrokDebug(this.plugin, 'runtime.ready', {
          processAlive: this.process?.isAlive() ?? false,
        }, { level: 'info' });
        this.currentLaunchKey = nextLaunchKey;
        this.loadedSessionId = null;
      } catch (error) {
        logGrokDebug(this.plugin, 'runtime.start.failed', {
          cliPath: resolvedCliPath,
          grokAuthPath,
          grokHomePath: artifacts.grokHomePath,
          nativeAuthExists: grokAuthPathExists(grokAuthPath),
          stderrPreview: summarizeGrokCliText(this.process?.getStderrSnapshot() ?? ''),
        }, {
          error,
          level: 'error',
        });
        this.setReady(false);
        return false;
      }
    }

    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        const loaded = await this.loadSession(targetSessionId, cwd);
        if (!loaded) {
          // Soft-fail: keep chat history and native paths, start a fresh ACP
          // session on the next turn. Log only — a toast scares users for a
          // non-actionable recovery that already preserves Grimoire history.
          logGrokDebug(this.plugin, 'session.load.failed', {
            sessionId: targetSessionId,
            stderrPreview: summarizeGrokCliText(this.process?.getStderrSnapshot() ?? ''),
          }, { level: 'warn' });
          // Keep session/workspace paths so history hydrate and relaunch still
          // resolve after a failed ACP session/load.
          this.sessionInvalidated = true;
          this.clearActiveSession({ preserveSessionPaths: true });
        }
      }
      return true;
    }

    if (!this.sessionId && !this.sessionInvalidated) {
      if (options?.allowSessionCreation === false) {
        logGrokDebug(this.plugin, 'ensureReady.deferred', {
          reason: 'session_creation_disabled',
        });
        return true;
      }
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        logGrokDebug(this.plugin, 'ensureReady.failed', {
          reason: 'create_session_failed',
          grokAuthPath,
          nativeAuthExists: grokAuthPathExists(grokAuthPath),
          stderrPreview: summarizeGrokCliText(this.process?.getStderrSnapshot() ?? ''),
        }, { level: 'error' });
        return false;
      }
      return true;
    }

    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const previousMessages = conversationHistory ?? [];
    const expectedSessionId = this.sessionId;
    // A session that was dropped must not have the transcript replayed into its
    // replacement: that silently re-buys the whole conversation, once per failed
    // resume, without anyone asking. Bootstrap is for a genuine cold resume -
    // one where no session was ever held. `sessionInvalidated` is what tells the
    // two apart, and it is restored from the conversation, because the drop
    // usually happens during warmup, before query() runs at all.
    let shouldBootstrapHistory = previousMessages.length > 0
      && !expectedSessionId
      && !this.sessionInvalidated;

    if (!(await this.ensureReady())) {
      logGrokDebug(this.plugin, 'query.ensureReady.failed', {
        reason: 'not_ready',
        stderrPreview: summarizeGrokCliText(this.process?.getStderrSnapshot() ?? ''),
      }, { level: 'warn' });
      yield { type: 'error', content: t('chat.ui.errors.provider.startFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('grok') }) };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: t('chat.ui.errors.provider.notReady', { provider: ProviderRegistry.getProviderDisplayNameOrId('grok') }) };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    // Deliberately no bootstrap here: if readiness dropped the session, the
    // replacement starts clean and recovering the earlier context is the user's
    // call, not a purchase we make for them.

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        yield { type: 'error', content: t('chat.ui.errors.provider.sessionCreateFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('grok') }) };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId!;
    this.activeTurn?.queue.close();
    this.activeTurn = {
      queue: new StreamChunkQueue(),
      sawAssistantText: false,
      sawOutput: false,
      sessionId,
    };
    this.currentTurnMetadata = {};
    this.currentTurnSawAcpCost = false;
    this.contextUsage = null;
    this.promptUsage = null;
    this.sessionNotificationDeduplicator.reset();
    this.sessionUpdateNormalizer.reset();
    this.toolStreamAdapter.reset();

    const activeTurn = this.activeTurn;
    try {
      await this.applySelectedMode(sessionId);
      await this.applySelectedModel(sessionId, queryOptions);
      await this.applySelectedEffort(sessionId);
    } catch (error) {
      yield {
        type: 'error',
        content: this.formatRuntimeError(error),
      };
      yield { type: 'done' };
      activeTurn.queue.close();
      this.activeTurn = null;
      return;
    }

    const runPrompt = async (promptSessionId: string): Promise<void> => {
      this.currentTurnMetadata.wasSent = true;
      const response = await this.connection!.prompt({
        prompt: buildGrokPromptBlocks(
          turn.request,
          shouldBootstrapHistory ? previousMessages : [],
          { orchestratorMode: queryOptions?.orchestratorMode },
        ),
        sessionId: promptSessionId,
      });
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      this.promptUsage = response.usage ?? null;

      const usage = buildAcpUsageInfo({
        contextWindow: this.contextUsage,
        model: this.getActiveDisplayModel(queryOptions),
        promptUsage: this.promptUsage,
      });
      if (usage) {
        activeTurn.queue.push({ sessionId: promptSessionId, type: 'usage', usage });
      }

      await this.refreshFallbackPlanUsageFromSessionCost(promptSessionId);
      if (
        !activeTurn.sawAssistantText
        && response.stopReason
        && !/cancel/i.test(response.stopReason)
      ) {
        const recovered = await this.recoverNativeTranscriptOutput(promptSessionId, cwd);
        if (recovered) {
          activeTurn.sawAssistantText = true;
          activeTurn.queue.push({ type: 'text', content: recovered });
        } else {
          activeTurn.queue.push({
            type: 'error',
            content: t('chat.ui.errors.provider.emptyResponse', {
              provider: ProviderRegistry.getProviderDisplayNameOrId('grok'),
            }),
          });
        }
      }
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    };

    const promptPromise = runPrompt(sessionId).catch(async (error) => {
      let reportedError: unknown = error;
      try {
        if (await this.prepareClosedTransportRetry(error, activeTurn, cwd)) {
          const retrySessionId = this.sessionId;
          if (this.connection && retrySessionId) {
            if (retrySessionId !== sessionId && previousMessages.length > 0) {
              shouldBootstrapHistory = true;
            }
            activeTurn.sessionId = retrySessionId;
            this.currentTurnMetadata = {};
            this.currentTurnSawAcpCost = false;
            this.contextUsage = null;
            this.promptUsage = null;
            this.sessionNotificationDeduplicator.reset();
            this.sessionUpdateNormalizer.reset();
            this.toolStreamAdapter.reset();
            await this.applySelectedMode(retrySessionId);
            await this.applySelectedModel(retrySessionId, queryOptions);
            await this.applySelectedEffort(retrySessionId);
            await runPrompt(retrySessionId);
            return;
          }
        }
      } catch (retryError) {
        reportedError = retryError;
      }

      if (!activeTurn.sawAssistantText) {
        const recovered = await this.recoverNativeTranscriptOutput(activeTurn.sessionId, cwd);
        if (recovered) {
          activeTurn.sawAssistantText = true;
          activeTurn.queue.push({ type: 'text', content: recovered });
          activeTurn.queue.push({ type: 'done' });
          activeTurn.queue.close();
          return;
        }
      }

      activeTurn.queue.push({
        type: 'error',
        content: this.formatRuntimeError(reportedError),
      });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).finally(() => {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    });

    try {
      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await promptPromise;
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  resetSession(): void {
    this.clearActiveSession();
    this.sessionInvalidated = false;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isSessionDropped(): boolean {
    return this.sessionInvalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0 && this.loadedSessionId === this.sessionId) {
      return [...this.supportedCommands];
    }

    if (this.sessionId && this.loadedSessionId !== this.sessionId) {
      const ready = await this.ensureReady({ allowSessionCreation: false });
      if (!ready) {
        return [];
      }
    }

    if (!this.sessionId) {
      return [];
    }

    if (this.supportedCommands.length > 0) {
      return [...this.supportedCommands];
    }

    if (!this.sessionId || this.loadedSessionId !== this.sessionId) {
      return [];
    }

    return this.waitForSupportedCommands();
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    void this.shutdownProcess();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserQuestionCallback = callback;
  }

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {
    // Grok session reports describe effective state; saved permission remains user-owned.
  }

  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}

  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const existingState = params.conversation
      ? getGrokState(params.conversation.providerState)
      : null;
    const sessionDirPath = this.currentSessionDirPath ?? existingState?.sessionDirPath;
    const workspacePath = this.currentWorkspacePath ?? existingState?.workspacePath;
    // On invalidation without a replacement session, clear sessionId so the
    // next send creates a fresh ACP session, but keep native path metadata.
    const sessionId = params.sessionInvalidated && !this.sessionId
      ? null
      : this.sessionId;
    // "We had a session and lost it" has to outlive the runtime that learned
    // it: the in-memory flag is consumed by the first save, and saves happen on
    // tab close and on quit. Without this the next launch reads a dropped
    // session as a conversation that never had one and replays the whole
    // transcript into a fresh one. It clears once a real session id is back.
    const sessionDropped = !sessionId
      && (params.sessionInvalidated || existingState?.sessionDropped === true);
    const providerState: GrokProviderState = {
      ...(sessionDropped ? { sessionDropped: true } : {}),
      ...(sessionDirPath ? { sessionDirPath } : {}),
      ...(workspacePath ? { workspacePath } : {}),
    };

    // An empty object would leave the stored state untouched, so a marker that
    // has just cleared still has to be written out.
    const mustClearMarker = existingState?.sessionDropped === true && !sessionDropped;
    return {
      updates: {
        providerState: Object.keys(providerState).length > 0 || mustClearMarker
          ? providerState as Record<string, unknown>
          : undefined,
        sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? conversation?.sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async startProcess(params: {
    command: string;
    cwd: string;
    permissionMode: GrokPermissionMode;
    reasoningEffort?: string | null;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    const processEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...params.runtimeEnv,
      PATH: getEnhancedPath(
        params.runtimeEnv.PATH,
        path.isAbsolute(params.command) ? params.command : undefined,
      ),
    };

    this.process = new AcpSubprocess({
      args: buildGrokAgentProcessArgs(params.reasoningEffort, params.permissionMode),
      command: params.command,
      cwd: params.cwd,
      env: processEnv,
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });
    const transport = this.transport;
    this.unregisterTransportClose = transport.onClose(() => {
      if (this.transport === transport) {
        this.setReady(false);
      }
    });
    this.unregisterGrokSessionNotifications = GROK_SESSION_NOTIFICATION_METHODS.map(
      method => transport.onNotification(
        method,
        params => this.handleGrokTransportSessionNotification(method, params),
      ),
    );

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'grimoire',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        askUserQuestion: (request) => this.handleAskUserQuestionRequest(request),
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(request),
        },
        onSessionNotification: (notification) => this.handleSessionNotification(notification, 'standard'),
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
    grokPlanUsageStore.setBillingReader(async () => {
      const activeTransport = this.transport;
      if (!activeTransport || activeTransport.isClosed) {
        return null;
      }
      return activeTransport.request('x.ai/billing', {});
    }, this.billingReaderOwner);
    this.refreshPlanUsageFromServerInBackground();
    this.setReady(true);
  }

  private async shutdownProcess(options?: { preserveActiveTurn?: boolean }): Promise<void> {
    grokPlanUsageStore.setBillingReader(null, this.billingReaderOwner);
    this.setReady(false);
    if (!options?.preserveActiveTurn) {
      this.activeTurn?.queue.close();
      this.activeTurn = null;
    }
    this.currentSessionModelId = null;
    this.currentSessionModeConfigId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;
    for (const unregister of this.unregisterGrokSessionNotifications.splice(0)) {
      unregister();
    }

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
  }

  private refreshPlanUsageFromServerInBackground(): void {
    void grokPlanUsageStore.refreshUsage({
      plugin: this.plugin,
      providerId: this.providerId,
      settings: this.plugin.settings,
    }).then((usage) => {
      if (usage) {
        this.refreshModelSelectors();
      }
    }).catch(() => {});
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private getSystemPromptSettings(vaultPath: string): SystemPromptSettings {
    return {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath,
    };
  }

  private buildRuntimeEnv(
    cliPath: string,
    grokHomePath?: string | null,
  ): NodeJS.ProcessEnv {
    return buildGrokRuntimeEnv(
      this.plugin.settings,
      cliPath,
      grokHomePath,
    );
  }

  private getProviderSettings(): Record<string, unknown> {
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
    updateGrokDiscoveryState(
      snapshot,
      getGrokDiscoveryState(this.plugin.settings),
    );
    return snapshot;
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.getProviderSettings();
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

  getAuxiliaryModel(): string | null {
    return this.getActiveDisplayModel() ?? null;
  }

  private getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const providerSettings = this.getProviderSettings();
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

  private resolveSelectedModeId(): string | null {
    const providerSettings = this.getProviderSettings();
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

  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedModeId = this.resolveSelectedModeId();
    if (!selectedModeId) {
      return;
    }

    // Current Grok releases use launch policy without advertising ACP mode control.
    // Do not send Grimoire's synthetic toolbar mode IDs to such sessions.
    if (!this.currentSessionModeId) {
      return;
    }

    const advertisedModeIds = getGrokProviderSettings(this.getProviderSettings())
      .availableModes
      .map((mode) => mode.id);
    const modeToSend = resolveGrokAcpModeId(
      selectedModeId,
      this.currentSessionModeId,
      advertisedModeIds,
    );
    if (!modeToSend || modeToSend === this.currentSessionModeId) {
      return;
    }

    let unsupportedMethodError: JsonRpcErrorResponse | null = null;
    try {
      await this.connection.setMode({
        modeId: modeToSend,
        sessionId,
      });
      this.currentSessionModeId = modeToSend;
      return;
    } catch (error) {
      if (this.isIgnorableAcpModeError(error, modeToSend, sessionId, 'session.set_mode')) {
        return;
      }
      if (!(error instanceof JsonRpcErrorResponse) || error.code !== -32601) {
        throw error;
      }
      unsupportedMethodError = error;
    }

    if (!this.currentSessionModeConfigId) {
      throw unsupportedMethodError;
    }

    try {
      const response = await this.connection.setConfigOption({
        configId: this.currentSessionModeConfigId,
        sessionId,
        type: 'select',
        value: modeToSend,
      });
      this.currentSessionModeId = modeToSend;
      await this.syncSessionModeState({
        configOptions: response.configOptions,
      });
    } catch (error) {
      if (this.isIgnorableAcpModeError(error, modeToSend, sessionId, 'session.set_config_option')) {
        return;
      }
      throw error;
    }
  }

  private isIgnorableAcpModeError(
    error: unknown,
    modeId: string,
    sessionId: string,
    event: string,
  ): boolean {
    if (!(error instanceof JsonRpcErrorResponse) || error.code !== -32602) {
      return false;
    }

    logGrokDebug(this.plugin, event, {
      modeId,
      sessionId,
    }, {
      error,
      level: 'warn',
    });
    return true;
  }

  private async applySelectedModel(
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
  ): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
    if (!selectedRawModelId || selectedRawModelId === this.currentSessionModelId) {
      return;
    }

    await this.connection.setModel({
      modelId: selectedRawModelId,
      sessionId,
    });
    this.currentSessionModelId = selectedRawModelId;
    await this.syncSessionModelState({}, {
      currentRawModelId: selectedRawModelId,
    });
  }

  private resolveSelectedEffortValue(): string | null {
    const providerSettings = this.getProviderSettings();
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

  private async applySelectedEffort(sessionId: string): Promise<void> {
    if (!this.connection || !this.currentSessionEffortConfigId) {
      return;
    }

    const selectedEffort = this.resolveSelectedEffortValue();
    if (!selectedEffort || selectedEffort === this.currentSessionEffortValue) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: this.currentSessionEffortConfigId,
      sessionId,
      type: 'select',
      value: selectedEffort,
    });
    this.currentSessionEffortValue = selectedEffort;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
  }

  private async syncSessionModelState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    /**
     * The agent's own `models` payload, not a normalized one: the per-model
     * reasoning levels live in each entry's `_meta`, which normalizing strips.
     * Both derivations happen here so no caller has to remember the second.
     */
    models?: AcpSessionModelState | null;
  }, options: {
    currentRawModelId?: string | null;
    seedActiveSelection?: boolean;
  } = {}): Promise<void> {
    const rawModels = params.models ?? null;
    const acpState = extractAcpSessionModelState({
      configOptions: params.configOptions,
      models: normalizeGrokAcpSessionModels(rawModels),
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

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
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
    // Forgetting what the session said is only meaningful when this call
    // carried something that speaks about levels. A plain model switch calls
    // in with nothing at all.
    const describesSession = params.configOptions !== undefined || params.models !== undefined;
    if (currentThinkingOptions.length > 0) {
      this.currentSessionEffortConfigId = thoughtLevelState.configId;
      this.currentSessionEffortValue = currentThinkingLevel;
      this.currentSessionEffortValues = new Set(currentThinkingOptions.map((option) => option.value));
    } else if (describesSession) {
      this.currentSessionEffortConfigId = null;
      this.currentSessionEffortValue = null;
      this.currentSessionEffortValues = new Set();
    }

    // The agent reports the levels for every available model, so one session
    // makes the picker exact for models the user has not opened yet. The
    // `thought_level` option below still wins for the active model: it is the
    // live state of this session rather than a description of the catalog.
    const acpModelThinkingOptions = normalizeGrokThinkingOptionsByModel(
      readGrokAcpModelThinkingOptions(rawModels),
      discoveredModels,
    );
    const nextThinkingOptionsByModel = {
      ...currentSettings.thinkingOptionsByModel,
      ...acpModelThinkingOptions,
    };
    if (currentBaseRawModelId) {
      if (currentThinkingOptions.length > 0) {
        nextThinkingOptionsByModel[currentBaseRawModelId] = currentThinkingOptions;
      } else if (describesSession && !acpModelThinkingOptions[currentBaseRawModelId]) {
        // Deleting on a call that said nothing would throw away what
        // session/new reported the moment the user picks another model.
        delete nextThinkingOptionsByModel[currentBaseRawModelId];
      }
    }

    if (currentThinkingOptions.length === 0 && !describesSession && currentBaseRawModelId) {
      // A model switch keeps the same session, so its thought-level option id
      // still stands - clearing it would leave applySelectedEffort with nothing
      // to call and the turn would silently run at the agent's default. Only
      // the accepted values change with the model, and the effort has to be
      // re-applied because the agent reverted to that model's own default.
      this.currentSessionEffortValue = null;
      this.currentSessionEffortValues = new Set(
        (nextThinkingOptionsByModel[currentBaseRawModelId] ?? []).map((option) => option.value),
      );
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
      logGrokDebug(this.plugin, 'models.discovered', {
        currentModelId: currentRawModelId,
        discoveryChanged,
        modelCount: discoveredModels.length,
        modelIds: discoveredModels.map((model) => model.rawId).slice(0, 12),
      }, {
        level: discoveryChanged ? 'info' : 'debug',
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
      await this.plugin.saveSettings();
    }
    this.refreshModelSelectors();
  
  }

  private hydrateNativeModelCatalog(): void {
    const catalog = this.readNativeModelCatalog();
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    if (!applyGrokNativeModelCatalog(settingsBag, catalog)) {
      return;
    }

    void this.plugin.saveSettings();
    this.refreshModelSelectors();
  }

  private readNativeModelCatalog() {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const runtimeEnv = this.buildRuntimeEnv(
      this.plugin.getResolvedProviderCliPath('grok') ?? 'grok',
      resolveManagedGrokHomePath(cwd),
    );
    return readGrokNativeModelCatalog({
      env: runtimeEnv,
      managedGrokHomePath: runtimeEnv.GROK_HOME ?? null,
    });
  }

  private resolveLaunchDefaultModel(): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedRawModelId = this.resolveSelectedRawModelId();
    if (selectedRawModelId) {
      return selectedRawModelId;
    }

    return resolveGrokCatalogDefaultModel(
      getGrokProviderSettings(providerSettings).discoveredModels,
      this.readNativeModelCatalog().defaultModelId,
    );
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
    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) === this.providerId) {
      settingsBag.model = nextModelId;
    }
    return true;
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

    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) !== this.providerId) {
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

  private async syncSessionModeState(params: {
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

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const currentSettings = getGrokProviderSettings(settingsBag);
    const discoveryChanged = availableModes.length > 0
      && !sameModes(currentSettings.availableModes, availableModes)
      && updateGrokDiscoveryState(settingsBag, { availableModes });

    if (!discoveryChanged) {
      return;
    }

    this.refreshModelSelectors();
  }

  private refreshModelSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.newSession({
        cwd,
        mcpServers: this.getMcpServers(),
      });
      this.sessionInvalidated = false;
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      this.updateSessionPaths(response.sessionId, cwd);
      await this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.syncSessionModeState({
        configOptions: response.configOptions ?? null,
        modes: response.modes ?? null,
      });
      const normalizedModels = normalizeGrokAcpSessionModels(response.models ?? null);
      logGrokDebug(this.plugin, 'session.create.succeeded', {
        currentModelId: normalizedModels?.currentModelId ?? null,
        modelCount: normalizedModels?.availableModels.length ?? 0,
        modelIds: (normalizedModels?.availableModels ?? []).map((model) => model.id).slice(0, 12),
        sessionId: response.sessionId,
      }, { level: 'info' });
      return response.sessionId;
    } catch (error) {
      logGrokDebug(this.plugin, 'session.create.failed', {
        stderrPreview: summarizeGrokCliText(this.process?.getStderrSnapshot() ?? ''),
      }, {
        error,
        level: 'error',
      });
      return null;
    }
  }

  private async loadSession(sessionId: string, cwd: string): Promise<boolean> {
    const connection = this.connection;
    if (!connection) {
      return false;
    }

    try {
      this.setSupportedCommands([]);
      const response = await connection.loadSession({
        cwd,
        mcpServers: this.getMcpServers(),
        sessionId,
      });
      this.sessionInvalidated = false;
      // ACP session/load responses need not repeat the session id.
      this.loadedSessionId = sessionId;
      this.sessionId = sessionId;
      this.sessionCwds.set(sessionId, cwd);
      this.updateSessionPaths(sessionId, cwd);
      await this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.syncSessionModeState({
        configOptions: response.configOptions ?? null,
        modes: response.modes ?? null,
      });
      const normalizedModels = normalizeGrokAcpSessionModels(response.models ?? null);
      logGrokDebug(this.plugin, 'session.load.succeeded', {
        currentModelId: normalizedModels?.currentModelId ?? null,
        modelCount: normalizedModels?.availableModels.length ?? 0,
        sessionId,
      }, { level: 'info' });
      return true;
    } catch (error) {
      logGrokDebug(this.plugin, 'session.load.failed', {
        sessionId,
        stderrPreview: summarizeGrokCliText(this.process?.getStderrSnapshot() ?? ''),
      }, {
        error,
        level: 'warn',
      });
      // Ask the agent whether the session still exists instead of treating any
      // failure as proof it is gone. Grok reports a missing session as a bare
      // `-32603 Path not found`, which no error-text rule can tell apart from
      // an auth or configuration failure - but it advertises
      // `sessionCapabilities.list` and answers `session/list`, so the listing
      // is the reliable answer. An agent that cannot be asked keeps the
      // binding and lets the original error surface.
      if (!(await isAcpSessionGone({
        error,
        listSessions: () => connection.listSessions(),
        sessionId,
      }))) {
        throw error;
      }
      return false;
    }
  }

  private getMcpServers() {
    const servers = ProviderWorkspaceRegistry.getMcpServerManager('grok')?.getServers() ?? [];
    return toAcpMcpServers(servers);
  }

  private async handleSessionNotification(
    notification: AcpSessionNotification,
    source: GrokSessionNotificationSource = 'standard',
  ): Promise<void> {
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    if (!this.sessionNotificationDeduplicator.shouldProcess(notification, source)) {
      return;
    }

    const subagentChunk = normalizeGrokSubagentExtensionNotification(
      notification,
      this.sessionId,
    );
    if (subagentChunk) {
      if (this.activeTurn?.sessionId === notification.sessionId) {
        this.activeTurn.sawOutput = true;
        this.activeTurn.queue.push(subagentChunk);
      }
      return;
    }

    if (isGrokTurnCompletedUpdate(notification.update)) {
      return;
    }

    if (!isSupportedAcpSessionUpdate(notification.update)) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (normalized.type === 'config_options') {
      await this.syncSessionModelState({
        configOptions: normalized.configOptions,
      });
      await this.syncSessionModeState({
        configOptions: normalized.configOptions,
      });
      return;
    }

    if (normalized.type === 'current_mode') {
      await this.syncSessionModeState({
        currentModeId: normalized.currentModeId,
      });
      return;
    }

    if (normalized.type === 'commands') {
      this.setSupportedCommands(normalized.commands);
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    switch (normalized.type) {
      case 'message_chunk': {
        if (normalized.role === 'assistant' && normalized.messageId) {
          this.currentTurnMetadata.assistantMessageId = normalized.messageId;
        }
        if (normalized.role === 'user' && normalized.messageId) {
          this.currentTurnMetadata.userMessageId = normalized.messageId;
        }
        if (
          normalized.role === 'assistant'
          && normalized.streamChunks.some(chunk => (
            chunk.type === 'text' && chunk.content.trim().length > 0
          ))
        ) {
          this.activeTurn.sawAssistantText = true;
        }
        if (normalized.streamChunks.length > 0) {
          this.activeTurn.sawOutput = true;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'plan': {
        if (normalized.streamChunks.length > 0) {
          this.activeTurn.sawOutput = true;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const streamChunks = normalized.type === 'tool_call'
          ? this.toolStreamAdapter.normalizeToolCall(normalized.toolCall, normalized.streamChunks)
          : this.toolStreamAdapter.normalizeToolCallUpdate(normalized.toolCallUpdate, normalized.streamChunks);

        if (streamChunks.length > 0) {
          this.activeTurn.sawOutput = true;
        }
        for (const chunk of streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'usage': {
        this.contextUsage = normalized.usage;
        if (grokPlanUsageStore.recordCost(normalized.usage.cost ?? null)) {
          this.currentTurnSawAcpCost = true;
          this.refreshModelSelectors();
        }
        const usage = buildAcpUsageInfo({
          contextWindow: normalized.usage,
          model: this.getActiveDisplayModel(),
          promptUsage: this.promptUsage,
        });
        if (usage) {
          this.activeTurn.queue.push({
            sessionId: notification.sessionId,
            type: 'usage',
            usage,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private async handleGrokTransportSessionNotification(
    source: Exclude<GrokSessionNotificationSource, 'standard'>,
    params: unknown,
  ): Promise<void> {
    const notification = parseGrokSessionNotification(source, params);
    if (!notification) {
      return;
    }
    await this.handleSessionNotification(notification, source);
  }

  private async refreshFallbackPlanUsageFromSessionCost(sessionId: string): Promise<void> {
    const providerState: GrokProviderState = {
      ...(this.currentSessionDirPath ? { sessionDirPath: this.currentSessionDirPath } : {}),
      ...(this.currentWorkspacePath ? { workspacePath: this.currentWorkspacePath } : {}),
    };

    if (!this.contextUsage) {
      const contextUsage = await loadGrokSessionContextUsage(sessionId, providerState);
      if (contextUsage) {
        this.contextUsage = contextUsage;
        const usage = buildAcpUsageInfo({
          contextWindow: contextUsage,
          model: this.getActiveDisplayModel(),
          promptUsage: this.promptUsage,
        });
        if (usage && this.activeTurn) {
          this.activeTurn.queue.push({
            sessionId,
            type: 'usage',
            usage,
          });
        }
      }
    }

    if (this.currentTurnSawAcpCost) {
      return;
    }

    const cost = await loadGrokSessionCost(sessionId, providerState);
    if (grokPlanUsageStore.recordSessionTotalCost(sessionId, cost)) {
      this.refreshModelSelectors();
    }
  }

  /**
   * Recovers an answer Grok completed but never streamed. Grok can finish a turn
   * without delivering its final `agent_message_chunk` over ACP while still writing the
   * answer to its own session log, which otherwise surfaces as a credentials error.
   */
  private async recoverNativeTranscriptOutput(
    sessionId: string,
    workspacePath: string | null,
  ): Promise<string> {
    const providerState: GrokProviderState = {
      ...(this.currentSessionDirPath ? { sessionDirPath: this.currentSessionDirPath } : {}),
      ...(this.currentWorkspacePath ? { workspacePath: this.currentWorkspacePath } : {}),
    };
    try {
      return await this.transcriptRecovery.recoverFinalAssistantMessage({
        nativeSessionRef: sessionId,
        workspacePath,
        providerState,
        maxBytes: GROK_RECOVERED_ANSWER_LIMIT_BYTES,
      });
    } catch {
      // Recovery is best-effort; an unreadable log must not mask the real turn outcome.
      return '';
    }
  }

  private async handleAskUserQuestionRequest(
    request: AcpAskUserQuestionRequest,
  ): Promise<AcpAskUserQuestionResponse> {
    if (!this.askUserQuestionCallback) {
      return { outcome: 'cancelled' };
    }

    this.askUserQuestionAbortController?.abort();
    const abortController = new AbortController();
    this.askUserQuestionAbortController = abortController;

    try {
      const userAnswers = await this.askUserQuestionCallback(
        { questions: request.questions },
        abortController.signal,
      );
      return formatGrokAskUserQuestionResponse(userAnswers);
    } finally {
      if (this.askUserQuestionAbortController === abortController) {
        this.askUserQuestionAbortController = null;
      }
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildGrokPermissionPresentation(
      request.toolCall.title,
      request.toolCall.kind,
      input,
      request.toolCall.locations,
    );
    const decision = await this.approvalCallback(
      presentation.toolName,
      input,
      presentation.description,
      {
        ...(presentation.blockedPath ? { blockedPath: presentation.blockedPath } : {}),
        ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
        decisionOptions: buildAcpApprovalDecisionOptions(request.options),
      },
    );

    return mapApprovalDecision(decision, request.options);
  }

  private setSupportedCommands(commands: SlashCommand[]): void {
    this.supportedCommands = commands.map((command) => ({ ...command }));

    const waiters = this.supportedCommandWaiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.supportedCommands);
    }
  }

  private waitForSupportedCommands(timeoutMs = 250): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0) {
      return Promise.resolve([...this.supportedCommands]);
    }

    return new Promise<SlashCommand[]>((resolve) => {
      const waiter = (commands: SlashCommand[]) => {
        window.clearTimeout(timeoutId);
        resolve([...commands]);
      };
      const timeoutId = window.setTimeout(() => {
        const index = this.supportedCommandWaiters.indexOf(waiter);
        if (index >= 0) {
          this.supportedCommandWaiters.splice(index, 1);
        }
        resolve([...this.supportedCommands]);
      }, timeoutMs);

      this.supportedCommandWaiters.push(waiter);
    });
  }

  private async readTextFile(
    request: AcpReadTextFileRequest,
  ): Promise<{ content: string }> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    const content = await fs.readFile(resolvedPath, 'utf-8');

    if (request.line === undefined && request.limit === undefined) {
      return { content };
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max(0, (request.line ?? 1) - 1);
    const endIndex = request.limit
      ? startIndex + Math.max(0, request.limit)
      : lines.length;

    return {
      content: lines.slice(startIndex, endIndex).join('\n'),
    };
  }

  private async writeTextFile(
    request: AcpWriteTextFileRequest,
  ): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await approveAcpWriteTextFile({
      approvalCallback: this.approvalCallback,
      fullAccess: coercePermissionMode(this.getProviderSettings().permissionMode) === 'full_access',
      providerLabel: 'Grok Build',
      requestPath: request.path,
      resolvedPath,
    });
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, request.content, 'utf-8');
    return {};
  }

  private resolveSessionPath(sessionId: string, rawPath: string): string {
    const cwd = this.sessionCwds.get(sessionId)
      ?? getVaultPath(this.plugin.app)
      ?? process.cwd();
    // Active (full-access) mode opts into unrestricted file access; safe and
    // plan modes confine ACP-delegated reads/writes to the session workspace.
    const allowOutsideWorkspace =
      coercePermissionMode(this.getProviderSettings().permissionMode) === 'full_access';
    return resolveWorkspacePath(cwd, rawPath, { allowOutsideWorkspace });
  }

  private formatRuntimeError(error: unknown): string {
    const stderr = this.process?.getStderrSnapshot() ?? '';
    if (stderr) {
      logGrokDebug(this.plugin, 'runtime.error.stderr', {
        stderrPreview: summarizeGrokCliText(stderr),
      }, {
        error,
        level: 'warn',
      });
    }

    const fallback = t('chat.ui.errors.provider.requestFailed', {
      provider: ProviderRegistry.getProviderDisplayNameOrId('grok'),
    });
    if (!(error instanceof Error)) {
      return fallback;
    }

    // Generic JSON-RPC strings like "Invalid params" are not actionable, and
    // accumulated CLI stderr (MCP spawn failures, ANSI rust logs) must stay in
    // debug logs rather than replace the user's question with a wall of noise.
    if (error instanceof JsonRpcErrorResponse && isGenericJsonRpcErrorMessage(error.message)) {
      return fallback;
    }

    return error.message.trim() || fallback;
  }

  private async prepareClosedTransportRetry(
    error: unknown,
    activeTurn: ActiveTurn,
    cwd: string,
  ): Promise<boolean> {
    // Grok runtime does not yet track lifecycleGeneration; gate only on
    // transport-close shape and whether output already started.
    if (!isAcpRetryableTransportClose(error) || activeTurn.sawOutput) {
      return false;
    }

    await this.shutdownProcess({ preserveActiveTurn: true });
    const ready = await this.ensureReady({ force: true, allowSessionCreation: false });
    if (!ready || !this.connection) {
      return false;
    }

    if (!this.sessionId) {
      return Boolean(await this.createSession(cwd));
    }

    return true;
  }

  private updateSessionPaths(sessionId: string, cwd: string): void {
    const sessionDirPath = resolveGrokSessionDirectory(
      sessionId,
      cwd,
      this.currentSessionDirPath,
      buildManagedGrokProcessEnv(cwd),
    );
    this.currentWorkspacePath = cwd;
    this.currentSessionDirPath = sessionDirPath;
  }

  private clearActiveSession(options?: { preserveSessionPaths?: boolean }): void {
    if (!options?.preserveSessionPaths) {
      this.currentSessionDirPath = null;
      this.currentWorkspacePath = null;
    }
    this.sessionId = null;
    this.loadedSessionId = null;
    this.currentSessionModelId = null;
    this.currentSessionModeConfigId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);
  }
}

function isGenericJsonRpcErrorMessage(message: string): boolean {
  return /^(invalid params|invalid request|method not found|parse error|internal error)$/i
    .test(message.trim());
}

function resolveGrokRestartReasons(params: {
  connection: AcpClientConnection | null;
  currentLaunchKey: string | null;
  force: boolean;
  nextLaunchKey: string;
  process: AcpSubprocess | null;
  transport: AcpJsonRpcTransport | null;
}): string[] {
  const reasons: string[] = [];
  if (!params.process) {
    reasons.push('missing_process');
  } else if (!params.process.isAlive()) {
    reasons.push('process_not_alive');
  }
  if (!params.transport) {
    reasons.push('missing_transport');
  } else if (params.transport.isClosed) {
    reasons.push('transport_closed');
  }
  if (!params.connection) {
    reasons.push('missing_connection');
  }
  if (params.force) {
    reasons.push('forced');
  }
  if (params.currentLaunchKey !== params.nextLaunchKey) {
    reasons.push('launch_key_changed');
  }
  return reasons;
}

function normalizeApprovalInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  if (rawInput === undefined) {
    return {};
  }
  return { value: rawInput };
}

function buildGrokPermissionPresentation(
  rawTitle: string | null | undefined,
  rawKind: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): {
  blockedPath?: string;
  decisionReason?: string;
  description: string;
  toolName: string;
} {
  const permissionId = normalizePermissionId(rawTitle, rawKind);
  const blockedPath = extractPermissionPath(input, locations);

  switch (permissionId) {
    case 'bash':
      return {
        decisionReason: 'Command execution permission required',
        description: 'Grok Build wants to run a shell command.',
        toolName: 'bash',
      };
    case 'codesearch':
      return {
        description: 'Grok Build wants to search indexed code outside the active buffer.',
        toolName: 'codesearch',
      };
    case 'doom_loop': {
      const repeatedTool = typeof input.tool === 'string' ? input.tool.trim() : '';
      return {
        decisionReason: 'Grok detected repeated identical tool calls',
        description: repeatedTool
          ? `Allow another repeated \`${repeatedTool}\` call.`
          : 'Allow another repeated tool call.',
        toolName: 'Doom Loop Guard',
      };
    }
    case 'edit':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'File write permission required',
        description: blockedPath
          ? 'Grok Build wants to modify this file.'
          : 'Grok Build wants to apply file changes.',
        toolName: 'edit',
      };
    case 'external_directory':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'Path is outside the session working directory',
        description: blockedPath
          ? 'Grok Build wants to access a path outside the working directory.'
          : 'Grok Build wants to access files outside the working directory.',
        toolName: 'External Directory',
      };
    case 'glob':
      return {
        description: 'Grok Build wants to scan file paths with a glob pattern.',
        toolName: 'glob',
      };
    case 'grep':
      return {
        description: 'Grok Build wants to search file contents with a pattern.',
        toolName: 'grep',
      };
    case 'lsp':
      return {
        description: 'Grok Build wants to query language server data.',
        toolName: 'lsp',
      };
    case 'plan_enter':
      return {
        description: 'Grok Build wants to switch this session into planning mode.',
        toolName: 'Enter Plan Mode',
      };
    case 'plan_exit':
      return {
        description: 'Grok Build wants to leave planning mode and resume implementation.',
        toolName: 'Exit Plan Mode',
      };
    case 'question':
      return {
        description: 'Grok Build wants to ask you a direct question before continuing.',
        toolName: 'Ask Question',
      };
    case 'read':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? 'Grok Build wants to read this path.'
          : 'Grok Build wants to read project files.',
        toolName: 'read',
      };
    case 'skill':
      return {
        description: 'Grok Build wants to load a skill into the current session.',
        toolName: 'skill',
      };
    case 'todowrite':
      return {
        description: 'Grok Build wants to update the shared task list.',
        toolName: 'todowrite',
      };
    case 'webfetch':
      return {
        description: 'Grok Build wants to fetch content from a URL.',
        toolName: 'webfetch',
      };
    case 'websearch':
      return {
        description: 'Grok Build wants to search the web.',
        toolName: 'websearch',
      };
    case 'workflow_tool_approval': {
      const summary = summarizeWorkflowTools(input);
      return {
        decisionReason: 'Session-level workflow approval requested',
        description: summary
          ? `Pre-approve workflow tools for this session: ${summary}.`
          : 'Pre-approve workflow tools for this session.',
        toolName: 'Workflow Approval',
      };
    }
    default:
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? `Grok wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
          : `Grok wants permission to use ${formatPermissionLabel(permissionId)}.`,
        toolName: formatPermissionLabel(permissionId),
      };
  }
}

function normalizePermissionId(
  value: string | null | undefined,
  rawKind?: string | null,
): string {
  const kind = rawKind?.trim().toLowerCase();
  if (kind === 'execute') return 'bash';
  if (kind === 'read' || kind === 'edit' || kind === 'search' || kind === 'fetch') return kind;

  const normalized = value?.trim().toLowerCase() || 'tool';
  if (/^(?:execute|run)(?:\s|$)/u.test(normalized)) return 'bash';
  return normalized;
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): string | undefined {
  const candidateKeys = ['filepath', 'filePath', 'path', 'parentDir'];
  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  for (const location of locations ?? []) {
    if (typeof location?.path === 'string') {
      const trimmed = location.path.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function summarizeWorkflowTools(input: Record<string, unknown>): string {
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const names = tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      return [];
    }

    const entry = tool as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return [];
    }

    let title = '';
    if (typeof entry.args === 'string') {
      try {
        const parsedArgs = JSON.parse(entry.args) as Record<string, unknown>;
        title = typeof parsedArgs.title === 'string'
          ? parsedArgs.title.trim()
          : typeof parsedArgs.name === 'string'
          ? parsedArgs.name.trim()
          : '';
      } catch {
        title = '';
      }
    }

    return [title ? `${name}: ${title}` : name];
  });

  if (names.length === 0) {
    return '';
  }

  if (names.length <= 3) {
    return names.join(', ');
  }

  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

function formatPermissionLabel(permissionId: string): string {
  return permissionId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function mapApprovalDecision(
  decision: ApprovalDecision,
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    optionId: string;
  }[],
): AcpRequestPermissionResponse {
  if (decision === 'allow') {
    return selectPermissionOption(options, ['allow_once', 'allow_always']);
  }

  if (decision === 'allow-always') {
    return selectPermissionOption(options, ['allow_always', 'allow_once']);
  }

  if (decision === 'deny') {
    return selectPermissionOption(options, ['reject_once', 'reject_always']);
  }

  if (typeof decision === 'object' && decision.type === 'select-option') {
    return {
      outcome: {
        optionId: decision.value,
        outcome: 'selected',
      },
    };
  }

  return { outcome: { outcome: 'cancelled' } };
}

function buildAcpApprovalDecisionOptions(
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    name: string;
    optionId: string;
  }[],
): ApprovalDecisionOption[] {
  return options.map((option) => ({
    label: option.name,
    presentation: option.kind === 'allow_once'
      ? 'allow'
      : option.kind === 'allow_always'
      ? 'always'
      : 'reject',
    value: option.optionId,
  }));
}

function selectPermissionOption(
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    optionId: string;
  }[],
  preferredKinds: readonly ('allow_once' | 'allow_always' | 'reject_once' | 'reject_always')[],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return {
        outcome: {
          optionId: option.optionId,
          outcome: 'selected',
        },
      };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}
