import type { DiffLine, DiffStats } from './diff';

/** Diff data for Write/Edit tool operations (pre-computed from SDK structuredPatch). */
export interface ToolDiffData {
  filePath: string;
  diffLines: DiffLine[];
  stats: DiffStats;
}

/** Parsed option for AskUserQuestion tool. */
export interface AskUserQuestionOption {
  label: string;
  description: string;
  value?: string;
}

/** Parsed question for AskUserQuestion tool. */
export interface AskUserQuestionItem {
  question: string;
  id?: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

/** User-provided answers keyed by question text or stable question id. */
export type AskUserAnswers = Record<string, string | string[]>;

/** Tool call tracking with status and result. */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /**
   * `blocked` is a decision — somebody said no. `unfinished` is the absence of
   * one: the turn ended before the tool reported, so nothing was decided and
   * nothing failed. They looked identical, in the error colour and behind a
   * crossed shield, which told the reader they had refused something they never
   * saw.
   */
  status: 'running' | 'completed' | 'error' | 'blocked' | 'unfinished';
  result?: string;
  isExpanded?: boolean;
  diffData?: ToolDiffData;
  resolvedAnswers?: AskUserAnswers;
  subagent?: SubagentInfo;
}

export type ExitPlanModeDecision =
  | { type: 'approve' }
  | { type: 'feedback'; text: string };

export type ExitPlanModeCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ExitPlanModeDecision | null>;

/** Subagent execution mode: sync (nested tools) or async (background). */
export type SubagentMode = 'sync' | 'async';

/** Async subagent lifecycle states. */
export type AsyncSubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'orphaned';

/** Subagent (Agent tool, legacy Task) tracking for sync and async modes. */
export interface SubagentInfo {
  id: string;
  description: string;
  prompt?: string;
  mode?: SubagentMode;
  isExpanded: boolean;
  result?: string;
  status: 'running' | 'completed' | 'error';
  toolCalls: ToolCallInfo[];
  asyncStatus?: AsyncSubagentStatus;
  agentId?: string;
  outputToolId?: string;
  startedAt?: number;
  completedAt?: number;
}
