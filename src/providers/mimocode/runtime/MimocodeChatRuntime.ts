import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

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
  buildAcpPersistedSessionFields,
  buildAcpSessionLoadFailureDebugEvent,
  buildAcpUsageInfo,
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  extractAcpSessionThoughtLevelState,
  isAcpMissingSessionError,
  isAcpRetryableTransportClose,
  planAcpEnsureReadySessionPhase,
  resolveWorkspacePath,
  runAcpEnsureReadyForQuery,
  shouldRetryAcpClosedTransport,
} from '../../acp';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import { mimocodePlanUsageStore } from '../app/MimocodePlanUsageStore';
import { MIMOCODE_PROVIDER_CAPABILITIES } from '../capabilities';
import { updateMimocodeDiscoveryState } from '../discoveryState';
import {
  formatMimocodeSessionError,
  loadLatestMimocodeSessionError,
} from '../history/MimocodeSessionErrorStore';
import { loadMimocodeSessionCost } from '../history/MimocodeUsageMetadataStore';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
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
  resolveMimocodeUnsupportedModelFallback,
} from '../models';
import {
  getManagedMimocodeModes,
  isManagedMimocodeModeId,
  normalizeMimocodeAvailableModes,
  resolveMimocodeModeForPermissionMode,
  resolvePermissionModeForManagedMimocodeMode,
} from '../modes';
import { createMimocodeToolStreamAdapter } from '../normalization/mimocodeToolNormalization';
import { getMimocodeProviderSettings, updateMimocodeProviderSettings } from '../settings';
import { getMimocodeState, type MimocodeProviderState } from '../types';
import { buildMimocodePromptBlocks, buildMimocodePromptText } from './buildMimocodePrompt';
import { prepareMimocodeLaunchArtifacts } from './MimocodeLaunchArtifacts';
import { buildMimocodeRuntimeEnv } from './MimocodeRuntimeEnvironment';

interface ActiveTurn {
  lifecycleGeneration: number;
  queue: StreamChunkQueue;
  sawOutput: boolean;
  sessionId: string;
}

interface MimocodeEnsureReadyOptions extends ChatRuntimeEnsureReadyOptions {
  preserveActiveTurn?: boolean;
}

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    if (this.closed) {
      return;
    }
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

export class MimocodeChatRuntime implements ChatRuntime {
  readonly providerId = 'mimocode' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private contextUsage: AcpUsageUpdate | null = null;
  private currentDatabasePath: string | null = null;
  private currentLaunchKey: string | null = null;
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;
  private currentTurnSawAcpCost = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private cleanupPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private loadedSessionId: string | null = null;
  private permissionModeSyncCallback: ((mode: string) => void) | null = null;
  private process: AcpSubprocess | null = null;
  private promptUsage: AcpUsage | null = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private sessionInvalidated = false;
  private lastSessionLoadError: unknown = null;
  private readonly supportedCommandWaiters: Array<(commands: SlashCommand[]) => void> = [];
  private supportedCommands: SlashCommand[] = [];
  private sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStreamAdapter = createMimocodeToolStreamAdapter();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(
    private readonly plugin: LegacyProviderContext,
  ) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return MIMOCODE_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: buildMimocodePromptText(request),
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
      this.currentSessionModeId = null;
      this.sessionInvalidated = false;
      this.setSupportedCommands([]);
    }
    this.sessionId = nextSessionId;
    const state = getMimocodeState(conversation?.providerState);
    if (state.databasePath) {
      this.currentDatabasePath = state.databasePath;
      return;
    }

    if (!nextSessionId || nextSessionId !== previousSessionId) {
      this.currentDatabasePath = null;
    }
  }

  async reloadMcpServers(): Promise<void> {
    await ProviderWorkspaceRegistry.getMcpServerManager('mimocode')?.loadServers();
    await this.shutdownProcess();
  }

  async warmModelMetadata(model: string): Promise<boolean> {
    const selectedRawModelId = decodeMimocodeModelId(model);
    if (!selectedRawModelId) {
      return false;
    }

    if (!(await this.ensureReady({ allowSessionCreation: true }))) {
      return false;
    }
    if (!this.connection || !this.sessionId) {
      return false;
    }

    const discoveredModels = getMimocodeProviderSettings(this.plugin.settings).discoveredModels;
    const selectedBaseRawModelId = resolveMimocodeBaseModelRawId(selectedRawModelId, discoveredModels);
    if (!selectedBaseRawModelId) {
      return false;
    }

    const availableModelIds = new Set(discoveredModels.map((entry) => entry.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(selectedBaseRawModelId)) {
      return false;
    }

    const response = await this.connection.setConfigOption({
      configId: 'model',
      sessionId: this.sessionId,
      type: 'select',
      value: selectedBaseRawModelId,
    });
    this.currentSessionModelId = selectedBaseRawModelId;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    }, {
      currentRawModelId: selectedBaseRawModelId,
      seedActiveSelection: false,
    });
    return true;
  }

  async ensureReady(options?: MimocodeEnsureReadyOptions): Promise<boolean> {
    await this.cleanupPromise;
    const lifecycleGeneration = this.lifecycleGeneration;
    const settings = getMimocodeProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const targetSessionId = this.sessionId;
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('mimocode') ?? 'mimo';
    const runtimeEnv = this.buildRuntimeEnv(
      resolvedCliPath,
      this.currentDatabasePath,
    );
    const promptSettings = this.getSystemPromptSettings(cwd);
    const artifacts = await prepareMimocodeLaunchArtifacts({
      runtimeEnv,
      settings: promptSettings,
      workspaceRoot: cwd,
    });
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      return false;
    }
    this.currentDatabasePath = artifacts.databasePath;

    const nextLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      configPath: artifacts.configPath,
      envText: getRuntimeEnvironmentText(this.plugin.settings, 'mimocode'),
      promptKey: computeSystemPromptKey(promptSettings),
      artifactKey: artifacts.launchKey,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== nextLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess({ preserveActiveTurn: options?.preserveActiveTurn });
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        return false;
      }
      await this.startProcess({
        command: resolvedCliPath,
        configPath: artifacts.configPath,
        cwd,
        runtimeEnv,
      });
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        await this.cleanupPromise;
        return false;
      }
      this.currentLaunchKey = nextLaunchKey;
      this.loadedSessionId = null;
    }

    const sessionPhase = planAcpEnsureReadySessionPhase({
      allowSessionCreation: options?.allowSessionCreation !== false,
      loadedSessionId: this.loadedSessionId,
      sessionId: this.sessionId,
      sessionInvalidated: this.sessionInvalidated,
      targetSessionId,
    });
    if (sessionPhase.type === 'load') {
      const loaded = await this.loadSession(sessionPhase.sessionId, cwd);
      if (!loaded) {
        this.handleSessionLoadFailure(sessionPhase.sessionId, cwd);
      }
      return true;
    }
    if (sessionPhase.type === 'create') {
      return Boolean(await this.createSession(cwd));
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
    let shouldBootstrapHistory = previousMessages.length > 0
      && (!expectedSessionId || this.sessionInvalidated);

    const lifecycleGeneration = this.lifecycleGeneration;
    if (!(await this.ensureReadyForQuery(lifecycleGeneration))) {
      yield { type: 'error', content: t('chat.ui.errors.provider.startFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('mimocode') }) };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: t('chat.ui.errors.provider.notReady', { provider: ProviderRegistry.getProviderDisplayNameOrId('mimocode') }) };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    if (expectedSessionId && !this.sessionId) {
      shouldBootstrapHistory = previousMessages.length > 0;
    }

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        yield { type: 'error', content: t('chat.ui.errors.provider.sessionCreateFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('mimocode') }) };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId!;
    this.activeTurn?.queue.close();
    this.activeTurn = {
      lifecycleGeneration,
      queue: new StreamChunkQueue(),
      sawOutput: false,
      sessionId,
    };
    this.currentTurnMetadata = {};
    this.currentTurnSawAcpCost = false;
    this.contextUsage = null;
    this.promptUsage = null;
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
      const promptStartedAt = Date.now();
      this.currentTurnMetadata.wasSent = true;
      const response = await this.connection!.prompt({
        prompt: buildMimocodePromptBlocks(
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
      if (!activeTurn.sawOutput) {
        const storedError = await loadLatestMimocodeSessionError(
          promptSessionId,
          { databasePath: this.currentDatabasePath ?? undefined },
          promptStartedAt,
          response.userMessageId,
        );
        if (storedError) {
          const fallbackModel = this.resolveUnsupportedModelFallback(storedError.message);
          if (fallbackModel) {
            await this.persistFallbackModelSelection(fallbackModel);
            activeTurn.queue.push({
              type: 'error',
              content: `MiMo does not support the selected model for this plan. Grimoire switched to ${fallbackModel}; retry the message.`,
            });
          } else {
            activeTurn.queue.push({
              type: 'error',
              content: formatMimocodeSessionError(storedError),
            });
          }
        } else if (response.stopReason && !/cancel/i.test(response.stopReason)) {
          activeTurn.queue.push({
            type: 'error',
            content: t('chat.ui.errors.provider.emptyResponse', {
              provider: ProviderRegistry.getProviderDisplayNameOrId('mimocode'),
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
    this.lifecycleGeneration += 1;
    this.activeTurn?.queue.close();
    const cleanupPromise = this.shutdownProcess().finally(() => {
      if (this.cleanupPromise === cleanupPromise) {
        this.cleanupPromise = null;
      }
    });
    this.cleanupPromise = cleanupPromise;
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

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
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
      ? getMimocodeState(params.conversation.providerState)
      : null;
    const fields = buildAcpPersistedSessionFields({
      conversationDatabasePath: existingState?.databasePath,
      currentDatabasePath: this.currentDatabasePath,
      sessionId: this.sessionId,
      sessionInvalidated: params.sessionInvalidated,
    });
    const providerState: MimocodeProviderState = {
      ...(fields.databasePath ? { databasePath: fields.databasePath } : {}),
    };
    return {
      updates: {
        providerState: Object.keys(providerState).length > 0
          ? providerState as Record<string, unknown>
          : undefined,
        sessionId: fields.sessionId,
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
    configPath: string;
    cwd: string;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    const processEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...params.runtimeEnv,
      MIMOCODE_CONFIG: params.configPath,
      PATH: getEnhancedPath(
        params.runtimeEnv.PATH,
        path.isAbsolute(params.command) ? params.command : undefined,
      ),
    };

    this.process = new AcpSubprocess({
      args: ['acp'],
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

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'grimoire',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(request),
        },
        onSessionNotification: (notification) => this.handleSessionNotification(notification),
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
    this.setReady(true);
  }

  private async shutdownProcess(options?: { preserveActiveTurn?: boolean }): Promise<void> {
    this.setReady(false);
    if (!options?.preserveActiveTurn) {
      this.activeTurn?.queue.close();
      this.activeTurn = null;
    }
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
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
    databasePathOverride?: string | null,
  ): NodeJS.ProcessEnv {
    return buildMimocodeRuntimeEnv(
      this.plugin.settings,
      cliPath,
      databasePathOverride,
    );
  }

  private getProviderSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.getProviderSettings();
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

  private resolveSelectedModeId(): string | null {
    const providerSettings = this.getProviderSettings();
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

  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedModeId = this.resolveSelectedModeId();
    if (!selectedModeId || selectedModeId === this.currentSessionModeId) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: 'mode',
      sessionId,
      type: 'select',
      value: selectedModeId,
    });
    this.currentSessionModeId = selectedModeId;
    await this.syncSessionModeState({
      configOptions: response.configOptions,
    });
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

    const response = await this.connection.setConfigOption({
      configId: 'model',
      sessionId,
      type: 'select',
      value: selectedRawModelId,
    });
    this.currentSessionModelId = selectedRawModelId;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    }, {
      currentRawModelId: selectedRawModelId,
    });
  }

  private resolveSelectedEffortValue(): string | null {
    const providerSettings = this.getProviderSettings();
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

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
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
      await this.plugin.saveSettings();
    }
    this.refreshModelSelectors();
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

    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) !== this.providerId) {
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

  private async syncSessionModeState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    currentModeId?: string | null;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModeState(params);
    const availableModes = normalizeMimocodeAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
      this.emitPermissionModeSync(currentModeId);
    }

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
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
      await this.plugin.saveSettings();
    }
    this.refreshModelSelectors();
  }

  private refreshModelSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  private emitPermissionModeSync(modeId: string): void {
    const permissionMode = resolvePermissionModeForManagedMimocodeMode(modeId);
    if (!permissionMode || !this.permissionModeSyncCallback) {
      return;
    }

    try {
      this.permissionModeSyncCallback(permissionMode);
    } catch {
      // Non-critical UI sync callback.
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
      await this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.syncSessionModeState({
        configOptions: response.configOptions ?? null,
        modes: response.modes ?? null,
      });
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string, cwd: string): Promise<boolean> {
    if (!this.connection) {
      return false;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.loadSession({
        cwd,
        mcpServers: this.getMcpServers(),
        sessionId,
      });
      this.sessionInvalidated = false;
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      await this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.syncSessionModeState({
        configOptions: response.configOptions ?? null,
        modes: response.modes ?? null,
      });
      return true;
    } catch (error) {
      if (!isAcpMissingSessionError(error)) {
        throw error;
      }
      this.lastSessionLoadError = error;
      return false;
    }
  }

  private handleSessionLoadFailure(sessionId: string, cwd: string): void {
    const error = this.lastSessionLoadError;
    this.lastSessionLoadError = null;
    const stderr = this.process?.getStderrSnapshot();
    // Soft-fail resume: preserve history / DB path and open a new session next
    // turn. Debug log only — no user-facing toast (recovery is automatic).
    this.plugin.recordDebugLog?.(buildAcpSessionLoadFailureDebugEvent({
      cwd,
      databasePath: this.currentDatabasePath,
      error,
      providerId: 'mimocode',
      sessionId,
      stderr,
    }));
    // Keep databasePath so SQLite hydrate / native DB env still resolve.
    this.sessionInvalidated = true;
    this.clearActiveSession({ preserveDatabasePath: true });
  }

  private getMcpServers() {
    const servers = ProviderWorkspaceRegistry.getMcpServerManager('mimocode')?.getServers() ?? [];
    return toAcpMcpServers(servers);
  }

  private async handleSessionNotification(
    notification: AcpSessionNotification,
  ): Promise<void> {
    if (notification.sessionId !== this.sessionId) {
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
        if (mimocodePlanUsageStore.recordCost(normalized.usage.cost ?? null)) {
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

  private async refreshFallbackPlanUsageFromSessionCost(sessionId: string): Promise<void> {
    if (this.currentTurnSawAcpCost) {
      return;
    }

    const cost = await loadMimocodeSessionCost(sessionId, {
      databasePath: this.currentDatabasePath ?? undefined,
    });
    if (mimocodePlanUsageStore.recordSessionTotalCost(sessionId, cost)) {
      this.refreshModelSelectors();
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildMimocodePermissionPresentation(request.toolCall.title, input, request.toolCall.locations);
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
      providerLabel: 'MiMoCode',
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
    if (this.isRetryableTransportClose(error)) {
      return 'MiMo connection closed unexpectedly. Please retry; Grimoire will reconnect automatically.';
    }
    const baseMessage = error instanceof Error ? error.message : t('chat.ui.errors.provider.requestFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('mimocode') });
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private async prepareClosedTransportRetry(
    error: unknown,
    activeTurn: ActiveTurn,
    cwd: string,
  ): Promise<boolean> {
    if (!shouldRetryAcpClosedTransport({
      activeLifecycleGeneration: activeTurn.lifecycleGeneration,
      error,
      runtimeLifecycleGeneration: this.lifecycleGeneration,
      sawOutput: activeTurn.sawOutput,
    })) {
      return false;
    }

    await this.shutdownProcess({ preserveActiveTurn: true });
    const ready = await this.ensureReady({
      force: true,
      allowSessionCreation: false,
      preserveActiveTurn: true,
    });
    if (!ready || !this.connection) {
      return false;
    }

    if (!this.sessionId) {
      return Boolean(await this.createSession(cwd));
    }

    return true;
  }

  private async ensureReadyForQuery(lifecycleGeneration: number): Promise<boolean> {
    const result = await runAcpEnsureReadyForQuery({
      ensureReady: (options) => (
        options === undefined ? this.ensureReady() : this.ensureReady(options)
      ),
      isLifecycleCurrent: (generation) => generation === this.lifecycleGeneration,
      isRetryableTransportClose: (error) => this.isRetryableTransportClose(error),
      lifecycleGeneration,
    });
    return result.ready && !result.stale;
  }

  private isRetryableTransportClose(error: unknown): boolean {
    return isAcpRetryableTransportClose(error);
  }

  private resolveUnsupportedModelFallback(errorMessage: string): string | null {
    const unsupportedMatch = errorMessage.match(/not supported model\s+([^\s]+)/i);
    if (!unsupportedMatch) {
      return null;
    }

    const providerSettings = getMimocodeProviderSettings(this.getProviderSettings());
    return resolveMimocodeUnsupportedModelFallback(
      unsupportedMatch[1],
      providerSettings.visibleModels.length > 0
        ? providerSettings.visibleModels
        : providerSettings.discoveredModels.map(model => model.rawId),
    );
  }

  private async persistFallbackModelSelection(rawModelId: string): Promise<void> {
    const modelSelection = encodeMimocodeModelId(rawModelId);
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const savedProviderModel = ensureProviderProjectionMap(settingsBag, 'savedProviderModel');
    savedProviderModel.mimocode = modelSelection;
    settingsBag.model = modelSelection;
    // Force the next turn to send set_config_option; the failed ACP session is
    // still bound to the rejected model until the provider confirms the fallback.
    this.currentSessionModelId = null;
    await this.plugin.saveSettings();
    this.refreshModelSelectors();
  }

  private clearActiveSession(options?: { preserveDatabasePath?: boolean }): void {
    if (!options?.preserveDatabasePath) {
      this.currentDatabasePath = null;
    }
    this.sessionId = null;
    this.loadedSessionId = null;
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);
  }
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

function buildMimocodePermissionPresentation(
  rawTitle: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): {
  blockedPath?: string;
  decisionReason?: string;
  description: string;
  toolName: string;
} {
  const permissionId = normalizePermissionId(rawTitle);
  const blockedPath = extractPermissionPath(input, locations);

  switch (permissionId) {
    case 'bash':
      return {
        decisionReason: 'Command execution permission required',
        description: 'MiMoCode wants to run a shell command.',
        toolName: 'bash',
      };
    case 'codesearch':
      return {
        description: 'MiMoCode wants to search indexed code outside the active buffer.',
        toolName: 'codesearch',
      };
    case 'doom_loop': {
      const repeatedTool = typeof input.tool === 'string' ? input.tool.trim() : '';
      return {
        decisionReason: 'MiMoCode detected repeated identical tool calls',
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
          ? 'MiMoCode wants to modify this file.'
          : 'MiMoCode wants to apply file changes.',
        toolName: 'edit',
      };
    case 'external_directory':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'Path is outside the session working directory',
        description: blockedPath
          ? 'MiMoCode wants to access a path outside the working directory.'
          : 'MiMoCode wants to access files outside the working directory.',
        toolName: 'External Directory',
      };
    case 'glob':
      return {
        description: 'MiMoCode wants to scan file paths with a glob pattern.',
        toolName: 'glob',
      };
    case 'grep':
      return {
        description: 'MiMoCode wants to search file contents with a pattern.',
        toolName: 'grep',
      };
    case 'lsp':
      return {
        description: 'MiMoCode wants to query language server data.',
        toolName: 'lsp',
      };
    case 'plan_enter':
      return {
        description: 'MiMoCode wants to switch this session into planning mode.',
        toolName: 'Enter Plan Mode',
      };
    case 'plan_exit':
      return {
        description: 'MiMoCode wants to leave planning mode and resume implementation.',
        toolName: 'Exit Plan Mode',
      };
    case 'question':
      return {
        description: 'MiMoCode wants to ask you a direct question before continuing.',
        toolName: 'Ask Question',
      };
    case 'read':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? 'MiMoCode wants to read this path.'
          : 'MiMoCode wants to read project files.',
        toolName: 'read',
      };
    case 'skill':
      return {
        description: 'MiMoCode wants to load a skill into the current session.',
        toolName: 'skill',
      };
    case 'todowrite':
      return {
        description: 'MiMoCode wants to update the shared task list.',
        toolName: 'todowrite',
      };
    case 'webfetch':
      return {
        description: 'MiMoCode wants to fetch content from a URL.',
        toolName: 'webfetch',
      };
    case 'websearch':
      return {
        description: 'MiMoCode wants to search the web.',
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
          ? `MiMoCode wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
          : `MiMoCode wants permission to use ${formatPermissionLabel(permissionId)}.`,
        toolName: formatPermissionLabel(permissionId),
      };
  }
}

function normalizePermissionId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || 'tool';
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

  const locationPath = locations
    ?.map((location) => (typeof location?.path === 'string' ? location.path.trim() : ''))
    .find((path) => path.length > 0);
  return locationPath?.trim() || undefined;
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
