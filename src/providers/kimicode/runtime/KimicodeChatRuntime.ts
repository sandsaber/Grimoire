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
  buildAcpApprovalDecisionOptions,
  buildAcpPersistedSessionFields,
  buildAcpSessionLoadFailureDebugEvent,
  buildAcpUsageInfo,
  isAcpMissingSessionError,
  isAcpRetryableTransportClose,
  mapAcpApprovalDecision,
  planAcpEnsureReadySessionPhase,
  resolveWorkspacePath,
  runAcpEnsureReadyForQuery,
  shouldRetryAcpClosedTransport,
} from '../../acp';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import { kimicodePlanUsageStore } from '../app/KimicodePlanUsageStore';
import { KIMICODE_PROVIDER_CAPABILITIES } from '../capabilities';
import {
  buildKimicodePermissionPresentation,
  normalizeApprovalInput,
} from '../execution/KimicodePermissionPresentation';
import { KimicodeSessionConfigState } from '../execution/KimicodeSessionConfigState';
import { loadKimicodeSessionCost } from '../history/KimicodeUsageMetadataStore';
import {
  decodeKimicodeModelId,
  resolveKimicodeBaseModelRawId,
} from '../models';
import { createKimicodeToolStreamAdapter } from '../normalization/kimicodeToolNormalization';
import { getKimicodeProviderSettings } from '../settings';
import { getKimicodeState, type KimicodeProviderState } from '../types';
import { buildKimicodePromptBlocks, buildKimicodePromptText } from './buildKimicodePrompt';
import { prepareKimicodeLaunchArtifacts } from './KimicodeLaunchArtifacts';
import { buildKimicodeRuntimeEnv } from './KimicodeRuntimeEnvironment';

interface ActiveTurn {
  lifecycleGeneration: number;
  queue: StreamChunkQueue;
  sawOutput: boolean;
  sessionId: string;
}

interface KimicodeEnsureReadyOptions extends ChatRuntimeEnsureReadyOptions {
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

/** How many sessions a runtime remembers a working directory for. */
const KIMICODE_SESSION_CWD_LIMIT = 256;

export class KimicodeChatRuntime implements ChatRuntime {
  readonly providerId = 'kimicode' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private contextUsage: AcpUsageUpdate | null = null;
  private currentDatabasePath: string | null = null;
  private currentLaunchKey: string | null = null;
  /**
   * What the live session is configured with, and what the vault knows of it.
   *
   * Moved out whole rather than copied: the flip needs the same answers from a
   * composition that has no runtime, and two copies of this would be two
   * opinions about which model a turn runs under.
   */
  private readonly sessionConfig = new KimicodeSessionConfigState({
    settingsBag: () => this.plugin.settings,
    saveSettings: () => this.plugin.saveSettings(),
    refreshSelectors: () => { this.refreshModelSelectors(); },
    syncPermissionMode: (permissionMode) => { this.emitPermissionModeSync(permissionMode); },
  });
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

  /**
   * Remembers where a session runs, without remembering every session ever.
   *
   * A runtime lives as long as its tab, and this map only ever grew: a working
   * day of resumed conversations kept a directory for each. What it is read for
   * is the session a request just arrived on.
   */
  private setSessionCwd(sessionId: string, cwd: string): void {
    this.sessionCwds.set(sessionId, cwd);
    trimOldestMapEntries(this.sessionCwds, KIMICODE_SESSION_CWD_LIMIT);
  }
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStreamAdapter = createKimicodeToolStreamAdapter();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(
    private readonly plugin: GrimoirePlugin,
  ) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return KIMICODE_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: buildKimicodePromptText(request),
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
      this.sessionConfig.forgetSession();
      this.sessionInvalidated = false;
      this.setSupportedCommands([]);
    }
    this.sessionId = nextSessionId;
    const state = getKimicodeState(conversation?.providerState);
    if (state.databasePath) {
      this.currentDatabasePath = state.databasePath;
      return;
    }

    if (!nextSessionId || nextSessionId !== previousSessionId) {
      this.currentDatabasePath = null;
    }
  }

  async reloadMcpServers(): Promise<void> {
    await ProviderWorkspaceRegistry.getMcpServerManager('kimicode')?.loadServers();
    await this.shutdownProcess();
  }

  async warmModelMetadata(model: string): Promise<boolean> {
    const selectedRawModelId = decodeKimicodeModelId(model);
    if (!selectedRawModelId) {
      return false;
    }

    if (!(await this.ensureReady({ allowSessionCreation: true }))) {
      return false;
    }
    if (!this.connection || !this.sessionId) {
      return false;
    }

    const discoveredModels = getKimicodeProviderSettings(this.plugin.settings).discoveredModels;
    const selectedBaseRawModelId = resolveKimicodeBaseModelRawId(selectedRawModelId, discoveredModels);
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
    this.sessionConfig.markApplied({ modelId: selectedBaseRawModelId });
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    }, {
      currentRawModelId: selectedBaseRawModelId,
      seedActiveSelection: false,
    });
    return true;
  }

  async ensureReady(options?: KimicodeEnsureReadyOptions): Promise<boolean> {
    await this.cleanupPromise;
    const lifecycleGeneration = this.lifecycleGeneration;
    const settings = getKimicodeProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const targetSessionId = this.sessionId;
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('kimicode') ?? 'kimi';
    const runtimeEnv = this.buildRuntimeEnv(
      resolvedCliPath,
      this.currentDatabasePath,
    );
    const promptSettings = this.getSystemPromptSettings(cwd);
    const artifacts = await prepareKimicodeLaunchArtifacts({
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
      envText: getRuntimeEnvironmentText(this.plugin.settings, 'kimicode'),
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
      yield { type: 'error', content: t('chat.ui.errors.provider.startFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') }) };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: t('chat.ui.errors.provider.notReady', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') }) };
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
        yield { type: 'error', content: t('chat.ui.errors.provider.sessionCreateFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') }) };
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
      this.currentTurnMetadata.wasSent = true;
      const response = await this.connection!.prompt({
        prompt: buildKimicodePromptBlocks(
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
      if (!activeTurn.sawOutput && response.stopReason && !/cancel/i.test(response.stopReason)) {
        activeTurn.queue.push({
          type: 'error',
          content: t('chat.ui.errors.provider.emptyResponse', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') }),
        });
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
      ? getKimicodeState(params.conversation.providerState)
      : null;
    const fields = buildAcpPersistedSessionFields({
      conversationDatabasePath: existingState?.databasePath,
      currentDatabasePath: this.currentDatabasePath,
      sessionId: this.sessionId,
      sessionInvalidated: params.sessionInvalidated,
    });
    const providerState: KimicodeProviderState = {
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
      KIMICODE_CONFIG: params.configPath,
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
    this.sessionConfig.forgetProcessSelection();
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
    return buildKimicodeRuntimeEnv(
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
    return this.sessionConfig.resolveSelectedRawModelId(queryOptions);
  }

  getAuxiliaryModel(): string | null {
    return this.getActiveDisplayModel() ?? null;
  }

  private getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    return this.sessionConfig.getActiveDisplayModel(queryOptions);
  }

  private resolveSelectedModeId(): string | null {
    return this.sessionConfig.resolveSelectedModeId();
  }

  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedModeId = this.resolveSelectedModeId();
    if (!selectedModeId || selectedModeId === this.sessionConfig.sessionModeId) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: 'mode',
      sessionId,
      type: 'select',
      value: selectedModeId,
    });
    this.sessionConfig.markApplied({ modeId: selectedModeId });
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
    if (!selectedRawModelId || selectedRawModelId === this.sessionConfig.sessionModelId) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: 'model',
      sessionId,
      type: 'select',
      value: selectedRawModelId,
    });
    this.sessionConfig.markApplied({ modelId: selectedRawModelId });
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    }, {
      currentRawModelId: selectedRawModelId,
    });
  }

  private resolveSelectedEffortValue(): string | null {
    return this.sessionConfig.resolveSelectedEffortValue();
  }

  private async applySelectedEffort(sessionId: string): Promise<void> {
    if (!this.connection || !this.sessionConfig.effortConfigId) {
      return;
    }

    const selectedEffort = this.resolveSelectedEffortValue();
    if (!selectedEffort || selectedEffort === this.sessionConfig.effortValue) {
      return;
    }

    const response = await this.connection.setConfigOption({
      configId: this.sessionConfig.effortConfigId,
      sessionId,
      type: 'select',
      value: selectedEffort,
    });
    this.sessionConfig.markApplied({ effortValue: selectedEffort });
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
    await this.sessionConfig.syncSessionModelState(params, options);
  }

  private async syncSessionModeState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    currentModeId?: string | null;
    emitPermissionSync?: boolean;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    await this.sessionConfig.syncSessionModeState(params);
  }

  private refreshModelSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  private emitPermissionModeSync(permissionMode: 'normal' | 'plan' | 'full_access'): void {
    if (!this.permissionModeSyncCallback) {
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
      this.setSessionCwd(response.sessionId, cwd);
      await this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.syncSessionModeState({
        configOptions: response.configOptions ?? null,
        emitPermissionSync: false,
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
      // The id that was asked for, where the agent does not echo one: a
      // load confirms the session by succeeding, and a sibling ACP agent
      // answers with config options and nothing else.
      const boundSessionId = response.sessionId ?? sessionId;
      this.loadedSessionId = boundSessionId;
      this.sessionId = boundSessionId;
      this.setSessionCwd(boundSessionId, cwd);
      await this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.syncSessionModeState({
        configOptions: response.configOptions ?? null,
        emitPermissionSync: false,
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
      providerId: 'kimicode',
      sessionId,
      stderr,
    }));
    // Keep databasePath so SQLite hydrate / native DB env still resolve.
    this.sessionInvalidated = true;
    this.clearActiveSession({ preserveDatabasePath: true });
  }

  private getMcpServers() {
    const servers = ProviderWorkspaceRegistry.getMcpServerManager('kimicode')?.getServers() ?? [];
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
        if (kimicodePlanUsageStore.recordCost(normalized.usage.cost ?? null)) {
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

    const cost = await loadKimicodeSessionCost(sessionId, {
      databasePath: this.currentDatabasePath ?? undefined,
    });
    if (kimicodePlanUsageStore.recordSessionTotalCost(sessionId, cost)) {
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
    const presentation = buildKimicodePermissionPresentation(request.toolCall.title, input, request.toolCall.locations);
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

    return mapAcpApprovalDecision(decision, request.options);
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
      providerLabel: 'Kimi Code',
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
      return 'Kimi connection closed unexpectedly. Please retry; Grimoire will reconnect automatically.';
    }
    const baseMessage = error instanceof Error ? error.message : t('chat.ui.errors.provider.requestFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') });
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

  private clearActiveSession(options?: { preserveDatabasePath?: boolean }): void {
    if (!options?.preserveDatabasePath) {
      this.currentDatabasePath = null;
    }
    this.sessionId = null;
    this.loadedSessionId = null;
    this.sessionConfig.forgetProcessSelection();
    this.setSupportedCommands([]);
  }
}

/** Keeps a per-session lookup bounded, oldest first. */
function trimOldestMapEntries<K, V>(map: Map<K, V>, maximum: number): void {
  while (map.size > maximum) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    map.delete(oldest);
  }
}
