import { type ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
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
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import {
  appendContextFiles,
  appendCurrentNote,
  appendExcludedFoldersContext,
  appendProjectWorkspaceContext,
  appendVaultSearchContext,
  formatCurrentNote,
} from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { getVaultPath } from '../../../utils/path';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '../capabilities';
import { decodeAntigravityModelId } from '../models';
import { getAntigravityProviderSettings } from '../settings';
import { buildAntigravityPrintArgs } from './AntigravityPrintProtocol';
import { buildAntigravityProcessLaunch } from './AntigravityProcessLaunch';
import { buildAntigravityRuntimeEnv } from './AntigravityRuntimeEnvironment';
import {
  createAntigravityPrintLogPath,
  recoverAntigravityPrintOutputFromTranscript,
} from './AntigravityTranscriptRecovery';

export {
  type AntigravityPrintArgsSpec,
  buildAntigravityPrintArgs,
} from './AntigravityPrintProtocol';

const OUTPUT_BUFFER_LIMIT = 64_000;
const PRINT_TIMEOUT_MS = 5 * 60 * 1000;

interface AntigravityPrintSpec {
  command: string;
  cwd: string;
  model: string | null;
  permissionMode: string;
  prompt: string;
  runtimeEnv: NodeJS.ProcessEnv;
}

export class AntigravityChatRuntime implements ChatRuntime {
  readonly providerId = 'antigravity' as const;

  private activeProcess: ChildProcess | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;

  constructor(private readonly plugin: LegacyProviderContext) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return ANTIGRAVITY_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    const prompt = buildAntigravityPromptText(request);

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

  syncConversationState(_conversation: { providerState?: Record<string, unknown>; sessionId?: string | null } | null): void {}

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(): Promise<boolean> {
    const settings = getAntigravityProviderSettings(this.plugin.settings);
    this.setReady(settings.enabled);
    return settings.enabled;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      yield { type: 'error', content: t('chat.ui.errors.provider.antigravityDisabled') };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const command = this.plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
    const permissionMode = this.getPermissionMode();
    if (permissionMode !== 'full_access') {
      yield {
        type: 'error',
        content: t('chat.ui.errors.provider.antigravitySafeModeUnavailable'),
      };
      yield { type: 'done' };
      return;
    }

    const prompt = buildAntigravityPrintPrompt(turn.prompt, conversationHistory);

    try {
      yield { content: 'Starting Antigravity...', type: 'status' };
      const output = await this.runPrint({
        command,
        cwd,
        model: this.getSelectedRawModel(queryOptions),
        permissionMode,
        prompt,
        runtimeEnv: buildAntigravityRuntimeEnv(this.plugin.settings, command),
      });
      const trimmed = output.trim();
      if (trimmed) {
        yield { content: trimmed, type: 'text' };
      } else {
        yield {
          type: 'error',
          content: t('chat.ui.errors.provider.antigravityEmptyOutput'),
        };
      }
      yield { type: 'done' };
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error
          ? error.message
          : t('chat.ui.errors.provider.requestFailed', {
            provider: ProviderRegistry.getProviderDisplayNameOrId('antigravity'),
          }),
      };
      yield { type: 'done' };
    } finally {
      this.activeProcess = null;
    }
  }

  cancel(): void {
    this.activeProcess?.kill('SIGTERM');
  }

  resetSession(): void {}

  getSessionId(): string | null {
    return null;
  }

  consumeSessionInvalidation(): boolean {
    return false;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  getAuxiliaryModel(): string | null {
    return this.getSelectedRawModel();
  }

  cleanup(): void {
    this.cancel();
    this.setReady(false);
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}

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
    return {
      updates: {
        providerState: params.conversation?.providerState,
        sessionId: null,
      },
    };
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

  private runPrint(spec: AntigravityPrintSpec): Promise<string> {
    const printLogFilePath = createAntigravityPrintLogPath();
    const args = buildAntigravityPrintArgs({
      ...spec,
      logFilePath: printLogFilePath,
    });
    this.plugin.recordDebugLog?.({
      data: {
        argsSummary: summarizeAntigravityPrintArgs(args),
        command: spec.command,
        commandSource: classifyAgyCommand(spec.command),
        cwdLabel: getCwdLabel(this.plugin, spec.cwd),
        homePresent: Boolean(process.env.HOME),
        mode: spec.permissionMode,
        model: spec.model ?? 'default',
        pathEntryCount: (process.env.PATH ?? '').split(':').filter(Boolean).length,
        pathHasLocalBin: (process.env.PATH ?? '').split(':').includes(`${process.env.HOME ?? ''}/.local/bin`),
        promptLength: spec.prompt.length,
        providerId: this.providerId,
        shellPresent: Boolean(process.env.SHELL),
      },
      event: 'print.spawn',
      level: 'debug',
      scope: 'provider.antigravity',
    });
    return new Promise<string>((resolve, reject) => {
      const launch = buildAntigravityProcessLaunch(spec.command, args, spec.runtimeEnv);
      this.plugin.recordDebugLog?.({
        data: {
          launchMode: launch.launchMode,
          providerId: this.providerId,
        },
        event: 'print.launchMode',
        level: 'debug',
        scope: 'provider.antigravity',
      });
      const proc = spawn(launch.command, launch.args, {
        cwd: spec.cwd,
        env: spec.runtimeEnv,
        shell: launch.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.activeProcess = proc;
      this.plugin.recordDebugLog?.({
        data: {
          launchMode: launch.launchMode,
          pid: proc.pid ?? -1,
          providerId: this.providerId,
          stdinMode: 'ignore',
          stdioMode: 'ignore-pipe-pipe',
        },
        event: 'print.processStarted',
        level: 'debug',
        scope: 'provider.antigravity',
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let sawStdout = false;
      let sawStderr = false;
      const startedAt = Date.now();
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        callback();
      };
      const timeout = window.setTimeout(() => {
        this.plugin.recordDebugLog?.({
          data: {
            killSignal: 'SIGTERM',
            pid: proc.pid ?? -1,
            providerId: this.providerId,
          },
          event: 'print.signalSent',
          level: 'warn',
          scope: 'provider.antigravity',
        });
        proc.kill('SIGTERM');
        window.setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            this.plugin.recordDebugLog?.({
              data: {
                killSignal: 'SIGKILL',
                pid: proc.pid ?? -1,
                providerId: this.providerId,
              },
              event: 'print.forceKill',
              level: 'error',
              scope: 'provider.antigravity',
            });
            proc.kill('SIGKILL');
          }
        }, 2_000);
        this.plugin.recordDebugLog?.({
          data: {
            durationMs: Date.now() - startedAt,
            providerId: this.providerId,
            stderrBytes: stderr.length,
            stderrPreview: summarizeCliText(stderr),
            stdoutBytes: stdout.length,
            timeoutMs: PRINT_TIMEOUT_MS,
          },
          event: 'print.timeout',
          level: 'error',
          scope: 'provider.antigravity',
        });
        settle(() => reject(new Error('Antigravity request timed out.')));
      }, PRINT_TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout = appendLimited(stdout, chunk);
        if (!sawStdout) {
          sawStdout = true;
          this.plugin.recordDebugLog?.({
            data: {
              pid: proc.pid ?? -1,
              providerId: this.providerId,
              stdoutBytes: stdout.length,
            },
            event: 'print.stdout',
            level: 'debug',
            scope: 'provider.antigravity',
          });
        }
      });
      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr = appendLimited(stderr, chunk);
        if (!sawStderr) {
          sawStderr = true;
          this.plugin.recordDebugLog?.({
            data: {
              pid: proc.pid ?? -1,
              providerId: this.providerId,
              stderrBytes: stderr.length,
              stderrPreview: summarizeCliText(stderr),
            },
            event: 'print.stderr',
            level: 'warn',
            scope: 'provider.antigravity',
          });
        }
      });
      proc.on('error', (error) => {
        settle(() => {
          this.plugin.recordDebugLog?.({
            data: {
              providerId: this.providerId,
            },
            error,
            event: 'print.spawnError',
            level: 'error',
            scope: 'provider.antigravity',
          });
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
      proc.on('exit', (code, signal) => {
        settle(() => {
          void (async () => {
            const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
            this.plugin.recordDebugLog?.({
              data: {
                durationMs: Date.now() - startedAt,
                providerId: this.providerId,
                status,
                stderrBytes: stderr.length,
                stderrPreview: summarizeCliText(stderr),
                stdoutBytes: stdout.length,
              },
              event: code === 0 ? 'print.exit' : 'print.failed',
              level: code === 0 ? 'info' : 'error',
              scope: 'provider.antigravity',
            });
            try {
              if (code === 0) {
                const transcriptOutput = stdout
                  ? ''
                  : await recoverAntigravityPrintOutputFromTranscript(printLogFilePath, spec.runtimeEnv);
                if (transcriptOutput) {
                  this.plugin.recordDebugLog?.({
                    data: {
                      providerId: this.providerId,
                      transcriptBytes: transcriptOutput.length,
                    },
                    event: 'print.transcriptRecovered',
                    level: 'info',
                    scope: 'provider.antigravity',
                  });
                }
                resolve(stdout || transcriptOutput);
                return;
              }

              reject(new Error(formatAntigravityExitError(code, signal, stderr)));
            } finally {
              await fs.unlink(printLogFilePath).catch(() => undefined);
            }
          })().catch(reject);
        });
      });
      proc.on('close', (code, signal) => {
        const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
        this.plugin.recordDebugLog?.({
          data: {
            durationMs: Date.now() - startedAt,
            pid: proc.pid ?? -1,
            providerId: this.providerId,
            signal: signal ?? 'none',
            status,
            stderrBytes: stderr.length,
            stdoutBytes: stdout.length,
          },
          event: 'print.close',
          level: 'debug',
          scope: 'provider.antigravity',
        });
      });
    });
  }

  private getSelectedRawModel(queryOptions?: ChatRuntimeQueryOptions): string | null {
    if (typeof queryOptions?.model === 'string') {
      const selectedModel = decodeAntigravityModelId(queryOptions.model);
      if (selectedModel) {
        return selectedModel;
      }
    }
    const savedProviderModel = this.plugin.settings.savedProviderModel;
    const savedAntigravityModel = savedProviderModel
      && typeof savedProviderModel === 'object'
      && !Array.isArray(savedProviderModel)
      ? (savedProviderModel as Record<string, unknown>).antigravity
      : null;
    if (typeof savedAntigravityModel === 'string') {
      return decodeAntigravityModelId(savedAntigravityModel);
    }

    const providerSettings = getAntigravityProviderSettings(this.plugin.settings);
    return providerSettings.visibleModels[0] ?? null;
  }

  private getPermissionMode(): string {
    return typeof this.plugin.settings.permissionMode === 'string'
      ? this.plugin.settings.permissionMode
      : 'normal';
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

function buildAntigravityPromptText(request: ChatTurnRequest): string {
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

  return prompt;
}

function buildAntigravityPrintPrompt(
  currentPrompt: string,
  conversationHistory?: ChatMessage[],
): string {
  const history = (conversationHistory ?? [])
    .filter((message) => !message.isRebuiltContext && (message.content.trim() || message.currentNote))
    .slice(-12)
    .map(formatAntigravityHistoryMessage)
    .join('\n\n');

  return history ? `${history}\n\nUser: ${currentPrompt}` : currentPrompt;
}

function formatAntigravityHistoryMessage(message: ChatMessage): string {
  const role = message.role === 'assistant' ? 'Assistant' : 'User';
  let content = message.content.trim();

  if (
    message.role === 'user'
    && message.currentNote
    && !content.includes('<current_note>')
  ) {
    const currentNoteContext = formatCurrentNote(message.currentNote);
    content = content ? `${currentNoteContext}\n\n${content}` : currentNoteContext;
  }

  return `${role}: ${content}`;
}

function appendLimited(current: string, chunk: Buffer | string): string {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  return `${current}${text}`.slice(-OUTPUT_BUFFER_LIMIT);
}

function getCwdLabel(plugin: LegacyProviderContext, cwd: string): string {
  return cwd === getVaultPath(plugin.app) ? 'vault' : 'process';
}

function summarizeAntigravityPrintArgs(args: string[]): string {
  return args.map((arg, index) => {
    if (arg === '--print') {
      return arg;
    }
    if (index > 0 && args[index - 1] === '--print') {
      return '<prompt>';
    }
    return arg;
  }).join(' ');
}

function classifyAgyCommand(command: string): string {
  if (command === 'agy') {
    return 'path';
  }
  if (command.endsWith('/.local/bin/agy')) {
    return 'homeLocalBin';
  }
  return 'absolute';
}

function summarizeCliText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function formatAntigravityExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
  const message = `Antigravity CLI exited (${status})`;
  const details = stderr.trim();
  return details ? `${message}\n\n${details}` : message;
}
