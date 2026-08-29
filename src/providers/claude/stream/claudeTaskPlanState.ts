/**
 * Claude task-plan ledger.
 *
 * Claude Code 2.1.233 retired the single-call TodoWrite tool in favour of an
 * incremental TaskCreate / TaskGet / TaskUpdate / TaskList family. A create
 * carries no task id until its result comes back, and an update names only the
 * fields it changes, so no single call ever describes the whole plan.
 *
 * The chat plan panel is fed by whole-list TodoWrite input, which is also what
 * the Codex adapter synthesizes from `update_plan`. This ledger accumulates the
 * task calls so the same provider-neutral shape can be replayed for Claude.
 */

import type { TodoItem } from '../../../core/tools/todo';
import {
  TOOL_TASK_CREATE,
  TOOL_TASK_GET,
  TOOL_TASK_LIST,
  TOOL_TASK_UPDATE,
} from '../../../core/tools/toolNames';

/** Synthetic tool-call id for the replayed plan, stable so the panel updates in place. */
export const CLAUDE_TASK_PLAN_TOOL_ID = 'claude-task-plan';

const TASK_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  TOOL_TASK_CREATE,
  TOOL_TASK_GET,
  TOOL_TASK_LIST,
  TOOL_TASK_UPDATE,
]);

const TODO_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

export interface ClaudeTaskPlanState {
  /** Tool name per tool-use id: a result only carries the id it answers. */
  toolNamesById: Map<string, string>;
  /** Create inputs held until the result assigns the task its id. */
  pendingCreates: Map<string, { content: string; activeForm: string }>;
  /** Insertion-ordered task ledger. */
  tasks: Map<string, TodoItem>;
  /** Whether a plan has ever been published, which is what makes empty sayable. */
  published: boolean;
}

export function createClaudeTaskPlanState(): ClaudeTaskPlanState {
  return {
    toolNamesById: new Map(),
    pendingCreates: new Map(),
    tasks: new Map(),
    published: false,
  };
}

export function isTaskPlanTool(name: string): boolean {
  return TASK_TOOL_NAMES.has(name);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readStatus(value: unknown): TodoItem['status'] | 'deleted' | null {
  if (typeof value !== 'string') return null;
  if (value === 'deleted') return 'deleted';
  return TODO_STATUSES.has(value) ? (value as TodoItem['status']) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Full plan, or null when there is nothing the panel could render. */
/**
 * The plan as it stands, or `null` when there has never been one.
 *
 * **An empty plan is not the absence of a plan.** Deleting the last task, or a
 * `TaskList` that comes back empty, leaves a ledger with nothing in it — and
 * collapsing that to `null` meant the caller published nothing and the task the
 * user just deleted stayed on screen.
 */
function snapshot(state: ClaudeTaskPlanState): TodoItem[] | null {
  const todos = [...state.tasks.values()].filter(
    (task) => task.content.length > 0 && task.activeForm.length > 0,
  );
  if (todos.length > 0) {
    state.published = true;
    return todos.map((task) => ({ ...task }));
  }
  return state.published ? [] : null;
}

function upsertTask(
  state: ClaudeTaskPlanState,
  taskId: string,
  content: string,
  activeForm: string,
  status: TodoItem['status'],
): void {
  const existing = state.tasks.get(taskId);
  state.tasks.set(taskId, {
    content: content || existing?.content || '',
    activeForm: activeForm || existing?.activeForm || content || existing?.content || '',
    status,
  });
}

/**
 * Folds a task tool call into the ledger.
 *
 * Safe to call twice for the same id: the streamed and the assembled form of a
 * block both surface as a tool use, and a create only reaches the ledger once
 * its result arrives.
 */
export function recordTaskToolUse(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
): TodoItem[] | null {
  if (!isTaskPlanTool(name) || toolUseId.length === 0) return null;
  state.toolNamesById.set(toolUseId, name);

  if (name === TOOL_TASK_CREATE) {
    const content = readString(input, 'subject');
    if (content.length === 0) return null;
    state.pendingCreates.set(toolUseId, {
      content,
      activeForm: readString(input, 'activeForm') || content,
    });
    return null;
  }

  if (name === TOOL_TASK_UPDATE) {
    const taskId = readString(input, 'taskId');
    const existing = state.tasks.get(taskId);
    if (taskId.length === 0 || !existing) return null;

    const status = readStatus(input.status);
    if (status === 'deleted') {
      state.tasks.delete(taskId);
      return snapshot(state);
    }

    upsertTask(
      state,
      taskId,
      readString(input, 'subject') || existing.content,
      readString(input, 'activeForm') || existing.activeForm,
      status ?? existing.status,
    );
    return snapshot(state);
  }

  return null;
}

/** Folds a task tool result into the ledger, resolving ids a create could not know. */
export function recordTaskToolResult(
  state: ClaudeTaskPlanState,
  toolUseId: string,
  result: unknown,
): TodoItem[] | null {
  const name = state.toolNamesById.get(toolUseId);
  if (!name) return null;

  const payload = asRecord(result);
  state.toolNamesById.delete(toolUseId);
  const pending = state.pendingCreates.get(toolUseId);
  state.pendingCreates.delete(toolUseId);

  if (!payload) return null;

  if (name === TOOL_TASK_CREATE) {
    const task = asRecord(payload.task);
    const taskId = task ? readString(task, 'id') : '';
    if (taskId.length === 0) return null;
    const subject = task ? readString(task, 'subject') : '';
    const content = pending?.content || subject;
    upsertTask(state, taskId, content, pending?.activeForm || content, 'pending');
    return snapshot(state);
  }

  if (name === TOOL_TASK_GET) {
    const task = asRecord(payload.task);
    const taskId = task ? readString(task, 'id') : '';
    const status = task ? readStatus(task.status) : null;
    if (taskId.length === 0 || status === null || status === 'deleted') return null;
    const subject = readString(task as Record<string, unknown>, 'subject');
    upsertTask(state, taskId, subject, subject, status);
    return snapshot(state);
  }

  if (name === TOOL_TASK_LIST) {
    if (!Array.isArray(payload.tasks)) return null;
    // A list is the authoritative snapshot, so it replaces the ledger rather
    // than merging - a task deleted elsewhere has to disappear from the panel.
    const rebuilt = new Map<string, TodoItem>();
    for (const entry of payload.tasks) {
      const task = asRecord(entry);
      if (!task) continue;
      const taskId = readString(task, 'id');
      const status = readStatus(task.status);
      if (taskId.length === 0 || status === null || status === 'deleted') continue;
      const subject = readString(task, 'subject');
      const previous = state.tasks.get(taskId);
      rebuilt.set(taskId, {
        content: subject || previous?.content || '',
        activeForm: previous?.activeForm || subject || '',
        status,
      });
    }
    state.tasks = rebuilt;
    return snapshot(state);
  }

  return null;
}
