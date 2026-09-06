import { buildSDKMessage } from '@test/helpers/sdkMessages';

import { ClaudeContentPresenter } from '@/providers/claude/execution/ClaudeContentPresenter';

const msg = buildSDKMessage;

/**
 * What the presenter carries between turns, and what it therefore has to hold.
 *
 * `transformSDKMessage` builds the plan panel from the SDK's task tools only
 * when it is handed a ledger to build it in. The ledger's own tests pass
 * whether or not anything supplies one — which is what this file is for.
 */
describe('ClaudeContentPresenter', () => {
  function presenter(): ClaudeContentPresenter {
    return new ClaudeContentPresenter({ settings: () => ({}) });
  }

  function createAndAnswer(content: ClaudeContentPresenter): unknown[] {
    content.present(msg({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'call-1',
          name: 'TaskCreate',
          input: { subject: 'Run tests', description: 'Run them', activeForm: 'Running tests' },
        }],
      },
    }));
    return [...content.present(msg({
      type: 'user',
      tool_use_result: { task: { id: 't1', subject: 'Run tests', activeForm: 'Running tests' } },
      message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'created' }] },
    }))];
  }

  it('builds the plan panel from the task tools, because it holds the ledger', () => {
    const chunks = createAndAnswer(presenter());

    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool_use',
      name: 'TodoWrite',
      input: { todos: [expect.objectContaining({ content: 'Run tests' })] },
    }));
  });

  it('starts a new conversation with no plan', () => {
    // The ledger spans a conversation the way a task list does — the tool that
    // creates an entry and the one that completes it are usually different
    // turns — so it has to be dropped when the conversation is, and not before.
    const content = presenter();
    createAndAnswer(content);
    content.forgetConversation();

    const afterForget = [...content.present(msg({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'call-2',
          name: 'TaskUpdate',
          input: { taskId: 't1', status: 'completed' },
        }],
      },
    }))];

    expect(afterForget.some(chunk => (
      typeof chunk === 'object' && chunk !== null && 'name' in chunk && chunk.name === 'TodoWrite'
    ))).toBe(false);
  });
});
