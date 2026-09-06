import { promises as fs } from 'node:fs';

import { findCodexSessionFile } from '../history/CodexHistoryStore';
import type {
  AgentMessageItem,
  CollabAgentToolCallItem,
  ThreadItem,
  ThreadReadResult,
  Turn,
} from '../runtime/codexAppServerTypes';
import type { CodexExecutionConnection } from '../runtime/CodexExecutionConnection';
import type {
  CodexTurnReconciler,
  CodexTurnReconciliationEvidence,
} from './CodexExecutionBackend';

export interface CodexExecutionTranscriptReader {
  readTurn(threadId: string, turnId: string): Promise<Turn | null>;
}

const DEFAULT_MAX_RECONCILIATION_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_CONFIGURED_RECONCILIATION_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

/** Reconciles through app-server state first and bounded JSONL replay second. */
export class CodexExecutionTurnReconciler implements CodexTurnReconciler {
  constructor(
    private readonly connection: CodexExecutionConnection,
    private readonly transcript: CodexExecutionTranscriptReader,
  ) {}

  async reconcile(input: {
    readonly threadId: string;
    readonly turnId: string;
  }): Promise<CodexTurnReconciliationEvidence> {
    try {
      const snapshot = await this.connection.request<ThreadReadResult>('thread/read', {
        threadId: input.threadId,
        includeTurns: true,
      });
      const turn = snapshot.thread.turns.find(candidate => candidate.id === input.turnId);
      if (turn) {
        return { kind: 'turn', turn };
      }
      if (snapshot.thread.status.type === 'active') {
        return { kind: 'running' };
      }
    } catch {
      // A dead daemon is expected on this path; transcript replay remains available.
    }
    const replay = await this.transcript.readTurn(input.threadId, input.turnId);
    return replay ? { kind: 'turn', turn: replay } : { kind: 'unknown' };
  }
}

/** Provider-owned file reader used only for explicit reconciliation and replay. */
export class CodexJsonlExecutionTranscriptReader implements CodexExecutionTranscriptReader {
  constructor(
    private readonly sessionsRoot: string,
    private readonly maxTranscriptBytes = DEFAULT_MAX_RECONCILIATION_TRANSCRIPT_BYTES,
  ) {
    if (!Number.isSafeInteger(maxTranscriptBytes)
      || maxTranscriptBytes < 1
      || maxTranscriptBytes > MAX_CONFIGURED_RECONCILIATION_TRANSCRIPT_BYTES) {
      throw new Error('Codex reconciliation transcript byte limit is invalid.');
    }
  }

  async readTurn(threadId: string, turnId: string): Promise<Turn | null> {
    const path = findCodexSessionFile(threadId, this.sessionsRoot);
    if (!path) {
      return null;
    }
    try {
      const content = await readBoundedUtf8(path, this.maxTranscriptBytes);
      return content === null ? null : parseCodexExecutionTurn(content, turnId);
    } catch {
      return null;
    }
  }
}

async function readBoundedUtf8(path: string, maxBytes: number): Promise<string | null> {
  const file = await fs.open(path, 'r');
  try {
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    return offset > maxBytes
      ? null
      : bytes.subarray(0, offset).toString('utf8');
  } finally {
    await file.close();
  }
}

export function parseCodexExecutionTurn(content: string, turnId: string): Turn | null {
  let activeTurnId: string | undefined;
  let status: Turn['status'] | undefined;
  const items: ThreadItem[] = [];
  const calls = new Map<string, number>();

  for (const line of content.split(/\r?\n/u)) {
    const record = parseRecord(line);
    if (!record) {
      continue;
    }
    if (record.type === 'event_msg') {
      const payload = readRecord(record.payload);
      const eventType = readString(payload?.type);
      const eventTurnId = readString(payload?.turn_id)
        ?? readString(readRecord(payload?.info)?.id);
      if (eventType === 'task_started') {
        activeTurnId = eventTurnId;
        if (activeTurnId === turnId) {
          status = 'inProgress';
        }
        continue;
      }
      if (activeTurnId !== turnId && eventTurnId !== turnId) {
        continue;
      }
      if (eventType === 'agent_message') {
        const text = readString(payload?.text) ?? readString(payload?.message);
        if (text) {
          items.push(agentMessage(`jsonl-agent-${items.length + 1}`, text));
        }
      } else if (eventType === 'task_complete') {
        status = 'completed';
        activeTurnId = undefined;
      } else if (eventType === 'turn_aborted') {
        status = 'interrupted';
        activeTurnId = undefined;
      } else if (eventType === 'task_failed' || eventType === 'turn_failed') {
        status = 'failed';
        activeTurnId = undefined;
      }
      continue;
    }
    if (record.type !== 'response_item' || activeTurnId !== turnId) {
      continue;
    }
    const payload = readRecord(record.payload);
    if (!payload) {
      continue;
    }
    const payloadType = readString(payload?.type);
    if (payloadType === 'message' && payload?.role === 'assistant') {
      const text = extractMessageText(payload.content);
      if (text) {
        items.push(agentMessage(`jsonl-agent-${items.length + 1}`, text));
      }
      continue;
    }
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const callId = readString(payload?.call_id);
      const tool = normalizeCollaborationTool(readString(payload?.name));
      if (!callId || !tool) {
        continue;
      }
      const item: CollabAgentToolCallItem = {
        type: 'collabAgentToolCall',
        id: callId,
        tool,
        status: 'inProgress',
        arguments: sanitizeCollaborationArguments(
          tool,
          parseObject(payload.arguments ?? payload.input),
        ),
        result: null,
      };
      calls.set(callId, items.length);
      items.push(item);
      continue;
    }
    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      const callId = readString(payload?.call_id);
      const index = callId ? calls.get(callId) : undefined;
      if (index === undefined) {
        continue;
      }
      const current = items[index];
      if (!current || current.type !== 'collabAgentToolCall') {
        continue;
      }
      items[index] = {
        ...current,
        status: 'completed',
        result: parseValue(payload.output),
      };
    }
  }

  return status ? { id: turnId, items, status, error: null } : null;
}

function parseRecord(line: string): Record<string, unknown> | null {
  if (!line.trim()) {
    return null;
  }
  try {
    return readRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  return readRecord(parseValue(value)) ?? {};
}

function extractMessageText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.map(part => readString(readRecord(part)?.text) ?? '').join('');
}

function normalizeCollaborationTool(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return ({
    spawn_agent: 'spawnAgent',
    spawnAgent: 'spawnAgent',
    send_input: 'sendInput',
    sendInput: 'sendInput',
    wait: 'wait',
    close_agent: 'closeAgent',
    closeAgent: 'closeAgent',
    resume_agent: 'resumeAgent',
    resumeAgent: 'resumeAgent',
  } as Readonly<Record<string, string>>)[value] ?? null;
}

function sanitizeCollaborationArguments(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (tool === 'spawnAgent') {
    return pick(input, ['parent_agent_id', 'agent_type']);
  }
  if (tool === 'wait') {
    return pick(input, ['ids', 'timeout_ms']);
  }
  return pick(input, ['agent_id']);
}

function pick(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap(key => key in input ? [[key, input[key]]] : []),
  );
}

function agentMessage(id: string, text: string): AgentMessageItem {
  return {
    type: 'agentMessage',
    id,
    text,
    phase: 'final',
    memoryCitation: null,
  };
}
