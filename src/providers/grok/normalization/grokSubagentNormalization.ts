import type { ProviderSubagentLifecycleAdapter } from '../../../core/providers/types';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';

export const GROK_SUBAGENT_SPAWN_TOOL = 'spawn_subagent';
export const GROK_SUBAGENT_WAIT_TOOL = 'get_command_or_subagent_output';

interface GrokSpawnResult {
  agentId?: string;
}

interface GrokWaitStatus {
  completed?: string;
  error?: string;
  failed?: string;
}

interface GrokWaitResult {
  statuses: Record<string, GrokWaitStatus>;
  timedOut: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function extractGrokSpawnResult(raw: string | undefined): GrokSpawnResult {
  if (!raw) return {};

  const match = raw.match(/(?:subagent_id|subagentId)\s*[=:]\s*"?([a-zA-Z0-9_-]+)"?/i);
  return match?.[1] ? { agentId: match[1] } : {};
}

function getGrokWaitEntries(record: Record<string, unknown>): unknown[] {
  const taskOutput = isRecord(record.TaskOutput)
    ? record.TaskOutput
    : isRecord(record.taskOutput)
      ? record.taskOutput
      : record;
  const multiResult = isRecord(taskOutput.MultiResult)
    ? taskOutput.MultiResult
    : isRecord(taskOutput.multiResult)
      ? taskOutput.multiResult
      : isRecord(taskOutput.multi_result)
        ? taskOutput.multi_result
        : taskOutput;

  return Array.isArray(multiResult.results) ? multiResult.results : [];
}

function setWaitStatus(
  statuses: Record<string, GrokWaitStatus>,
  agentId: string,
  rawStatus: string,
  output: string,
): void {
  const status = rawStatus.trim().toLowerCase();
  const cleanedOutput = stripGrokSubagentMetadata(output);
  if (status === 'completed' || status === 'success' || status === 'succeeded') {
    statuses[agentId] = { completed: cleanedOutput || 'DONE' };
    return;
  }
  if (status === 'failed') {
    statuses[agentId] = { failed: cleanedOutput || 'Task failed' };
    return;
  }
  if (status === 'error' || status === 'cancelled' || status === 'canceled') {
    statuses[agentId] = { error: cleanedOutput || 'Task failed' };
  }
}

function stripGrokSubagentMetadata(value: string): string {
  return value
    .replace(/\s*<subagent_meta>[\s\S]*?<\/subagent_meta>/gi, '')
    .replace(/\s*<subagent_result>[\s\S]*?<\/subagent_result>/gi, '')
    .trim();
}

function parseJsonWaitResult(record: Record<string, unknown>): GrokWaitResult {
  const statuses: Record<string, GrokWaitStatus> = {};
  for (const entry of getGrokWaitEntries(record)) {
    if (!isRecord(entry)) continue;
    const agentId = firstString(entry.task_id, entry.taskId, entry.subagent_id, entry.subagentId);
    const status = firstString(entry.status);
    if (!agentId || !status) continue;
    setWaitStatus(
      statuses,
      agentId,
      status,
      firstString(entry.output, entry.result, entry.error, entry.message) ?? '',
    );
  }

  return {
    statuses,
    timedOut: record.timed_out === true || record.timedOut === true,
  };
}

function trimRenderedTaskOutput(value: string): string {
  const lines = value.trim().split('\n');
  while (lines.length > 0 && /^(?:Command|Duration|Exit Code):/.test(lines[0] ?? '')) {
    lines.shift();
  }

  return lines
    .join('\n')
    .replace(/\n+\d+\/\d+ tasks completed \([^\n]+\)\s*$/i, '')
    .trim();
}

function parseRenderedWaitResult(raw: string): GrokWaitResult {
  const statuses: Record<string, GrokWaitStatus> = {};
  const taskHeader = /^--- Task ([a-zA-Z0-9_-]+) \[([^\]]+)] ---$/gm;
  const matches = [...raw.matchAll(taskHeader)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const agentId = match[1];
    const status = match[2];
    if (!agentId || !status || match.index === undefined) continue;

    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? raw.length;
    const output = trimRenderedTaskOutput(raw.slice(bodyStart, bodyEnd));
    setWaitStatus(statuses, agentId, status, output);
  }

  return {
    statuses,
    timedOut: /\b(?:timed out|timeout)\b/i.test(raw) && Object.keys(statuses).length === 0,
  };
}

export function extractGrokWaitResult(raw: string | undefined): GrokWaitResult {
  if (!raw) return { statuses: {}, timedOut: false };

  const parsed = parseJsonRecord(raw);
  if (parsed) {
    const result = parseJsonWaitResult(parsed);
    if (Object.keys(result.statuses).length > 0 || result.timedOut) {
      return result;
    }
  }

  return parseRenderedWaitResult(raw);
}

function getGrokSubagentDescription(input: Record<string, unknown>): string {
  return firstString(input.description)
    ?? (firstString(input.subagent_type)
      ? `${firstString(input.subagent_type)} subagent`
      : 'Grok subagent');
}

function resolveGrokWaitCompletion(
  spawnResult: GrokSpawnResult,
  siblingToolCalls: ToolCallInfo[],
): { status: SubagentInfo['status']; result?: string } {
  for (const toolCall of siblingToolCalls) {
    if (toolCall.name !== GROK_SUBAGENT_WAIT_TOOL) continue;

    const waitResult = extractGrokWaitResult(toolCall.result);
    const statusEntries = Object.entries(waitResult.statuses);
    let agentStatus: GrokWaitStatus | undefined;
    if (spawnResult.agentId) {
      agentStatus = waitResult.statuses[spawnResult.agentId];
    } else if (statusEntries.length === 1) {
      agentStatus = statusEntries[0]?.[1];
    }

    if (agentStatus?.completed) {
      return { status: 'completed', result: agentStatus.completed };
    }
    const failure = agentStatus?.error ?? agentStatus?.failed;
    if (failure) {
      return { status: 'error', result: failure };
    }
    if (waitResult.timedOut) {
      return { status: 'error', result: 'Timed out' };
    }
  }

  return { status: 'running' };
}

export function buildGrokSubagentInfo(
  spawnToolCall: ToolCallInfo,
  siblingToolCalls: ToolCallInfo[] = [],
): SubagentInfo {
  if (
    spawnToolCall.subagent
    && (spawnToolCall.subagent.status === 'completed' || spawnToolCall.subagent.status === 'error')
  ) {
    return { ...spawnToolCall.subagent };
  }

  const spawnResult = extractGrokSpawnResult(spawnToolCall.result);
  const description = getGrokSubagentDescription(spawnToolCall.input);
  const prompt = firstString(spawnToolCall.input.prompt) ?? '';

  if (spawnToolCall.status === 'error' || spawnToolCall.status === 'blocked') {
    return {
      id: spawnToolCall.id,
      description,
      prompt,
      isExpanded: false,
      result: spawnToolCall.result,
      status: 'error',
      toolCalls: [],
      ...(spawnResult.agentId ? { agentId: spawnResult.agentId } : {}),
    };
  }

  const completion = resolveGrokWaitCompletion(spawnResult, siblingToolCalls);
  return {
    id: spawnToolCall.id,
    description,
    prompt,
    isExpanded: false,
    result: completion.result,
    status: completion.status,
    toolCalls: [],
    ...(spawnResult.agentId ? { agentId: spawnResult.agentId } : {}),
  };
}

export const grokSubagentLifecycleAdapter: ProviderSubagentLifecycleAdapter = {
  isHiddenTool(name): boolean {
    return name === GROK_SUBAGENT_WAIT_TOOL;
  },
  isSpawnTool(name): boolean {
    return name === GROK_SUBAGENT_SPAWN_TOOL;
  },
  isWaitTool(name): boolean {
    return name === GROK_SUBAGENT_WAIT_TOOL;
  },
  isCloseTool(): boolean {
    return false;
  },
  resolveSpawnToolIds(waitToolCall, agentIdToSpawnId): string[] {
    const spawnIds = new Set<string>();
    const waitResult = extractGrokWaitResult(waitToolCall.result);
    const rawTaskIds: unknown = waitToolCall.input.task_ids;
    const taskIds = Array.isArray(rawTaskIds)
      ? rawTaskIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    for (const value of [...Object.keys(waitResult.statuses), ...taskIds]) {
      if (typeof value !== 'string') continue;
      const spawnId = agentIdToSpawnId.get(value);
      if (spawnId) spawnIds.add(spawnId);
    }
    return [...spawnIds];
  },
  buildSubagentInfo(spawnToolCall, siblingToolCalls = []): SubagentInfo {
    return buildGrokSubagentInfo(spawnToolCall, siblingToolCalls);
  },
  extractSpawnResult(raw): GrokSpawnResult {
    return extractGrokSpawnResult(raw);
  },
  extractWaitResult(raw): GrokWaitResult {
    return extractGrokWaitResult(raw);
  },
};
