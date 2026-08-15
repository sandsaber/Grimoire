import * as fs from 'node:fs/promises';

import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import { isWriteEditTool, TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { ChatMessage, ContentBlock, ToolCallInfo } from '../../../core/types';
import { extractUserQuery } from '../../../utils/context';
import { extractDiffData } from '../../../utils/diff';
import {
  normalizeGrokToolInput,
  normalizeGrokToolName,
  normalizeGrokToolUseResult,
} from '../normalization/grokToolNormalization';
import { buildManagedGrokProcessEnv, resolveGrokChatHistoryPath } from '../runtime/GrokPaths';
import type { GrokProviderState } from '../types';

type StoredRow = Record<string, unknown>;

interface StoredMessage {
  info: StoredRow;
  parts: StoredRow[];
}

interface GrokJsonlEvent {
  content?: unknown;
  summary?: unknown;
  syntheticReason?: unknown;
  synthetic_reason?: unknown;
  tool_call_id?: unknown;
  tool_calls?: unknown;
  type?: unknown;
}

interface AssistantDraft {
  assistantMessageId: string;
  content: string;
  contentBlocks: ContentBlock[];
  id: string;
  timestamp: number;
  toolCalls: ToolCallInfo[];
}

export async function loadGrokSessionMessages(
  sessionId: string,
  providerState?: GrokProviderState,
  workspacePath?: string | null,
): Promise<ChatMessage[]> {
  const resolvedWorkspacePath = workspacePath ?? providerState?.workspacePath ?? null;
  const historyPath = resolveGrokChatHistoryPath(
    sessionId,
    resolvedWorkspacePath,
    providerState?.sessionDirPath ?? null,
    resolvedWorkspacePath
      ? buildManagedGrokProcessEnv(resolvedWorkspacePath)
      : process.env,
  );
  if (!historyPath) {
    return [];
  }

  try {
    const rawHistory = await fs.readFile(historyPath, 'utf8');
    return parseGrokChatHistoryJsonl(rawHistory);
  } catch {
    return [];
  }
}

export function parseGrokChatHistoryJsonl(rawHistory: string): ChatMessage[] {
  const events = rawHistory
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as GrokJsonlEvent;
        return isPlainObject(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });

  const messages: ChatMessage[] = [];
  let assistantDraft: AssistantDraft | null = null;
  let sequence = 0;

  const flushAssistant = (): void => {
    if (!assistantDraft) {
      return;
    }

    const content = assistantDraft.content.trim();
    messages.push({
      assistantMessageId: assistantDraft.assistantMessageId,
      content,
      contentBlocks: assistantDraft.contentBlocks.length > 0 ? assistantDraft.contentBlocks : undefined,
      id: assistantDraft.id,
      role: 'assistant',
      timestamp: assistantDraft.timestamp,
      toolCalls: assistantDraft.toolCalls.length > 0 ? assistantDraft.toolCalls : undefined,
    });
    assistantDraft = null;
  };

  const ensureAssistantDraft = (): AssistantDraft => {
    if (!assistantDraft) {
      sequence += 1;
      assistantDraft = {
        assistantMessageId: `grok-assistant-${sequence}`,
        content: '',
        contentBlocks: [],
        id: `grok-assistant-${sequence}`,
        timestamp: sequence * 1_000,
        toolCalls: [],
      };
    }
    return assistantDraft;
  };

  for (const event of events) {
    const type = getString(event.type);
    if (!type || type === 'system') {
      continue;
    }

    if (type === 'user') {
      if (isSyntheticGrokHistoryEvent(event)) {
        continue;
      }
      flushAssistant();
      sequence += 1;
      const promptText = extractGrokUserPrompt(event.content);
      if (!promptText) {
        continue;
      }

      messages.push({
        assistantMessageId: undefined,
        content: promptText,
        id: `grok-user-${sequence}`,
        role: 'user',
        timestamp: sequence * 1_000,
        userMessageId: `grok-user-${sequence}`,
      });
      continue;
    }

    if (type === 'reasoning') {
      const draft = ensureAssistantDraft();
      const thinkingText = extractGrokReasoningText(event.summary);
      if (thinkingText) {
        draft.contentBlocks.push({
          content: thinkingText,
          type: 'thinking',
        });
      }
      continue;
    }

    if (type === 'assistant') {
      const draft = ensureAssistantDraft();
      const text = getString(event.content);
      if (text) {
        draft.content += text;
        draft.contentBlocks.push({
          content: text,
          type: 'text',
        });
      }

      for (const toolCall of normalizeGrokJsonlToolCalls(event.tool_calls)) {
        draft.toolCalls.push(toolCall);
        draft.contentBlocks.push({
          toolId: toolCall.id,
          type: 'tool_use',
        });
      }
      continue;
    }

    if (type === 'tool_result') {
      const draft = ensureAssistantDraft();
      const toolCallId = getString(event.tool_call_id);
      if (!toolCallId) {
        continue;
      }

      const resultText = stringifyGrokToolResultContent(event.content);
      const toolCall = draft.toolCalls.find((entry) => entry.id === toolCallId);
      if (!toolCall) {
        continue;
      }

      toolCall.result = resultText;
      toolCall.status = 'completed';
      const toolUseResult = normalizeGrokToolUseResult(toolCall.name, toolCall.input, {
        output: resultText,
      });
      if (toolCall.name === TOOL_ASK_USER_QUESTION) {
        toolCall.resolvedAnswers = toolUseResult?.answers as ToolCallInfo['resolvedAnswers']
          ?? extractResolvedAnswersFromResultText(resultText);
      }
      if (isWriteEditTool(toolCall.name)) {
        const diffData = extractDiffData(toolUseResult, toolCall);
        if (diffData) {
          toolCall.diffData = diffData;
        }
      }
    }
  }

  flushAssistant();
  return mergeAdjacentAssistantMessages(messages);
}

export function isImportedGrokSystemReminder(message: ChatMessage): boolean {
  if (message.role !== 'user') {
    return false;
  }

  const content = message.content.trim();
  return content.startsWith('<system-reminder>\nThe following skills are available for use:')
    && content.endsWith('</system-reminder>');
}

/** Grok Build environment harness that must never appear as a chat bubble. */
export function isImportedGrokUserInfoMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') {
    return false;
  }

  const content = message.content.trim();
  return /^<user_info\b[^>]*>[\s\S]*<\/user_info>$/i.test(content);
}

/**
 * Normalize already-persisted Grok user bubbles (strip harness tags / drop env-only).
 * Returns null when the message should be removed from the transcript.
 */
export function normalizeImportedGrokUserMessage(message: ChatMessage): ChatMessage | null {
  if (message.role !== 'user') {
    return message;
  }

  if (isImportedGrokSystemReminder(message) || isImportedGrokUserInfoMessage(message)) {
    return null;
  }

  const rawContent = message.content.trim()
    ? message.content
    : (message.displayContent ?? '');
  const content = extractUserQuery(rawContent);
  if (!content) {
    return null;
  }

  if (content === message.content && content === (message.displayContent ?? content)) {
    return message;
  }

  return {
    ...message,
    content,
    displayContent: content,
  };
}

function isSyntheticGrokHistoryEvent(event: GrokJsonlEvent): boolean {
  return Boolean(
    getString(event.synthetic_reason)
    || getString(event.syntheticReason),
  );
}

export function mapGrokMessages(messages: StoredMessage[]): ChatMessage[] {
  return mergeAdjacentAssistantMessages(messages
    .map((message) => mapStoredMessage(message))
    .filter((message): message is ChatMessage => message !== null));
}

function mapStoredMessage(message: StoredMessage): ChatMessage | null {
  const role = getString(message.info.role);
  const id = getString(message.info.id);
  if (!id || (role !== 'user' && role !== 'assistant')) {
    return null;
  }

  const createdAt = getNestedNumber(message.info, ['time', 'created'])
    ?? getNumber(message.info.time_created)
    ?? Date.now();

  if (role === 'user') {
    const promptText = extractVisibleUserPrompt(getJoinedTextParts(message.parts));
    return {
      assistantMessageId: undefined,
      content: promptText,
      id,
      role: 'user',
      timestamp: createdAt,
      userMessageId: id,
    };
  }

  const contentBlocks = buildAssistantContentBlocks(message.parts);
  const toolCalls = buildAssistantToolCalls(message.parts);
  const completedAt = getNestedNumber(message.info, ['time', 'completed']);
  const durationSeconds = completedAt && completedAt >= createdAt
    ? Math.max(0, (completedAt - createdAt) / 1_000)
    : undefined;

  return {
    assistantMessageId: id,
    content: contentBlocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.content)
      .join(''),
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    durationSeconds,
    id,
    role: 'assistant',
    timestamp: createdAt,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function extractGrokUserPrompt(content: unknown): string {
  if (typeof content === 'string') {
    return extractVisibleUserPrompt(extractUserQuery(content));
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const text = content
    .flatMap((entry) => {
      if (!isPlainObject(entry) || getString(entry.type) !== 'text') {
        return [];
      }
      const value = getString(entry.text);
      return value ? [value] : [];
    })
    .join('\n');

  return extractVisibleUserPrompt(extractUserQuery(text));
}

function extractGrokReasoningText(summary: unknown): string {
  if (!Array.isArray(summary)) {
    return '';
  }

  return summary
    .flatMap((entry) => {
      if (!isPlainObject(entry) || getString(entry.type) !== 'summary_text') {
        return [];
      }
      const text = getString(entry.text)?.trim();
      return text ? [text] : [];
    })
    .join('\n');
}

function normalizeGrokJsonlToolCalls(value: unknown): ToolCallInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }

    const id = getString(entry.id);
    const rawName = getString(entry.name);
    if (!id || !rawName) {
      return [];
    }

    const input = parseGrokToolArguments(entry.arguments);
    const name = normalizeGrokToolName(rawName);
    return [{
      id,
      input: normalizeGrokToolInput(rawName, input),
      name,
      status: 'running' as const,
    }];
  });
}

function parseGrokToolArguments(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyGrokToolResultContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined || value === null) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractVisibleUserPrompt(rawPrompt: string): string {
  const promptText = extractUserQuery(rawPrompt);
  const roleMarkerPattern = /(^|\n)(User|Assistant):[ \t]*/g;
  const markers: Array<{ role: 'User' | 'Assistant'; start: number; contentStart: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = roleMarkerPattern.exec(promptText)) !== null) {
    const linePrefix = match[1] ?? '';
    markers.push({
      role: match[2] as 'User' | 'Assistant',
      start: match.index + linePrefix.length,
      contentStart: roleMarkerPattern.lastIndex,
    });
  }

  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index];
    if (marker.role !== 'User') {
      continue;
    }
    const nextMarker = markers[index + 1];
    return promptText
      .slice(marker.contentStart, nextMarker?.start ?? promptText.length)
      .trim();
  }

  return promptText.trim();
}

function mergeAdjacentAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (
      message.role === 'assistant'
      && previous?.role === 'assistant'
      && !message.isInterrupt
      && !previous.isInterrupt
    ) {
      previous.content += message.content;
      previous.assistantMessageId = message.assistantMessageId ?? previous.assistantMessageId;
      previous.durationFlavorWord = message.durationFlavorWord ?? previous.durationFlavorWord;
      previous.durationSeconds = mergeAssistantDurationSeconds(previous, message);
      previous.toolCalls = mergeOptionalArrays(previous.toolCalls, message.toolCalls);
      previous.contentBlocks = mergeOptionalArrays(previous.contentBlocks, message.contentBlocks);
      continue;
    }

    merged.push(message);
  }

  return merged;
}

function mergeOptionalArrays<T>(left?: T[], right?: T[]): T[] | undefined {
  if (!left?.length && !right?.length) {
    return undefined;
  }

  return [
    ...(left ?? []),
    ...(right ?? []),
  ];
}

function mergeAssistantDurationSeconds(
  first: ChatMessage,
  next: ChatMessage,
): number | undefined {
  const firstEnd = getMessageCompletionTime(first);
  const nextEnd = getMessageCompletionTime(next);
  if (firstEnd === null && nextEnd === null) {
    return undefined;
  }

  const end = Math.max(firstEnd ?? first.timestamp, nextEnd ?? next.timestamp);
  return Math.max(0, (end - first.timestamp) / 1_000);
}

function getMessageCompletionTime(message: ChatMessage): number | null {
  if (typeof message.durationSeconds !== 'number') {
    return null;
  }

  return message.timestamp + (message.durationSeconds * 1_000);
}

function buildAssistantContentBlocks(parts: StoredRow[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const part of parts) {
    switch (getString(part.type)) {
      case 'reasoning': {
        const text = getString(part.text)?.trim();
        if (!text) {
          break;
        }
        blocks.push({
          content: text,
          durationSeconds: getDurationSeconds(part),
          type: 'thinking',
        });
        break;
      }
      case 'text': {
        const text = getString(part.text);
        if (!text || getBoolean(part.ignored)) {
          break;
        }
        blocks.push({
          content: text,
          type: 'text',
        });
        break;
      }
      case 'tool': {
        const toolId = getString(part.callID);
        if (!toolId) {
          break;
        }
        blocks.push({
          toolId,
          type: 'tool_use',
        });
        break;
      }
    }
  }

  return blocks;
}

function buildAssistantToolCalls(parts: StoredRow[]): ToolCallInfo[] {
  return parts.flatMap((part) => {
    if (getString(part.type) !== 'tool') {
      return [];
    }

    const id = getString(part.callID);
    const rawName = getString(part.tool);
    const state = getObject(part.state);
    const status = mapToolStatus(getString(state?.status));
    if (!id || !rawName || !status) {
      return [];
    }

    const input = normalizeGrokToolInput(rawName, getObject(state?.input) ?? {});
    const name = normalizeGrokToolName(rawName);
    const result = getString(state?.output) ?? getString(state?.error) ?? undefined;
    const toolUseResult = normalizeGrokToolUseResult(rawName, input, {
      ...(result ? { output: result } : {}),
      ...(getObject(state?.metadata) ? { metadata: getObject(state?.metadata) } : {}),
    });

    const toolCall: ToolCallInfo = {
      id,
      input,
      name,
      result,
      status,
    };

    if (name === TOOL_ASK_USER_QUESTION) {
      toolCall.resolvedAnswers = toolUseResult?.answers as ToolCallInfo['resolvedAnswers']
        ?? extractResolvedAnswersFromResultText(result);
    }

    if (status === 'completed' && isWriteEditTool(name)) {
      const diffData = extractDiffData(toolUseResult, toolCall);
      if (diffData) {
        toolCall.diffData = diffData;
      }
    }

    return [toolCall];
  });
}

function getJoinedTextParts(parts: StoredRow[]): string {
  return parts
    .filter((part) => getString(part.type) === 'text' && !getBoolean(part.ignored))
    .map((part) => getString(part.text) ?? '')
    .join('');
}

function getDurationSeconds(part: StoredRow): number | undefined {
  const start = getNestedNumber(part, ['time', 'start']);
  const end = getNestedNumber(part, ['time', 'end']);
  if (start === null || end === null || end < start) {
    return undefined;
  }

  return Math.max(0, (end - start) / 1_000);
}

function mapToolStatus(status: string | null): ToolCallInfo['status'] | null {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function getObject(value: unknown): StoredRow | null {
  return isPlainObject(value) ? value : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function getNestedNumber(
  value: StoredRow,
  keys: string[],
): number | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isPlainObject(current)) {
      return null;
    }
    current = current[key];
  }
  return getNumber(current);
}
