import { parseTodoInput } from '@/core/tools/todo';
import {
  createClaudeTaskPlanState,
  recordTaskToolResult,
  recordTaskToolUse,
} from '@/providers/claude/stream/claudeTaskPlanState';

function createTask(
  state: ReturnType<typeof createClaudeTaskPlanState>,
  toolUseId: string,
  subject: string,
  taskId: string,
  activeForm?: string,
) {
  recordTaskToolUse(state, toolUseId, 'TaskCreate', {
    subject,
    description: subject,
    ...(activeForm ? { activeForm } : {}),
  });
  return recordTaskToolResult(state, toolUseId, { task: { id: taskId, subject } });
}

describe('claudeTaskPlanState', () => {
  it('holds a create back until its result assigns the task id', () => {
    const state = createClaudeTaskPlanState();

    // The create call itself carries no id, so nothing can be rendered yet.
    const onUse = recordTaskToolUse(state, 'call-1', 'TaskCreate', {
      subject: 'Run tests',
      description: 'Run the unit suite',
      activeForm: 'Running tests',
    });
    expect(onUse).toBeNull();

    const onResult = recordTaskToolResult(state, 'call-1', { task: { id: 't1', subject: 'Run tests' } });

    expect(onResult).toEqual([
      { content: 'Run tests', activeForm: 'Running tests', status: 'pending' },
    ]);
  });

  it('produces a plan the shared todo parser accepts', () => {
    const state = createClaudeTaskPlanState();
    const todos = createTask(state, 'call-1', 'Run tests', 't1', 'Running tests');

    // The panel is fed through parseTodoInput, so the replayed shape has to
    // survive that validator rather than merely look similar.
    expect(parseTodoInput({ todos })).toEqual(todos);
  });

  it('falls back to the subject when a create omits activeForm', () => {
    const state = createClaudeTaskPlanState();

    const todos = createTask(state, 'call-1', 'Ship the release', 't1');

    expect(todos).toEqual([
      { content: 'Ship the release', activeForm: 'Ship the release', status: 'pending' },
    ]);
  });

  it('applies a status change and keeps the original order', () => {
    const state = createClaudeTaskPlanState();
    createTask(state, 'call-1', 'First', 't1');
    createTask(state, 'call-2', 'Second', 't2');

    const todos = recordTaskToolUse(state, 'call-3', 'TaskUpdate', {
      taskId: 't2',
      status: 'in_progress',
    });

    expect(todos).toEqual([
      { content: 'First', activeForm: 'First', status: 'pending' },
      { content: 'Second', activeForm: 'Second', status: 'in_progress' },
    ]);
  });

  it('drops a task deleted through an update', () => {
    const state = createClaudeTaskPlanState();
    createTask(state, 'call-1', 'First', 't1');
    createTask(state, 'call-2', 'Second', 't2');

    const todos = recordTaskToolUse(state, 'call-3', 'TaskUpdate', {
      taskId: 't1',
      status: 'deleted',
    });

    expect(todos).toEqual([{ content: 'Second', activeForm: 'Second', status: 'pending' }]);
  });

  it('ignores an update for a task it never saw created', () => {
    const state = createClaudeTaskPlanState();

    expect(recordTaskToolUse(state, 'call-1', 'TaskUpdate', {
      taskId: 'unknown',
      status: 'completed',
    })).toBeNull();
  });

  it('lets a list result replace the ledger so removals disappear', () => {
    const state = createClaudeTaskPlanState();
    createTask(state, 'call-1', 'First', 't1', 'Doing first');
    createTask(state, 'call-2', 'Second', 't2');

    recordTaskToolUse(state, 'call-3', 'TaskList', {});
    const todos = recordTaskToolResult(state, 'call-3', {
      tasks: [{ id: 't1', subject: 'First', status: 'completed', blockedBy: [] }],
    });

    // t2 is gone from the authoritative snapshot, and t1 keeps the activeForm
    // the list output does not carry.
    expect(todos).toEqual([
      { content: 'First', activeForm: 'Doing first', status: 'completed' },
    ]);
  });

  it('stays stable when the same create is seen twice', () => {
    const state = createClaudeTaskPlanState();

    // A streamed block surfaces as a tool use before the assembled message
    // repeats it, so folding the same call twice must not duplicate the task.
    recordTaskToolUse(state, 'call-1', 'TaskCreate', { subject: 'Run tests', description: '' });
    recordTaskToolUse(state, 'call-1', 'TaskCreate', { subject: 'Run tests', description: '' });
    const todos = recordTaskToolResult(state, 'call-1', { task: { id: 't1', subject: 'Run tests' } });

    expect(todos).toHaveLength(1);
  });

  it('ignores tools that are not part of the task family', () => {
    const state = createClaudeTaskPlanState();

    expect(recordTaskToolUse(state, 'call-1', 'Read', { file_path: '/tmp/x' })).toBeNull();
    expect(recordTaskToolResult(state, 'call-1', { ok: true })).toBeNull();
  });
});
