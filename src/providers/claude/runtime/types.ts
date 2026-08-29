import type {
  PermissionMode as SDKPermissionMode,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { ChatRuntimeEnsureReadyOptions } from '../../../core/runtime/types';
import {
  TOOL_TASK_CREATE,
  TOOL_TASK_GET,
  TOOL_TASK_LIST,
  TOOL_TASK_UPDATE,
} from '../../../core/tools/toolNames';
import type { ImageAttachment, StreamChunk } from '../../../core/types';
import type { PermissionMode } from '../../../core/types/settings';
import type { ClaudeModel, EffortLevel } from '../types/models';

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageAttachment['mediaType'];
    data: string;
  };
}

export type UserContentBlock = TextContentBlock | ImageContentBlock;

export const MESSAGE_CHANNEL_CONFIG = {
  MAX_QUEUED_MESSAGES: 8, // Memory protection from rapid user input
  MAX_MERGED_CHARS: 12000, // ~3k tokens — batch size under context limits
} as const;

export interface PendingTextMessage {
  type: 'text';
  content: string;
}

export interface PendingAttachmentMessage {
  type: 'attachment';
  message: SDKUserMessage;
}

export type PendingMessage = PendingTextMessage | PendingAttachmentMessage;

export interface ClosePersistentQueryOptions {
  preserveHandlers?: boolean;
}

export interface ClaudeEnsureReadyOptions extends ChatRuntimeEnsureReadyOptions {
  externalContextPaths?: string[];
  preserveHandlers?: boolean;
  sessionId?: string;
}

export interface ResponseHandler {
  readonly id: string;
  onChunk: (chunk: StreamChunk) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  readonly sawStreamText: boolean;
  readonly sawStreamThinking: boolean;
  readonly sawAnyChunk: boolean;
  markStreamTextSeen(): void;
  markStreamThinkingSeen(): void;
  resetStreamText(): void;
  resetStreamThinking(): void;
  markChunkSeen(): void;
}

export interface ResponseHandlerOptions {
  id: string;
  onChunk: (chunk: StreamChunk) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export function createResponseHandler(options: ResponseHandlerOptions): ResponseHandler {
  let _sawStreamText = false;
  let _sawStreamThinking = false;
  let _sawAnyChunk = false;

  return {
    id: options.id,
    onChunk: options.onChunk,
    onDone: options.onDone,
    onError: options.onError,
    get sawStreamText() { return _sawStreamText; },
    get sawStreamThinking() { return _sawStreamThinking; },
    get sawAnyChunk() { return _sawAnyChunk; },
    markStreamTextSeen() { _sawStreamText = true; },
    markStreamThinkingSeen() { _sawStreamThinking = true; },
    resetStreamText() { _sawStreamText = false; },
    resetStreamThinking() { _sawStreamThinking = false; },
    markChunkSeen() { _sawAnyChunk = true; },
  };
}

export interface PersistentQueryConfig {
  model: string | null;
  effortLevel: EffortLevel;
  permissionMode: PermissionMode | null;
  sdkPermissionMode: SDKPermissionMode | null;
  systemPromptKey: string;
  disallowedToolsKey: string;
  mcpServersKey: string;
  pluginsKey: string;
  externalContextPaths: string[];
  settingSources: string;
  claudeCliPath: string;
  enableChrome: boolean;
  enableAutoMode: boolean;
}

export interface SessionState {
  sessionId: string | null;
  sessionModel: ClaudeModel | null;
  pendingSessionModel: ClaudeModel | null;
  wasInterrupted: boolean;
  /** Set when SDK returns a different session ID than expected (context lost). */
  needsHistoryRebuild: boolean;
  /** Set when the current session is invalidated by SDK errors. */
  sessionInvalidated: boolean;
}

export const UNSUPPORTED_SDK_TOOLS = [] as const;

/**
 * Built-in tools the sdk stopped offering by default. Since 0.3.233 the task
 * tracking tools are out of the default surface on Opus 4.8, Sonnet 5, Fable 5
 * and newer, so a run that names none of them can never track a plan. Naming
 * them in `allowedTools` re-enables the whole group without replacing the rest
 * of the default surface, which is what setting `tools` would do.
 *
 * Verified against Claude Code 2.1.233: naming even one of these turns the
 * group back on, and `allowedTools` does NOT re-add anything past a
 * restricting `tools` list.
 */
export const OPT_IN_BUILTIN_TOOLS = [
  TOOL_TASK_CREATE,
  TOOL_TASK_GET,
  TOOL_TASK_LIST,
  TOOL_TASK_UPDATE,
] as const;

/** Built-in subagents that don't apply to Obsidian context. */
export const DISABLED_BUILTIN_SUBAGENTS = [
  'Task(statusline-setup)',
] as const;

export function isTurnCompleteMessage(message: SDKMessage): boolean {
  return message.type === 'result';
}
