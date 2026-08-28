import type { VaultSearchTurnContext } from '../runtime/types';
import type { SDKToolUseResult } from './diff';
import type { ProviderId } from './provider';
import type { SubagentMode, ToolCallInfo } from './tools';

/** Fork origin reference: identifies the source session and checkpoint. */
export interface ForkSource {
  sessionId: string;
  resumeAt: string;
}

/** View type identifier for Obsidian. */
export const VIEW_TYPE_GRIMOIRE = 'grimoire-view';

/** Supported image media types for attachments. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Image attachment metadata. */
export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: ImageMediaType;
  /** Base64 encoded image data - single source of truth. */
  data: string;
  width?: number;
  height?: number;
  size: number;
  source: 'file' | 'paste' | 'drop';
}

/** Content block for preserving streaming order in messages. */
export type AssistantTextPhase = 'commentary' | 'final_answer';

export type ProgressState = 'running' | 'waiting' | 'completed' | 'blocked';

export interface ProgressItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface OrchestratorPlanTaskContent {
  id: string;
  description: string;
  prompt: string;
}

export type ContentBlock =
  | { type: 'text'; content: string; phase?: AssistantTextPhase }
  | { type: 'tool_use'; toolId: string }
  | { type: 'thinking'; content: string; durationSeconds?: number }
  | {
    type: 'progress';
    id: string;
    content: string;
    state: ProgressState;
    items?: ProgressItem[];
    durationSeconds?: number;
  }
  | { type: 'subagent'; subagentId: string; mode?: SubagentMode }
  | {
    type: 'parallel_worker_plan';
    tasks: OrchestratorPlanTaskContent[];
    modelLabel?: string;
    providerId?: ProviderId;
  }
  | { type: 'context_compacted' };

/** Chat message with content, tool calls, and attachments. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Display-only content (e.g., "/tests" when content is the expanded prompt). */
  displayContent?: string;
  timestamp: number;
  /** Timestamp when this displayed user turn or assistant response finished. */
  completedAt?: number;
  toolCalls?: ToolCallInfo[];
  contentBlocks?: ContentBlock[];
  currentNote?: string;
  images?: ImageAttachment[];
  /** True if this message represents a user interrupt (from SDK storage). */
  isInterrupt?: boolean;
  /** True if this message is rebuilt context sent to SDK on session reset (should be hidden). */
  isRebuiltContext?: boolean;
  /** Duration in seconds from user send to response completion. */
  durationSeconds?: number;
  /** Flavor word used for duration display (e.g., "Baked", "Cooked"). */
  durationFlavorWord?: string;
  /** Provider-native user message identifier used for rewind. */
  userMessageId?: string;
  /** Provider-native assistant message identifier used for rewind/fork checkpoints. */
  assistantMessageId?: string;
  /** UI metadata for rendering vault search sources attached to this user turn. */
  vaultSearchContext?: VaultSearchTurnContext;
  /** UI metadata for the provider/model/reasoning selection that produced this assistant turn. */
  responseMetadata?: AssistantResponseMetadata;
}

/** Display-safe metadata for an assistant response header. */
export interface AssistantResponseMetadata {
  providerId?: ProviderId;
  providerLabel?: string;
  model?: string;
  modelLabel?: string;
  effort?: string;
  effortLabel?: string;
}

/** Persisted UI metadata for a user turn's vault-search sources. */
export interface PersistedVaultSearchContext {
  userMessageIndex: number;
  userMessageId?: string;
  context: VaultSearchTurnContext;
}

/** Persisted UI metadata for an assistant turn's response header. */
export interface PersistedAssistantResponseMetadata {
  assistantMessageIndex: number;
  assistantMessageId?: string;
  metadata: AssistantResponseMetadata;
}

/** Persisted conversation with messages and session state. */
export interface Conversation {
  id: string;
  providerId: ProviderId;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Timestamp when the last agent response completed. */
  lastResponseAt?: number;
  sessionId: string | null;
  /** Model selected for this bound conversation. */
  model?: string;
  /** Opaque provider-owned state bag (session tracking, fork metadata, etc.). */
  providerState?: Record<string, unknown>;
  messages: ChatMessage[];
  currentNote?: string;
  /** Session-specific external context paths (directories with full access). Resets on new session. */
  externalContextPaths?: string[];
  /** Context window usage information. */
  usage?: UsageInfo;
  /** Status of AI title generation. */
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  /** UI-enabled MCP servers for this session (context-saving servers activated via selector). */
  enabledMcpServers?: string[];
  /** Whether this conversation asks providers for an approved parallel-worker plan. */
  orchestratorMode?: boolean;
  /** Assistant checkpoint identifier for resumeAtMessageId after rewind. */
  resumeAtMessageId?: string;
  /** UI metadata restored after provider-native history hydration. */
  vaultSearchContexts?: PersistedVaultSearchContext[];
  /** UI metadata restored after provider-native history hydration. */
  assistantResponseMetadata?: PersistedAssistantResponseMetadata[];
}

/** Lightweight conversation metadata for the history dropdown. */
export interface ConversationMeta {
  id: string;
  providerId: ProviderId;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Timestamp when the last agent response completed. */
  lastResponseAt?: number;
  messageCount: number;
  preview: string;
  /** Display label for the model used in the session history row. */
  modelLabel?: string;
  /** Number of source notes/paths referenced by the session. */
  sourceCount?: number;
  /** Context-window usage percentage for the session history row. */
  usagePercentage?: number;
  /** Status of AI title generation. */
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
}

/**
 * Session metadata overlay for provider-native storage.
 * Providers keep authoritative native history; messages are a display fallback
 * for providers or environments where native history is unavailable.
 */
export interface SessionMetadata {
  id: string;
  providerId?: ProviderId;
  title: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  /** Session ID used for provider resume (may be cleared when invalidated). */
  sessionId?: string | null;
  /** Model selected for this bound conversation. */
  model?: string;
  /** Opaque provider-owned state bag. */
  providerState?: Record<string, unknown>;
  /** Display fallback used when provider-native history cannot be hydrated. */
  messages?: ChatMessage[];
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
  orchestratorMode?: boolean;
  usage?: UsageInfo;
  /** Assistant checkpoint identifier for resumeAtMessageId after rewind. */
  resumeAtMessageId?: string;
  /** UI metadata for rendering vault search source rows after hydration. */
  vaultSearchContexts?: PersistedVaultSearchContext[];
  /** UI metadata for rendering assistant response headers after hydration. */
  assistantResponseMetadata?: PersistedAssistantResponseMetadata[];
}

/**
 * Normalized stream chunk emitted by the active provider runtime.
 *
 * All providers must emit: text, tool_use, tool_result, error, done, usage.
 * Provider-specific behavior must be normalized before reaching this contract.
 * Providers may keep provider-native turn metadata internally and expose it via
 * runtime methods instead of encoding it as stream-control chunks.
 */
export type StreamChunk = ChatContentItem | ChatTurnLifecycleChunk;

/**
 * What a provider is *saying*, as a surface draws it.
 *
 * The content half of `StreamChunk`, named because M5 needs it to have a name:
 * the structural deletion gate searches for `StreamChunk`, and the plan says a
 * neutral content type that still needs streamed rendering "receives a new
 * projection-specific name" rather than being retained under ambiguous
 * ownership. The shape is unchanged — it is what the chat column already draws,
 * produced by provider normalizers proven against real transcripts — so this is
 * a split and a rename, not a redesign.
 *
 * `usage` is here rather than in the lifecycle half, which is worth stating
 * because it looks like a fact about the run: no part of the kernel carries
 * token counts, and the only thing that knows them is the provider payload this
 * arrives in. It is content because that is where it comes from.
 */
export type ChatContentItem =
  | { type: 'text'; content: string; phase?: AssistantTextPhase }
  | { type: 'thinking'; content: string }
  | {
    type: 'progress';
    id: string;
    content: string;
    state?: ProgressState;
    items?: ProgressItem[];
    append?: boolean;
  }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult }
  | { type: 'tool_output'; id: string; content: string }
  | { type: 'notice'; content: string; level?: 'info' | 'warning' }
  | {
    type: 'usage';
    usage: UsageInfo;
    sessionId?: string | null;
    /** Whether the reported context belongs only to the parent session or may aggregate child agents. */
    usageScope?: 'parent' | 'aggregate';
  }
  | { type: 'context_compacted' }
  | { type: 'async_subagent_result'; agentId: string; status: 'completed' | 'error'; result?: string }
  | { type: 'subagent_tool_use'; subagentId: string; id: string; name: string; input: Record<string, unknown> }
  | { type: 'subagent_tool_result'; subagentId: string; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult };

/**
 * The turn's shape, as the legacy stream had to signal it inline.
 *
 * Every one of these is something the execution projection now states as a
 * fact: a turn starts because a run started, it ends because the run reached a
 * terminal, a failure is that terminal's reason, and the thinking indicator
 * follows the run's state. They are the variants the M5 seam deletion removes,
 * which is why they are named apart from the content that stays.
 *
 * **One left.** The turn-ended variant is gone: the only emitter was Codex's
 * router and the only reader was Codex's own presenter, filtering it out again
 * before anything saw it. What remains is a failure, and it is not dead the way
 * that one was — the auto-turn path, which renders a turn the backend started
 * rather than one a surface asked for, has no projection to read a terminal off
 * and carries the failure in the stream. It goes when that path does.
 */
export type ChatTurnLifecycleChunk =
  | { type: 'error'; content: string };

/**
 * Context window usage information.
 *
 * `contextTokens` is the provider-computed total token count in the context window.
 * Claude sets it to `inputTokens + cacheCreationInputTokens + cacheReadInputTokens`;
 * other providers should set it to their equivalent total.
 *
 * Cache token fields are optional — only providers with prompt caching (Claude)
 * populate them. Feature code should use `contextTokens` for display, not recompute
 * from the cache breakdown.
 */
export interface UsageInfo {
  model?: string;
  inputTokens: number;
  /** Prompt caching: tokens used to create cache entries. Claude-specific; 0 if omitted. */
  cacheCreationInputTokens?: number;
  /** Prompt caching: tokens read from cache. Claude-specific; 0 if omitted. */
  cacheReadInputTokens?: number;
  contextWindow: number;
  /** True when `contextWindow` came from provider runtime data instead of a local heuristic. */
  contextWindowIsAuthoritative?: boolean;
  contextTokens: number;
  percentage: number;
}
