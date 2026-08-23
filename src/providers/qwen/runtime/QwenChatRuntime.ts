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
  ApprovalDecision,
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
import type {
  extractAcpSessionModelState,
  extractAcpSessionModeState} from '../../acp';
import {
  AcpClientConnection,
  type AcpContentBlock,
  AcpJsonRpcTransport,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionNotification,
  type AcpSessionUpdate,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  type AcpWriteTextFileRequest,
  approveAcpWriteTextFile,
  buildAcpUsageInfo,
  resolveWorkspacePath,
} from '../../acp';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import { qwenPlanUsageStore } from '../app/QwenPlanUsageStore';
import { QWEN_PROVIDER_CAPABILITIES } from '../capabilities';
import { QwenSessionConfigState } from '../execution/QwenSessionConfigState';
import { mapGrimoireModeToQwen } from '../modes';
import { getQwenProviderSettings } from '../settings';
import { buildQwenRuntimeEnv } from './QwenRuntimeEnvironment';

interface ActiveTurn {
  queue: StreamChunkQueue;
  sessionId: string;
}

interface QwenLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  runtimeEnv: NodeJS.ProcessEnv;
}

interface QwenContextUsageStatus {
  usage?: {
    contextWindowSize?: unknown;
    totalTokens?: unknown;
  };
}

const QWEN_CONTEXT_USAGE_METHOD = 'qwen/status/session/context_usage';
const QWEN_CONTEXT_USAGE_TIMEOUT_MS = 3_000;

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

export class QwenChatRuntime implements ChatRuntime {
  readonly providerId = 'qwen' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private contextUsage: Parameters<typeof buildAcpUsageInfo>[0]['contextWindow'] = null;
  /**
   * What the live session is configured with, and what the vault knows of it.
   *
   * Moved out whole rather than copied: the flip needs the same answers from a
   * composition that has no runtime, and two copies of this would be two
   * opinions about what a turn runs under.
   */
  private readonly sessionConfig = new QwenSessionConfigState({
    settingsBag: () => this.plugin.settings,
  });
  private currentLaunchKey: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private loadedSessionId: string | null = null;
  private process: AcpSubprocess | null = null;
  private permissionModeSyncCallback: ((mode: string) => void) | null = null;
  private promptUsage: Parameters<typeof buildAcpUsageInfo>[0]['promptUsage'] = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private supportedCommands: SlashCommand[] = [];
  private sessionCwds = new Map<string, string>();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(private readonly plugin: GrimoirePlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return QWEN_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    const prompt = buildQwenPromptText(request);

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
      this.supportedCommands = [];
    }
    this.sessionId = nextSessionId;
  }

  async reloadMcpServers(): Promise<void> {
    await ProviderWorkspaceRegistry.getMcpServerManager('qwen')?.loadServers();
    await this.shutdownProcess();
  }

  async reloadWorkspaceResources(): Promise<void> {
    await this.shutdownProcess();
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getQwenProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('qwen') ?? 'qwen';
    const runtimeEnv = buildQwenRuntimeEnv(this.plugin.settings, resolvedCliPath);
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
      yield { type: 'error', content: t('chat.ui.errors.provider.startFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('qwen') }) };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: t('chat.ui.errors.provider.notReady', { provider: ProviderRegistry.getProviderDisplayNameOrId('qwen') }) };
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
        yield { type: 'error', content: t('chat.ui.errors.provider.sessionCreateFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('qwen') }) };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId!;
    try {
      await this.applySelectedModel(sessionId, queryOptions);
      await this.applySelectedMode(sessionId);
      await this.applySelectedEffort(sessionId);
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
      prompt: buildQwenPromptBlocks(
        turn.request,
        shouldBootstrapHistory ? previousMessages : [],
        queryOptions,
      ),
      sessionId,
    }).then(async (response) => {
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      this.promptUsage = response.usage ?? null;
      await this.refreshContextUsage(sessionId);
      const usage = buildAcpUsageInfo({
        contextWindow: this.contextUsage,
        model: this.getActiveModel() ?? undefined,
        promptUsage: this.promptUsage,
      });
      if (usage) {
        activeTurn.queue.push({ sessionId, type: 'usage', usage, usageScope: 'parent' });
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
    await this.ensureReady({ allowSessionCreation: false });
    return this.supportedCommands.map((command) => ({ ...command }));
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

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserQuestionCallback = callback;
  }

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

  private async startProcess(spec: QwenLaunchSpec): Promise<void> {
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
    this.supportedCommands = [];

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
      // ACP session/load responses need not repeat the session id.
      this.loadedSessionId = sessionId;
      this.sessionId = sessionId;
      this.sessionCwds.set(sessionId, cwd);
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
        providerId: 'qwen',
        sessionId,
      }));
      return missing ? 'missing' : 'unavailable';
    }
  }

  private getMcpServers() {
    const servers = ProviderWorkspaceRegistry.getMcpServerManager('qwen')?.getServers() ?? [];
    return toAcpMcpServers(servers);
  }

  private async handleSessionNotification(notification: AcpSessionNotification): Promise<void> {
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    // Qwen streams nested agent thoughts, messages, and tool calls through the
    // parent ACP session. Rendering those updates in the main transcript mixes
    // concurrently running agents together and corrupts the visible response.
    // The parent Agent tool call remains visible; only its child activity is
    // suppressed here.
    if (isQwenSubagentUpdate(notification.update)) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (normalized.type === 'config_options') {
      this.syncSessionDiscovery({
        configOptions: normalized.configOptions,
      });
      return;
    }

    if (normalized.type === 'commands') {
      this.supportedCommands = normalized.commands.map((command) => ({ ...command }));
      return;
    }

    if (normalized.type === 'current_mode') {
      const permissionMode = this.sessionConfig.adoptCurrentMode(normalized.currentModeId);
      void this.plugin.saveSettings?.();
      this.emitPermissionModeSync(permissionMode);
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
      case 'plan':
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      case 'usage': {
        this.contextUsage = normalized.usage;
        qwenPlanUsageStore.recordCost(normalized.usage.cost ?? null);
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
            usageScope: 'parent',
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private async refreshContextUsage(sessionId: string): Promise<void> {
    if (!this.transport) {
      return;
    }

    try {
      const response = await this.transport.request<QwenContextUsageStatus>(
        QWEN_CONTEXT_USAGE_METHOD,
        { detail: false, sessionId },
        { timeoutMs: QWEN_CONTEXT_USAGE_TIMEOUT_MS },
      );
      const usage = parseQwenContextUsage(response);
      if (usage && this.sessionId === sessionId) {
        this.contextUsage = usage;
      }
    } catch {
      // This Qwen extension is optional. Older ACP runtimes continue to use
      // standard usage_update notifications or prompt response usage.
    }
  }

  private syncSessionDiscovery(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: Parameters<typeof extractAcpSessionModelState>[0]['models'];
    modes?: Parameters<typeof extractAcpSessionModeState>[0]['modes'];
  }): void {
    if (this.sessionConfig.syncSessionDiscovery(params)) {
      void this.plugin.saveSettings?.();
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    const askUserQuestions = getQwenAskUserQuestions(request);
    if (askUserQuestions) {
      return this.handleAskUserQuestionPermission(request, askUserQuestions);
    }

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
    const title = request.toolCall.title?.trim() || request.toolCall.kind?.trim() || 'Qwen Code action';
    const description = pathValue
      ? `${title} requests access to ${pathValue}.`
      : `${title} requests permission.`;
    const decision = await this.approvalCallback(title, input, description, {
      ...(pathValue ? { target: pathValue } : {}),
      decisionOptions: request.options.map((option) => ({
        label: option.name,
        presentation: option.kind === 'allow_once'
          ? 'allow' as const
          : option.kind === 'allow_always'
          ? 'always' as const
          : 'reject' as const,
        value: option.optionId,
      })),
    });
    return mapQwenApprovalDecision(decision, request.options);
  }

  private async handleAskUserQuestionPermission(
    request: AcpRequestPermissionRequest,
    questions: QwenAskUserQuestion[],
  ): Promise<QwenAskUserQuestionPermissionResponse> {
    if (!this.askUserQuestionCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const allowOnce = request.options.find((option) => option.kind === 'allow_once');
    if (!allowOnce) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const answers = await this.askUserQuestionCallback({ questions });
    if (answers === null) {
      return { outcome: { outcome: 'cancelled' } };
    }

    return {
      answers: mapQwenQuestionAnswers(answers, questions),
      outcome: { optionId: allowOnce.optionId, outcome: 'selected' },
    };
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

  /**
   * This provider's own permission mode, not whichever one was projected last.
   *
   * `settings.permissionMode` is a shared field: the settings coordinator
   * projects the active provider's value into it, so reading it directly
   * answers for whoever was toggled most recently. That is how another
   * provider's Auto-approve came to switch off *this* provider's workspace
   * containment and skip its write approvals. Every flipped provider reads the
   * per-provider snapshot; these two were the ones the change never reached.
   */
  private async writeTextFile(request: AcpWriteTextFileRequest): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await approveAcpWriteTextFile({
      approvalCallback: this.approvalCallback,
      fullAccess: this.sessionConfig.fullAccess(),
      providerLabel: 'Qwen',
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

  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection || typeof this.connection.setMode !== 'function') return;
    const modeId = mapGrimoireModeToQwen(this.sessionConfig.resolveSelectedModeId());
    if (modeId === this.sessionConfig.sessionModeId) return;
    await this.connection.setMode({ modeId, sessionId });
    this.sessionConfig.markApplied({ modeId });
  }

  private async applySelectedEffort(sessionId: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    const effortLevel = getQwenProviderSettings(this.plugin.settings).effortLevel;
    if (effortLevel === this.sessionConfig.sessionEffortLevel) {
      return;
    }

    await this.connection.prompt({
      prompt: [{ text: `/effort ${effortLevel}`, type: 'text' }],
      sessionId,
    });
    this.sessionConfig.markApplied({ effortLevel });
  }

  private emitPermissionModeSync(modeId: string): void {
    try {
      this.permissionModeSyncCallback?.(modeId);
    } catch {
      // UI synchronization is non-critical to the provider session.
    }
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : t('chat.ui.errors.provider.requestFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('qwen') });
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.sessionConfig.forgetSession();
    this.supportedCommands = [];
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

function isQwenSubagentUpdate(update: AcpSessionUpdate): boolean {
  if (
    update.sessionUpdate !== 'agent_message_chunk'
    && update.sessionUpdate !== 'agent_thought_chunk'
    && update.sessionUpdate !== 'tool_call'
    && update.sessionUpdate !== 'tool_call_update'
  ) {
    return false;
  }
  const metadata = (update as AcpSessionUpdate & { _meta?: Record<string, unknown> })._meta;
  return typeof metadata?.parentToolCallId === 'string'
    && metadata.parentToolCallId.length > 0
    && typeof metadata.subagentType === 'string'
    && metadata.subagentType.length > 0;
}

function parseQwenContextUsage(status: QwenContextUsageStatus): { size: number; used: number } | null {
  const used = status.usage?.totalTokens;
  const size = status.usage?.contextWindowSize;
  if (
    typeof used !== 'number'
    || !Number.isFinite(used)
    || used < 0
    || typeof size !== 'number'
    || !Number.isFinite(size)
    || size <= 0
  ) {
    return null;
  }
  return { size, used };
}

function buildQwenPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  queryOptions?: ChatRuntimeQueryOptions,
): AcpContentBlock[] {
  const prompt = buildQwenPromptText(request, conversationHistory);
  const text = request.orchestratorMode === true || queryOptions?.orchestratorMode === true
    ? applyOrchestratorModeInstructions(prompt)
    : prompt;
  const blocks: AcpContentBlock[] = [{ text, type: 'text' }];
  for (const image of request.images ?? []) {
    blocks.push(toAcpImage(image));
  }
  return blocks;
}

function buildQwenPromptText(
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

function mapQwenApprovalDecision(
  decision: ApprovalDecision,
  options: readonly AcpRequestPermissionRequest['options'][number][],
): AcpRequestPermissionResponse {
  const preferredKinds = decision === 'allow'
    ? ['allow_once', 'allow_always'] as const
    : decision === 'allow-always'
    ? ['allow_always', 'allow_once'] as const
    : decision === 'deny'
    ? ['reject_once', 'reject_always'] as const
    : [] as const;
  if (typeof decision === 'object' && decision.type === 'select-option') {
    return { outcome: { optionId: decision.value, outcome: 'selected' } };
  }
  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option) return { outcome: { optionId: option.optionId, outcome: 'selected' } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

interface QwenAskUserQuestion {
  header?: string;
  id?: string;
  multiSelect: boolean;
  options: Array<{ description?: string; label: string; preview?: string }>;
  question: string;
}

type QwenAskUserQuestionPermissionResponse = AcpRequestPermissionResponse & {
  answers?: Record<string, string>;
};

function getQwenAskUserQuestions(
  request: AcpRequestPermissionRequest,
): QwenAskUserQuestion[] | null {
  const rawInput = asRecord(request.toolCall.rawInput);
  const meta = asRecord(request.toolCall._meta);
  const isQwenQuestion = meta?.qwenInteractionKind === 'user_question'
    || meta?.toolName === 'ask_user_question'
    || (Array.isArray(rawInput?.questions) && /^Ask user \d+ questions?$/i.test(request.toolCall.title ?? ''));
  if (!isQwenQuestion) {
    return null;
  }

  const source = Array.isArray(rawInput?.questions)
    ? rawInput.questions
    : Array.isArray(meta?.qwenQuestions)
    ? meta.qwenQuestions
    : [];
  const questions = source.map(normalizeQwenAskUserQuestion).filter(
    (question): question is QwenAskUserQuestion => question !== null,
  );
  return questions;
}

function normalizeQwenAskUserQuestion(value: unknown): QwenAskUserQuestion | null {
  const question = asRecord(value);
  if (!question || typeof question.question !== 'string') {
    return null;
  }

  return {
    ...(typeof question.header === 'string' ? { header: question.header } : {}),
    ...(typeof question.id === 'string' ? { id: question.id } : {}),
    multiSelect: question.multiSelect === true,
    options: Array.isArray(question.options)
      ? question.options.map(normalizeQwenAskUserQuestionOption).filter(
        (option): option is QwenAskUserQuestion['options'][number] => option !== null,
      )
      : [],
    question: question.question,
  };
}

function normalizeQwenAskUserQuestionOption(
  value: unknown,
): QwenAskUserQuestion['options'][number] | null {
  if (typeof value === 'string') {
    return { label: value };
  }
  const option = asRecord(value);
  if (!option || typeof option.label !== 'string') {
    return null;
  }
  return {
    ...(typeof option.description === 'string' ? { description: option.description } : {}),
    label: option.label,
    ...(typeof option.preview === 'string' ? { preview: option.preview } : {}),
  };
}

function mapQwenQuestionAnswers(
  answers: Record<string, string | string[]>,
  questions: readonly QwenAskUserQuestion[],
): Record<string, string> {
  return Object.fromEntries(questions.flatMap((question, index) => {
    const answer = (question.id ? answers[question.id] : undefined) ?? answers[question.question];
    return answer === undefined ? [] : [[String(index), Array.isArray(answer) ? answer.join(', ') : answer]];
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
