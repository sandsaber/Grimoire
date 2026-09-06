import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { applyOrchestratorModeInstructions } from '../../../core/prompt/mainAgent';
import { hashCatalogFingerprint } from '../../../core/providers/catalogFingerprint';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCapabilities } from '../../../core/providers/types';
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
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  ImageAttachment,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import {
  appendContextFiles,
  appendCurrentNote,
  appendExcludedFoldersContext,
  appendProjectWorkspaceContext,
  appendVaultSearchContext,
} from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { getVaultPath } from '../../../utils/path';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import {
  AcpClientConnection,
  type AcpContentBlock,
  AcpJsonRpcTransport,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  type AcpWriteTextFileRequest,
  approveAcpWriteTextFile,
  buildAcpApprovalDecisionOptions,
  buildAcpUsageInfo,
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  isAcpSessionGone,
  mapAcpApprovalDecision,
  resolveWorkspacePath,
} from '../../acp';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import { geminiPlanUsageStore } from '../app/GeminiPlanUsageStore';
import { GEMINI_PROVIDER_CAPABILITIES } from '../capabilities';
import { resolveGeminiModelCatalogFingerprint } from '../modelCatalogFingerprint';
import {
  decodeGeminiModelId,
  encodeGeminiModelId,
  GEMINI_SYNTHETIC_MODEL_ID,
} from '../models';
import {
  type GeminiDiscoveredModel,
  type GeminiMode,
  getGeminiProviderSettings,
  updateGeminiProviderSettings,
} from '../settings';
import { getGeminiState } from '../types';
import { buildGeminiRuntimeEnv } from './GeminiRuntimeEnvironment';

interface ActiveTurn {
  queue: StreamChunkQueue;
  sessionId: string;
}

interface GeminiLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  runtimeEnv: NodeJS.ProcessEnv;
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

export class GeminiChatRuntime implements ChatRuntime {
  readonly providerId = 'gemini' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private contextUsage: Parameters<typeof buildAcpUsageInfo>[0]['contextWindow'] = null;
  private currentSessionModelId: string | null = null;
  private currentLaunchKey: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private loadedSessionId: string | null = null;
  private process: AcpSubprocess | null = null;
  private promptUsage: Parameters<typeof buildAcpUsageInfo>[0]['promptUsage'] = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private sessionCwds = new Map<string, string>();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(private readonly plugin: GrimoirePlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return GEMINI_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    const prompt = buildGeminiPromptText(request);

    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: prompt,
      prompt,
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

  syncConversationState(conversation: { providerState?: Record<string, unknown>; sessionId?: string | null } | null): void {
    const nextSessionId = conversation?.sessionId ?? null;
    if (this.sessionId !== nextSessionId) {
      this.sessionInvalidated = false;
      this.currentSessionModelId = null;
    }
    this.sessionId = nextSessionId;
    if (!nextSessionId && getGeminiState(conversation?.providerState).sessionDropped) {
      this.sessionInvalidated = true;
    }
  }

  async reloadMcpServers(): Promise<void> {
    await ProviderWorkspaceRegistry.getMcpServerManager('gemini')?.loadServers();
    await this.shutdownProcess();
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getGeminiProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('gemini') ?? 'gemini';
    const runtimeEnv = buildGeminiRuntimeEnv(this.plugin.settings, resolvedCliPath);
    const nextLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      env: settings.environmentVariables,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== nextLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      await this.startProcess({
        args: ['--acp'],
        command: resolvedCliPath,
        cwd,
        runtimeEnv,
      });
      this.currentLaunchKey = nextLaunchKey;
      this.loadedSessionId = null;
    }

    if (this.sessionId) {
      if (this.loadedSessionId !== this.sessionId) {
        const loaded = await this.loadSession(this.sessionId, cwd);
        if (!loaded) {
          this.sessionInvalidated = true;
          this.clearActiveSession();
        }
      }
      return true;
    }

    if (!this.sessionId && !this.sessionInvalidated) {
      if (options?.allowSessionCreation === false) {
        return true;
      }
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
      yield { type: 'error', content: t('chat.ui.errors.provider.startFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('gemini') }) };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: t('chat.ui.errors.provider.notReady', { provider: ProviderRegistry.getProviderDisplayNameOrId('gemini') }) };
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
        yield { type: 'error', content: t('chat.ui.errors.provider.sessionCreateFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('gemini') }) };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId!;
    try {
      await this.applySelectedModel(sessionId, queryOptions);
    } catch (error) {
      yield {
        type: 'error',
        content: this.formatRuntimeError(error),
      };
      yield { type: 'done' };
      return;
    }
    this.activeTurn?.queue.close();
    this.activeTurn = {
      queue: new StreamChunkQueue(),
      sessionId,
    };
    this.currentTurnMetadata = {};
    this.contextUsage = null;
    this.promptUsage = null;
    this.sessionUpdateNormalizer.reset();

    const activeTurn = this.activeTurn;
    const promptPromise = this.connection.prompt({
      prompt: buildGeminiPromptBlocks(
        turn.request,
        shouldBootstrapHistory ? previousMessages : [],
        queryOptions,
      ),
      sessionId,
    }).then((response) => {
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      this.promptUsage = response.usage ?? null;
      const usage = buildAcpUsageInfo({
        contextWindow: this.contextUsage,
        model: this.getActiveModel() ?? undefined,
        promptUsage: this.promptUsage,
      });
      if (usage) {
        activeTurn.queue.push({ sessionId, type: 'usage', usage });
      }
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).catch((error) => {
      activeTurn.queue.push({
        type: 'error',
        content: this.formatRuntimeError(error),
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
    return [];
  }

  getAuxiliaryModel(): string | null {
    return this.getActiveModel();
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

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}

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
    const existingState = getGeminiState(params.conversation?.providerState);
    const updates: Partial<Conversation> = {
      providerState: params.conversation?.providerState,
      sessionId: this.sessionId,
    };

    // "We had a session and lost it" has to outlive the runtime that learned it:
    // the in-memory flag is consumed by the first save, and saves happen on tab
    // close and on quit. Without this the next launch reads a dropped session as
    // a conversation that never had one and replays the whole transcript into a
    // fresh one. It clears itself once a real session id is persisted again.
    if (!this.sessionId && (params.sessionInvalidated || existingState.sessionDropped === true)) {
      updates.providerState = { sessionDropped: true };
      updates.sessionId = null;
    } else if (this.sessionId && existingState.sessionDropped === true) {
      const { sessionDropped: _dropped, ...rest } = existingState;
      updates.providerState = rest;
    }

    return { updates };
  }

  resolveSessionIdForFork(_conversation: Conversation | null): string | null {
    return null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async startProcess(spec: GeminiLaunchSpec): Promise<void> {
    this.process = new AcpSubprocess({
      args: spec.args,
      command: spec.command,
      cwd: spec.cwd,
      env: spec.runtimeEnv,
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process?.onClose(listener) ?? (() => {}),
      output: this.process.stdin,
    });
    this.unregisterTransportClose = this.transport.onClose(() => {
      this.setReady(false);
      this.activeTurn?.queue.close();
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

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    this.activeTurn?.queue.close();
    this.activeTurn = null;
    this.currentSessionModelId = null;

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

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      const response = await this.connection.newSession({
        cwd,
        mcpServers: this.getMcpServers(),
      });
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      this.syncSessionDiscovery({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
        modes: response.modes ?? null,
      });
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string, cwd: string): Promise<boolean> {
    const connection = this.connection;
    if (!connection) {
      return false;
    }

    try {
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
      this.syncSessionDiscovery({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
        modes: response.modes ?? null,
      });
      return true;
    } catch (error) {
      // Ask the agent whether the session still exists instead of treating any
      // failure as proof it is gone - an expired token looks identical from
      // here, and swallowing it drops the conversation's context with no signal.
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
    const servers = ProviderWorkspaceRegistry.getMcpServerManager('gemini')?.getServers() ?? [];
    return toAcpMcpServers(servers);
  }

  private async handleSessionNotification(notification: AcpSessionNotification): Promise<void> {
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (normalized.type === 'config_options') {
      this.syncSessionDiscovery({
        configOptions: normalized.configOptions,
      });
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    switch (normalized.type) {
      case 'message_chunk':
        if (normalized.role === 'assistant' && normalized.messageId) {
          this.currentTurnMetadata.assistantMessageId = normalized.messageId;
        }
        if (normalized.role === 'user' && normalized.messageId) {
          this.currentTurnMetadata.userMessageId = normalized.messageId;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      case 'tool_call':
      case 'tool_call_update':
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      case 'usage': {
        this.contextUsage = normalized.usage;
        geminiPlanUsageStore.recordCost(normalized.usage.cost ?? null);
        const usage = buildAcpUsageInfo({
          contextWindow: normalized.usage,
          model: this.getActiveModel() ?? undefined,
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

  private syncSessionDiscovery(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: Parameters<typeof extractAcpSessionModelState>[0]['models'];
    modes?: Parameters<typeof extractAcpSessionModeState>[0]['modes'];
  }): void {
    const modelState = extractAcpSessionModelState(params);
    const modeState = extractAcpSessionModeState(params);
    const updates: Parameters<typeof updateGeminiProviderSettings>[1] = {};

    if (modelState.currentModelId) {
      this.currentSessionModelId = modelState.currentModelId;
    }

    if (modelState.availableModels.length > 0) {
      const discoveredRawIds = modelState.availableModels
        .map((model) => model.id.trim())
        .filter(Boolean);
      updates.discoveredModels = modelState.availableModels.map((model): GeminiDiscoveredModel => ({
        description: model.description ?? undefined,
        label: model.name || model.id,
        rawId: model.id,
      }));
      // Records which configuration produced this list. The model catalog seeds
      // its refresh cache from the persisted list on the next plugin load, and
      // without this digest that seed would adopt a CLI swapped while Grimoire
      // was not running instead of rediscovering under it.
      updates.discoveredModelsFingerprint = hashCatalogFingerprint(
        resolveGeminiModelCatalogFingerprint(
          this.plugin,
          getGeminiProviderSettings(this.plugin.settings),
        ),
      );
      updates.visibleModels = discoveredRawIds;
    }

    if (modeState.availableModes.length > 0) {
      updates.availableModes = modeState.availableModes.map((mode): GeminiMode => ({
        description: mode.description ?? undefined,
        id: mode.id,
        name: mode.name,
      }));
    }

    if (modeState.currentModeId) {
      updates.selectedMode = modeState.currentModeId;
    }

    if (Object.keys(updates).length > 0) {
      updateGeminiProviderSettings(this.plugin.settings, updates);
      void this.plugin.saveSettings?.();
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const rawInput = request.toolCall.rawInput;
    const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : {};
    const pathValue = ['path', 'filePath', 'filepath'].map((key) => input[key])
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?? request.toolCall.locations
        ?.map((location) => (typeof location?.path === 'string' ? location.path.trim() : ''))
        .find((path) => path.length > 0);
    const title = request.toolCall.title?.trim() || request.toolCall.kind?.trim() || 'Gemini action';
    const description = pathValue
      ? `${title} requests access to ${pathValue}.`
      : `${title} requests permission.`;
    const decision = await this.approvalCallback(title, input, description, {
      ...(pathValue ? { target: pathValue } : {}),
      decisionOptions: buildAcpApprovalDecisionOptions(request.options),
    });
    return mapAcpApprovalDecision(decision, request.options);
  }

  private async readTextFile(request: AcpReadTextFileRequest): Promise<{ content: string }> {
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

  private async writeTextFile(request: AcpWriteTextFileRequest): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await approveAcpWriteTextFile({
      approvalCallback: this.approvalCallback,
      fullAccess: this.plugin.settings.permissionMode === 'full_access',
      providerLabel: 'Gemini',
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
    const allowOutsideWorkspace = this.plugin.settings.permissionMode === 'full_access';
    return resolveWorkspacePath(cwd, rawPath, { allowOutsideWorkspace });
  }

  private getActiveModel(): string | null {
    const rawModelId = this.currentSessionModelId ?? this.resolveSelectedRawModelId();
    return rawModelId
      ? encodeGeminiModelId(rawModelId)
      : GEMINI_SYNTHETIC_MODEL_ID;
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    if (queryOptions?.model !== undefined) {
      return typeof queryOptions.model === 'string'
        ? decodeGeminiModelId(queryOptions.model)
        : null;
    }
    const providerSettings = getGeminiProviderSettings(this.plugin.settings);
    const savedProviderModel = this.plugin.settings.savedProviderModel;
    const savedGeminiModel = savedProviderModel
      && typeof savedProviderModel === 'object'
      && !Array.isArray(savedProviderModel)
      ? (savedProviderModel as Record<string, unknown>).gemini
      : null;
    return typeof savedGeminiModel === 'string'
      ? decodeGeminiModelId(savedGeminiModel)
      : providerSettings.visibleModels[0] ?? null;
  }

  private async applySelectedModel(
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
  ): Promise<void> {
    if (!this.connection) {
      return;
    }
    const selectedModel = this.resolveSelectedRawModelId(queryOptions);
    if (!selectedModel || selectedModel === this.currentSessionModelId) {
      return;
    }
    await this.connection.setModel({ modelId: selectedModel, sessionId });
    this.currentSessionModelId = selectedModel;
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : t('chat.ui.errors.provider.requestFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('gemini') });
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.currentSessionModelId = null;
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
}

function buildGeminiPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  queryOptions?: ChatRuntimeQueryOptions,
): AcpContentBlock[] {
  const prompt = buildGeminiPromptText(request, conversationHistory);
  const text = request.orchestratorMode === true || queryOptions?.orchestratorMode === true
    ? applyOrchestratorModeInstructions(prompt)
    : prompt;
  const blocks: AcpContentBlock[] = [{ text, type: 'text' }];
  for (const image of request.images ?? []) {
    blocks.push(toAcpImage(image));
  }
  return blocks;
}

function buildGeminiPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): string {
  let prompt = request.text;

  if (request.excludedFolders && request.excludedFolders.length > 0) {
    prompt = appendExcludedFoldersContext(prompt, request.excludedFolders);
  }

  if (request.currentNotePath) {
    prompt = appendCurrentNote(prompt, request.currentNotePath);
  }

  if (request.vaultSearchContext) {
    prompt = appendVaultSearchContext(prompt, request.vaultSearchContext);
  }

  if (request.contextFiles && request.contextFiles.length > 0) {
    prompt = appendContextFiles(prompt, request.contextFiles);
  }

  if (request.projectWorkspaceContext) {
    prompt = appendProjectWorkspaceContext(prompt, request.projectWorkspaceContext);
  }

  if (request.editorSelection) {
    prompt = appendEditorContext(prompt, request.editorSelection);
  }

  if (request.browserSelection) {
    prompt = appendBrowserContext(prompt, request.browserSelection);
  }

  if (request.canvasSelection) {
    prompt = appendCanvasContext(prompt, request.canvasSelection);
  }

  if (conversationHistory.length > 0) {
    const historyContext = buildContextFromHistory(conversationHistory);
    prompt = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      prompt,
      conversationHistory,
    );
  }

  return prompt;
}

function toAcpImage(image: ImageAttachment): AcpContentBlock {
  return {
    data: image.data,
    mimeType: image.mediaType,
    type: 'image',
  };
}
