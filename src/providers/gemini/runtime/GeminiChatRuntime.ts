import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  buildAcpSessionLoadFailureDebugEvent,
  isAcpMissingSessionError,
} from '@/providers/acp/acpSessionResume';

import { applyOrchestratorModeInstructions } from '../../../core/prompt/mainAgent';
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
  mapAcpApprovalDecision,
  resolveWorkspacePath,
} from '../../acp';
import { normalizeApprovalInput } from '../../acp/execution/AcpPermissionBridge';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import { geminiPlanUsageStore } from '../app/GeminiPlanUsageStore';
import { GEMINI_PROVIDER_CAPABILITIES } from '../capabilities';
import { buildGeminiPermissionPresentation } from '../execution/GeminiPermissionPresentation';
import { GeminiSessionConfigState } from '../execution/GeminiSessionConfigState';
import { mapGrimoireModeToGemini } from '../modes';
import { getGeminiProviderSettings } from '../settings';
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
  /**
   * What the live session is configured with, and what the vault knows of it.
   *
   * Moved out whole rather than copied: the flip needs the same answers from a
   * composition that has no runtime, and two copies of this would be two
   * opinions about which model a turn runs under.
   */
  private readonly sessionConfig = new GeminiSessionConfigState({
    settingsBag: () => this.plugin.settings,
  });

  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
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
      this.sessionConfig.forgetSession();
    }
    this.sessionId = nextSessionId;
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
        const outcome = await this.loadSession(this.sessionId, cwd);
        if (outcome === 'missing') {
          this.sessionInvalidated = true;
          this.clearActiveSession();
        } else if (outcome === 'unavailable') {
          // The binding is good and the agent could not load it now. Keeping it
          // is the whole point: the tab reports not-ready and the next attempt
          // resumes the same conversation.
          this.setReady(false);
          return false;
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
    let shouldBootstrapHistory = previousMessages.length > 0
      && (!expectedSessionId || this.sessionInvalidated);

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
    if (expectedSessionId && !this.sessionId) {
      shouldBootstrapHistory = previousMessages.length > 0;
    }

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
      await this.applySelectedMode(sessionId);
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

  /**
   * The surface's way of hearing that the session changed mode by itself.
   *
   * Stored rather than discarded: this runtime declares plan support, and a
   * toolbar that never hears about a mode the agent moved into keeps showing
   * the one that was picked.
   */
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
    const updates: Partial<Conversation> = {
      providerState: params.conversation?.providerState,
      sessionId: this.sessionId,
    };

    if (params.sessionInvalidated && !this.sessionId) {
      updates.providerState = undefined;
      updates.sessionId = null;
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
    this.sessionConfig.forgetSession();

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

  private async loadSession(
    sessionId: string,
    cwd: string,
  ): Promise<'loaded' | 'missing' | 'unavailable'> {
    if (!this.connection) {
      return 'unavailable';
    }

    try {
      const response = await this.connection.loadSession({
        cwd,
        mcpServers: this.getMcpServers(),
        sessionId,
      });
      this.sessionInvalidated = false;
      // The id that was asked for, where the agent does not echo one: a load
      // confirms the session by succeeding, and OpenCode's ACP — the same
      // protocol this speaks — answers with config options and nothing else.
      const boundSessionId = response.sessionId ?? sessionId;
      this.loadedSessionId = boundSessionId;
      this.sessionId = boundSessionId;
      this.sessionCwds.set(boundSessionId, cwd);
      this.syncSessionDiscovery({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
        modes: response.modes ?? null,
      });
      return 'loaded';
    } catch (error) {
      // A load that failed is not a session that is gone. The shared policy
      // tells the two apart, and only the first justifies erasing a binding the
      // conversation still names: a timeout, a dead transport or an agent that
      // was busy would otherwise silently start a new conversation and leave
      // the old one unreachable. A transient failure leaves the tab not ready,
      // which the next attempt can fix.
      const missing = isAcpMissingSessionError(error);
      this.plugin.recordDebugLog?.(buildAcpSessionLoadFailureDebugEvent({
        cwd,
        error,
        providerId: 'gemini',
        sessionId,
      }));
      return missing ? 'missing' : 'unavailable';
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
    if (normalized.type === 'current_mode') {
      // The agent's own word for the mode it is in. Dropped, the toolbar kept
      // showing whatever was last picked even after the session moved.
      const permissionMode = this.sessionConfig.adoptCurrentMode(normalized.currentModeId);
      void this.plugin.saveSettings?.();
      this.emitPermissionModeSync(permissionMode);
      return;
    }
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
      // `plan` beside them: a declared capability that reached the surface as
      // nothing. Every other ACP-family runtime forwards it, and this switch
      // dropped it into `default` while `capabilities.ts` promised plan support.
      case 'plan':
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

  private syncSessionDiscovery(
    params: Parameters<GeminiSessionConfigState['syncSessionDiscovery']>[0],
  ): void {
    if (this.sessionConfig.syncSessionDiscovery(params)) {
      void this.plugin.saveSettings?.();
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildGeminiPermissionPresentation(
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
        ...(presentation.blockedPath ? { target: presentation.blockedPath } : {}),
        decisionOptions: buildAcpApprovalDecisionOptions(request.options),
      },
    );
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
      fullAccess: this.sessionConfig.fullAccess(),
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
    const allowOutsideWorkspace = this.sessionConfig.fullAccess();
    return resolveWorkspacePath(cwd, rawPath, { allowOutsideWorkspace });
  }

  private getActiveModel(): string | null {
    return this.sessionConfig.getActiveDisplayModel();
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    return this.sessionConfig.resolveSelectedRawModelId(queryOptions);
  }

  /**
   * Puts the session into the mode the toolbar shows.
   *
   * Gemini discovered its modes and stored the selection, and sent it nowhere:
   * picking Plan changed a settings field and nothing else, while the
   * capability record declared plan support. The agent is what has to be told,
   * and `session/set_mode` is how — the same call Qwen makes at the same point
   * in a turn.
   */
  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection || typeof this.connection.setMode !== 'function') {
      return;
    }
    // Translated, not forwarded. The toolbar writes `normal`/`full_access`/
    // `plan` into `selectedMode`, and Gemini's session offers
    // `default`/`autoEdit`/`yolo`/`plan`: sending the toolbar's word is a mode
    // the agent does not have, and it is awaited inside the turn's own try — so
    // the rejection ends the turn before the prompt is ever sent.
    const modeId = mapGrimoireModeToGemini(this.sessionConfig.resolveSelectedModeId());
    if (modeId === this.sessionConfig.sessionModeId) {
      return;
    }
    await this.connection.setMode({ modeId, sessionId });
    this.sessionConfig.markApplied({ modeId });
  }

  private emitPermissionModeSync(modeId: string): void {
    try {
      this.permissionModeSyncCallback?.(modeId);
    } catch {
      // UI synchronization is non-critical to the provider session.
    }
  }

  private async applySelectedModel(
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
  ): Promise<void> {
    if (!this.connection) {
      return;
    }
    const selectedModel = this.resolveSelectedRawModelId(queryOptions);
    if (!selectedModel || selectedModel === this.sessionConfig.sessionModelId) {
      return;
    }
    await this.connection.setModel({ modelId: selectedModel, sessionId });
    this.sessionConfig.markApplied({ modelId: selectedModel });
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : t('chat.ui.errors.provider.requestFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('gemini') });
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.sessionConfig.forgetSession();
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
