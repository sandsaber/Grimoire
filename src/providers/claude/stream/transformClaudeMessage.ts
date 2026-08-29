import type { SDKMessage, SDKResultError } from '@anthropic-ai/claude-agent-sdk';

import type { TodoItem } from '../../../core/tools/todo';
import { TOOL_TODO_WRITE } from '../../../core/tools/toolNames';
import type { SDKToolUseResult, StreamChunk, UsageInfo } from '../../../core/types';
import { isBlockedMessage } from '../sdk/messages';
import { extractToolResultContent } from '../sdk/toolResultContent';
import type { TransformEvent } from '../sdk/types';
import { getContextWindowSize, isDefaultClaudeModel } from '../types/models';
import {
  CLAUDE_TASK_PLAN_TOOL_ID,
  type ClaudeTaskPlanState,
  recordTaskToolResult,
  recordTaskToolUse,
} from './claudeTaskPlanState';
import { createTransformStreamState, type TransformStreamState } from './toolInputStreamState';

type ToolUseFields = { id: string; name: string; input: Record<string, unknown> };
type ToolResultFields = { id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult };
type AsyncSubagentResultStatus = Extract<StreamChunk, { type: 'async_subagent_result' }>['status'];

export { createTransformStreamState };

function getToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

/**
 * A tool call, and whose it is.
 *
 * **One chunk type either way now.** A subagent's call used to be its own
 * variant of the neutral union — the same fields plus this id — so the column
 * had to know that a subagent's tool call is a different kind of thing from a
 * tool call. It is the same thing, belonging to something else, and the
 * ownership is a field.
 */
function emitToolUse(parentToolUseId: string | null, fields: ToolUseFields): StreamChunk {
  return {
    type: 'tool_use',
    ...fields,
    ...(parentToolUseId === null ? {} : { subagentId: parentToolUseId }),
  };
}

function emitToolResult(parentToolUseId: string | null, fields: ToolResultFields): StreamChunk {
  return {
    type: 'tool_result',
    ...fields,
    ...(parentToolUseId === null ? {} : { subagentId: parentToolUseId }),
  };
}

/**
 * Replays the accumulated task plan as TodoWrite input.
 *
 * The plan panel is fed by whole-list TodoWrite chunks, and Claude Code 2.1.233
 * only emits incremental task calls. Reusing one id keeps this a single
 * updating entry rather than a new card per task call. Subagent plans are left
 * out: the panel tracks the main agent's plan.
 *
 * The result has to follow the call: a synthesized tool use that never
 * completes leaves the plan entry running forever.
 */
function* emitTaskPlan(
  parentToolUseId: string | null,
  todos: TodoItem[] | null,
): Generator<StreamChunk> {
  // `null` is "no plan to say anything about"; an **empty array** is "the plan
  // is now empty", which has to be published or the task the user just deleted
  // stays on screen.
  if (parentToolUseId !== null || todos === null) return;
  yield { type: 'tool_use', id: CLAUDE_TASK_PLAN_TOOL_ID, name: TOOL_TODO_WRITE, input: { todos } };
  yield { type: 'tool_result', id: CLAUDE_TASK_PLAN_TOOL_ID, content: 'Plan updated', isError: false };
}

function normalizeTaskNotificationStatus(status: unknown): AsyncSubagentResultStatus {
  return status === 'completed' ? 'completed' : 'error';
}

function normalizeTaskNotificationResult(status: AsyncSubagentResultStatus, summary: unknown): string {
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary.trim();
  }
  return status === 'completed' ? 'Background task completed.' : 'Background task failed.';
}

function transformTaskNotification(message: SDKMessage): StreamChunk | null {
  if (message.type !== 'system' || message.subtype !== 'task_notification') {
    return null;
  }

  const record = message as unknown as Record<string, unknown>;
  const taskId = record.task_id;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return null;
  }

  const status = normalizeTaskNotificationStatus(record.status);
  return {
    type: 'async_subagent_result',
    agentId: taskId,
    status,
    result: normalizeTaskNotificationResult(status, record.summary),
  };
}

export interface TransformOptions {
  /** The intended model from settings/query (used for context window size). */
  intendedModel?: string;
  /** Custom context limits from settings (model ID → tokens). */
  customContextLimits?: Record<string, number>;
  /** Context resolved from live model discovery before result metadata arrives. */
  resolvedContextWindow?: number;
  /** Tracks active streamed tool blocks so input_json_delta can be normalized. */
  streamState?: TransformStreamState;
  /** Tracks prompt-token usage across Anthropic-compatible stream events. */
  usageState?: TransformUsageState;
  /** Accumulates Claude's incremental task calls into a whole-plan snapshot. */
  taskPlanState?: ClaudeTaskPlanState;
}

export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface PromptUsageSnapshot {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  contextTokens: number;
}

export interface TransformUsageState {
  clear(): void;
  mergePromptUsage(usage: MessageUsage): PromptUsageSnapshot;
  getPromptUsage(): PromptUsageSnapshot;
  hasEmitted(promptUsage: PromptUsageSnapshot): boolean;
  markEmitted(promptUsage: PromptUsageSnapshot): void;
}

interface ContextWindowEntry {
  model: string;
  contextWindow: number;
}

interface ClaudeModelSignature {
  normalizedModel: string;
  family: 'haiku' | 'sonnet' | 'opus';
  is1M: boolean;
  major?: string;
  minor?: string;
  date?: string;
}

function isResultError(message: { type: 'result'; subtype: string }): message is SDKResultError {
  return !!message.subtype && message.subtype !== 'success';
}

function normalizeClaudeModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const claudeIndex = normalized.indexOf('claude-');
  return claudeIndex >= 0 ? normalized.slice(claudeIndex) : normalized;
}

function parseClaudeModelSignature(model: string): ClaudeModelSignature | null {
  const normalized = normalizeClaudeModelId(model);
  if (normalized === 'haiku') {
    return { normalizedModel: normalized, family: 'haiku', is1M: false };
  }
  if (normalized === 'sonnet' || normalized === 'sonnet[1m]') {
    return { normalizedModel: normalized, family: 'sonnet', is1M: normalized.endsWith('[1m]') };
  }
  if (normalized === 'opus' || normalized === 'opus[1m]') {
    return { normalizedModel: normalized, family: 'opus', is1M: normalized.endsWith('[1m]') };
  }

  const versionedMatch = normalized.match(
    /^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d+))?(?:-(\d{8}))?(?:-v\d+:\d+)?(\[1m\])?$/,
  );
  if (versionedMatch) {
    const [, familyMatch, major, minor, date, oneMillionSuffix] = versionedMatch;
    const family = familyMatch as ClaudeModelSignature['family'];
    return {
      normalizedModel: normalized,
      family,
      is1M: oneMillionSuffix === '[1m]',
      major,
      minor,
      date,
    };
  }

  return null;
}

function findUniqueEntry(
  entries: ContextWindowEntry[],
  predicate: (entry: ContextWindowEntry) => boolean,
): ContextWindowEntry | null {
  const matches = entries.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function matchClaudeModelSignature(
  entrySignature: ClaudeModelSignature | null,
  intendedSignature: ClaudeModelSignature,
  options?: { ignoreIs1M?: boolean },
): boolean {
  if (!entrySignature || entrySignature.family !== intendedSignature.family) {
    return false;
  }
  if (!options?.ignoreIs1M && entrySignature.is1M !== intendedSignature.is1M) {
    return false;
  }
  if (intendedSignature.major && entrySignature.major !== intendedSignature.major) {
    return false;
  }
  if (intendedSignature.minor && entrySignature.minor !== intendedSignature.minor) {
    return false;
  }
  if (intendedSignature.date && entrySignature.date !== intendedSignature.date) {
    return false;
  }
  return true;
}

function selectContextWindowEntry(
  modelUsage: Record<string, { contextWindow?: number }>,
  intendedModel?: string
): ContextWindowEntry | null {
  const entries: ContextWindowEntry[] = Object.entries(modelUsage)
    .flatMap(([model, usage]) =>
      typeof usage?.contextWindow === 'number' && usage.contextWindow > 0
        ? [{ model, contextWindow: usage.contextWindow }]
        : []
    );

  if (entries.length === 0) {
    return null;
  }

  if (entries.length === 1) {
    return entries[0];
  }

  if (!intendedModel) {
    return null;
  }

  const literalExactMatch = entries.find((entry) => entry.model === intendedModel);
  if (literalExactMatch) {
    return literalExactMatch;
  }

  const normalizedIntendedModel = normalizeClaudeModelId(intendedModel);
  const exactMatch = findUniqueEntry(entries, (entry) => normalizeClaudeModelId(entry.model) === normalizedIntendedModel);
  if (exactMatch) {
    return exactMatch;
  }

  if (!isDefaultClaudeModel(intendedModel)) {
    return null;
  }

  const intendedSignature = parseClaudeModelSignature(intendedModel);
  if (!intendedSignature) {
    return null;
  }

  const strictSignatureMatch = findUniqueEntry(entries, (entry) =>
    matchClaudeModelSignature(parseClaudeModelSignature(entry.model), intendedSignature),
  );
  if (strictSignatureMatch) {
    return strictSignatureMatch;
  }

  const hasVersionedTarget = Boolean(intendedSignature.major || intendedSignature.date);
  if (!hasVersionedTarget) {
    return null;
  }

  return findUniqueEntry(entries, (entry) =>
    matchClaudeModelSignature(parseClaudeModelSignature(entry.model), intendedSignature, { ignoreIs1M: true }),
  );
}

const EMPTY_PROMPT_USAGE: PromptUsageSnapshot = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  contextTokens: 0,
};

function normalizeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function hasPromptUsageField(usage: unknown): usage is MessageUsage {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return false;
  }

  const record = usage as Record<string, unknown>;
  return typeof record.input_tokens === 'number'
    || typeof record.cache_creation_input_tokens === 'number'
    || typeof record.cache_read_input_tokens === 'number';
}

function toPromptUsageSnapshot(usage: MessageUsage): PromptUsageSnapshot {
  const inputTokens = normalizeTokenCount(usage.input_tokens);
  const cacheCreationInputTokens = normalizeTokenCount(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = normalizeTokenCount(usage.cache_read_input_tokens);
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function mergePromptUsage(
  current: PromptUsageSnapshot,
  usage: MessageUsage,
): PromptUsageSnapshot {
  const next = toPromptUsageSnapshot(usage);
  const inputTokens = Math.max(current.inputTokens, next.inputTokens);
  const cacheCreationInputTokens = Math.max(current.cacheCreationInputTokens, next.cacheCreationInputTokens);
  const cacheReadInputTokens = Math.max(current.cacheReadInputTokens, next.cacheReadInputTokens);
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function samePromptUsage(a: PromptUsageSnapshot, b: PromptUsageSnapshot): boolean {
  return a.inputTokens === b.inputTokens
    && a.cacheCreationInputTokens === b.cacheCreationInputTokens
    && a.cacheReadInputTokens === b.cacheReadInputTokens
    && a.contextTokens === b.contextTokens;
}

function buildUsageInfo(promptUsage: PromptUsageSnapshot, options?: TransformOptions): UsageInfo {
  const model = options?.intendedModel ?? 'sonnet';
  const contextWindow = typeof options?.resolvedContextWindow === 'number'
    && Number.isFinite(options.resolvedContextWindow)
    && options.resolvedContextWindow > 0
    ? options.resolvedContextWindow
    : getContextWindowSize(model, options?.customContextLimits);
  const percentage = Math.min(100, Math.max(0, Math.round((promptUsage.contextTokens / contextWindow) * 100)));

  return {
    model,
    inputTokens: promptUsage.inputTokens,
    cacheCreationInputTokens: promptUsage.cacheCreationInputTokens,
    cacheReadInputTokens: promptUsage.cacheReadInputTokens,
    contextWindow,
    contextTokens: promptUsage.contextTokens,
    percentage,
  };
}

export function createTransformUsageState(): TransformUsageState {
  let promptUsage: PromptUsageSnapshot = { ...EMPTY_PROMPT_USAGE };
  let lastEmittedPromptUsage: PromptUsageSnapshot | null = null;

  return {
    clear(): void {
      promptUsage = { ...EMPTY_PROMPT_USAGE };
      lastEmittedPromptUsage = null;
    },

    mergePromptUsage(usage: MessageUsage): PromptUsageSnapshot {
      promptUsage = mergePromptUsage(promptUsage, usage);
      return promptUsage;
    },

    getPromptUsage(): PromptUsageSnapshot {
      return { ...promptUsage };
    },

    hasEmitted(nextPromptUsage: PromptUsageSnapshot): boolean {
      return lastEmittedPromptUsage !== null && samePromptUsage(lastEmittedPromptUsage, nextPromptUsage);
    },

    markEmitted(nextPromptUsage: PromptUsageSnapshot): void {
      lastEmittedPromptUsage = { ...nextPromptUsage };
    },
  };
}

function maybeEmitUsageFromPromptUsage(
  promptUsage: PromptUsageSnapshot,
  options?: TransformOptions,
  behavior: { emitZeroUsage?: boolean } = {},
): StreamChunk | null {
  if (promptUsage.contextTokens <= 0) {
    return behavior.emitZeroUsage
      ? { type: 'usage', usage: buildUsageInfo(promptUsage, options) }
      : null;
  }

  if (options?.usageState?.hasEmitted(promptUsage)) {
    return null;
  }

  options?.usageState?.markEmitted(promptUsage);
  return { type: 'usage', usage: buildUsageInfo(promptUsage, options) };
}

/**
 * Transform SDK message to StreamChunk format.
 * One SDK message can yield multiple chunks (e.g., text + tool_use blocks).
 */
export function* transformSDKMessage(
  message: SDKMessage,
  options?: TransformOptions
): Generator<TransformEvent> {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init' && message.session_id) {
        yield {
          type: 'session_init',
          sessionId: message.session_id,
          agents: message.agents,
          permissionMode: message.permissionMode,
        };
      } else if (message.subtype === 'compact_boundary') {
        yield { type: 'context_compacted' };
      } else if (message.subtype === 'task_notification') {
        const notification = transformTaskNotification(message);
        if (notification) {
          yield notification;
        }
      }
      break;

    case 'assistant': {
      const parentToolUseId = message.parent_tool_use_id ?? null;

      // Errors on assistant messages (e.g. rate_limit, billing_error)
      if (message.error) {
        yield { type: 'error', content: message.error };
      }

      if (message.message?.content && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type === 'thinking' && block.thinking) {
            if (parentToolUseId === null) {
              yield { type: 'thinking', content: block.thinking };
            }
          } else if (block.type === 'text' && block.text && block.text.trim() !== '(no content)') {
            if (parentToolUseId === null) {
              yield { type: 'text', content: block.text };
            }
          } else if (block.type === 'tool_use') {
            const toolUseId = block.id
              || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            const toolName = block.name || 'unknown';
            const toolInput = getToolInput(block.input);
            yield emitToolUse(parentToolUseId, { id: toolUseId, name: toolName, input: toolInput });
            if (options?.taskPlanState) {
              yield* emitTaskPlan(
                parentToolUseId,
                recordTaskToolUse(options.taskPlanState, toolUseId, toolName, toolInput),
              );
            }
          }
        }
      }

      options?.streamState?.clearParent(parentToolUseId);

      // Extract usage from main agent assistant messages only (not subagent)
      // This gives accurate per-turn context usage without subagent token pollution
      const usage = (message.message as { usage?: MessageUsage } | undefined)?.usage;
      if (parentToolUseId === null && usage) {
        if (options?.usageState) {
          const promptUsage = options.usageState.mergePromptUsage(usage);
          const usageChunk = maybeEmitUsageFromPromptUsage(promptUsage, options, { emitZeroUsage: true });
          if (usageChunk) {
            yield usageChunk;
          }
        } else {
          yield { type: 'usage', usage: buildUsageInfo(toPromptUsageSnapshot(usage), options) };
        }
      }
      break;
    }

    case 'user': {
      const parentToolUseId = message.parent_tool_use_id ?? null;

      // Check for blocked tool calls (from hook denials)
      if (isBlockedMessage(message)) {
        yield {
          type: 'notice',
          content: message._blockReason,
          level: 'warning',
        };
        break;
      }
      // User messages can contain tool results
      if (message.tool_use_result !== undefined && message.parent_tool_use_id) {
        const toolUseResult = (message.tool_use_result ?? undefined) as SDKToolUseResult | undefined;
        yield emitToolResult(parentToolUseId, {
          id: message.parent_tool_use_id,
          content: extractToolResultContent(message.tool_use_result, { fallbackIndent: 2 }),
          isError: false,
          ...(toolUseResult !== undefined ? { toolUseResult } : {}),
        });
      }
      const resultContent = message.message?.content;
      if (options?.taskPlanState && message.tool_use_result !== undefined && Array.isArray(resultContent)) {
        // **One payload, so one block.** `tool_use_result` is a single object
        // on the message while the content array can carry several results —
        // Claude batches parallel tool results into one user message. Handing
        // that payload to every id filed a `TaskCreate` answer under whichever
        // call happened to come second, and consumed the pending create on the
        // way. With more than one result here, nothing can say which id the
        // payload belongs to, so nothing is recorded.
        const resultBlocks = resultContent.filter((block: unknown) => (
          typeof block !== 'string'
          && (block as { type?: string }).type === 'tool_result'
          && Boolean((block as { tool_use_id?: string }).tool_use_id)
        ));
        const only = resultBlocks.length === 1 ? resultBlocks[0] : undefined;
        if (only) {
          yield* emitTaskPlan(
            parentToolUseId,
            recordTaskToolResult(
              options.taskPlanState,
              (only as { tool_use_id: string }).tool_use_id,
              message.tool_use_result,
            ),
          );
        }
      }
      // Also check message.message.content for tool_result blocks
      if (message.message?.content && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type === 'tool_result') {
            const toolUseResult = (message.tool_use_result ?? undefined) as SDKToolUseResult | undefined;
            yield emitToolResult(parentToolUseId, {
              id: block.tool_use_id || message.parent_tool_use_id || '',
              content: extractToolResultContent(block.content, { fallbackIndent: 2 }),
              isError: block.is_error || false,
              ...(toolUseResult !== undefined ? { toolUseResult } : {}),
            });
          }
        }
      }
      break;
    }

    case 'stream_event': {
      const parentToolUseId = message.parent_tool_use_id ?? null;
      const event = message.event;
      if (parentToolUseId === null && event?.type === 'message_start') {
        options?.usageState?.clear();
        const usage = (event.message as { usage?: MessageUsage } | undefined)?.usage;
        if (usage && hasPromptUsageField(usage)) {
          if (options?.usageState) {
            options.usageState.mergePromptUsage(usage);
          } else {
            const usageChunk = maybeEmitUsageFromPromptUsage(toPromptUsageSnapshot(usage), options);
            if (usageChunk) {
              yield usageChunk;
            }
          }
        }
      } else if (parentToolUseId === null && event?.type === 'message_delta' && hasPromptUsageField(event.usage)) {
        if (options?.usageState) {
          const previousPromptUsage = options.usageState.getPromptUsage();
          const promptUsage = options.usageState.mergePromptUsage(event.usage);
          const shouldEmitDeltaUsage = previousPromptUsage.contextTokens <= 0
            || options.usageState.hasEmitted(previousPromptUsage);
          if (shouldEmitDeltaUsage) {
            const usageChunk = maybeEmitUsageFromPromptUsage(promptUsage, options);
            if (usageChunk) {
              yield usageChunk;
            }
          }
        } else {
          const usageChunk = maybeEmitUsageFromPromptUsage(toPromptUsageSnapshot(event.usage), options);
          if (usageChunk) {
            yield usageChunk;
          }
        }
      } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        const toolUseFields: ToolUseFields = {
          id: event.content_block.id || `tool-${Date.now()}`,
          name: event.content_block.name || 'unknown',
          input: getToolInput(event.content_block.input),
        };
        if (typeof event.index === 'number') {
          options?.streamState?.registerToolUse(parentToolUseId, event.index, toolUseFields);
        }
        yield emitToolUse(parentToolUseId, toolUseFields);
      } else if (event?.type === 'content_block_start' && event.content_block?.type === 'thinking') {
        if (parentToolUseId === null && event.content_block.thinking) {
          yield { type: 'thinking', content: event.content_block.thinking };
        }
      } else if (event?.type === 'content_block_start' && event.content_block?.type === 'text') {
        if (parentToolUseId === null && event.content_block.text) {
          yield { type: 'text', content: event.content_block.text };
        }
      } else if (event?.type === 'content_block_delta') {
        if (event.delta?.type === 'input_json_delta' && typeof event.index === 'number') {
          const toolUseFields = options?.streamState?.applyInputJsonDelta(
            parentToolUseId,
            event.index,
            event.delta.partial_json,
          );
          if (toolUseFields) {
            yield emitToolUse(parentToolUseId, toolUseFields);
          }
        } else if (parentToolUseId === null && event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          yield { type: 'thinking', content: event.delta.thinking };
        } else if (parentToolUseId === null && event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'text', content: event.delta.text };
        }
      } else if (event?.type === 'content_block_stop' && typeof event.index === 'number') {
        options?.streamState?.clearContentBlock(parentToolUseId, event.index);
      }
      break;
    }

    case 'result':
      options?.streamState?.clearAll();
      if (options?.usageState) {
        const usageChunk = maybeEmitUsageFromPromptUsage(options.usageState.getPromptUsage(), options);
        if (usageChunk) {
          yield usageChunk;
        }
        options.usageState.clear();
      }
      if (isResultError(message)) {
        const content = message.errors.filter((e) => e.trim().length > 0).join('\n');
        yield {
          type: 'error',
          content: content || `Result error: ${message.subtype}`,
        };
      }

      // Usage is now extracted from assistant messages for accuracy (excludes subagent tokens)
      // Result message usage is aggregated across main + subagents, causing inaccurate spikes

      if ('modelUsage' in message && message.modelUsage) {
        const modelUsage = message.modelUsage as Record<string, { contextWindow?: number }>;
        const selectedEntry = selectContextWindowEntry(modelUsage, options?.intendedModel);
        if (selectedEntry) {
          yield { type: 'context_window', contextWindow: selectedEntry.contextWindow };
        }
      }
      break;

    default:
      break;
  }
}
