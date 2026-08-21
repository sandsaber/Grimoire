import {
  isImportedGrokSystemReminder,
  isImportedGrokUserInfoMessage,
  normalizeImportedGrokUserMessage,
  parseGrokChatHistoryJsonl,
} from '../../../../src/providers/grok/history/GrokHistoryStore';

describe('parseGrokChatHistoryJsonl', () => {
  it('maps Grok Build JSONL history with PascalCase tools into Grimoire chat messages', () => {
    const messages = parseGrokChatHistoryJsonl([
      '{"type":"system","content":"ignored"}',
      '{"type":"user","content":[{"type":"text","text":"Summarize this"}]}',
      '{"type":"reasoning","summary":[{"type":"summary_text","text":"Thinking..."}]}',
      '{"type":"assistant","content":"Checking files.","tool_calls":[{"id":"tool-1","name":"Read","arguments":"{\\"file_path\\":\\"notes/today.md\\"}"}]}',
      '{"type":"tool_result","tool_call_id":"tool-1","content":"read ok"}',
      '{"type":"assistant","content":"Done."}',
    ].join('\n'));

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'Summarize this',
        id: 'grok-user-1',
        role: 'user',
        timestamp: 1_000,
        userMessageId: 'grok-user-1',
      },
      {
        assistantMessageId: 'grok-assistant-2',
        content: 'Checking files.Done.',
        contentBlocks: [
          { content: 'Thinking...', type: 'thinking' },
          { content: 'Checking files.', type: 'text' },
          { toolId: 'tool-1', type: 'tool_use' },
          { content: 'Done.', type: 'text' },
        ],
        id: 'grok-assistant-2',
        role: 'assistant',
        timestamp: 2_000,
        toolCalls: [{
          id: 'tool-1',
          input: { file_path: 'notes/today.md' },
          name: 'Read',
          result: 'read ok',
          status: 'completed',
        }],
      },
    ]);
  });

  it('hides Grok synthetic system reminders from failed session history', () => {
    const messages = parseGrokChatHistoryJsonl([
      '{"type":"system","content":"Grok system prompt"}',
      JSON.stringify({
        content: [{
          text: '<system-reminder>Available skills...</system-reminder>',
          type: 'text',
        }],
        synthetic_reason: 'system_reminder',
        type: 'user',
      }),
    ].join('\n'));

    expect(messages).toEqual([]);
  });

  it('recognizes a previously imported Grok skills reminder without hiding normal messages', () => {
    expect(isImportedGrokSystemReminder({
      content: [
        '<system-reminder>',
        'The following skills are available for use:',
        '',
        '- help: Grok documentation',
        '</system-reminder>',
      ].join('\n'),
      id: 'grok-user-1',
      role: 'user',
      timestamp: 1_000,
    })).toBe(true);

    expect(isImportedGrokSystemReminder({
      content: 'The following skills are available for use in this vault.',
      id: 'user-message',
      role: 'user',
      timestamp: 1_000,
    })).toBe(false);
  });

  it('hides Grok Build workspace rules dumps that follow user_info', () => {
    const messages = parseGrokChatHistoryJsonl([
      JSON.stringify({
        content: [
          {
            text: [
              '<user_info>',
              'OS Version: macos',
              'Workspace Path: /vault',
              '</user_info>',
              '<rules>',
              'The rules section has a number of possible rules/memories/context that you should consider.',
              '<always_applied_workspace_rules description="workspace-level rules">',
              '<always_applied_workspace_rule name="/vault/Agents.md"># AGENTS.md</always_applied_workspace_rule>',
              '</always_applied_workspace_rules>',
              '</rules>',
            ].join('\n'),
            type: 'text',
          },
        ],
        type: 'user',
      }),
      JSON.stringify({
        content: [{ text: '<user_query>\nSummarize sharks', type: 'text' }],
        type: 'user',
      }),
      JSON.stringify({
        content: 'Sharks are cartilaginous fish.',
        type: 'assistant',
      }),
    ].join('\n'));

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'Summarize sharks',
        id: 'grok-user-2',
        role: 'user',
        timestamp: 2_000,
        userMessageId: 'grok-user-2',
      },
      {
        assistantMessageId: 'grok-assistant-3',
        content: 'Sharks are cartilaginous fish.',
        contentBlocks: [
          { content: 'Sharks are cartilaginous fish.', type: 'text' },
        ],
        id: 'grok-assistant-3',
        role: 'assistant',
        timestamp: 3_000,
      },
    ]);
  });

  it('hides Grok Build user_info harness and unwraps user_query tags', () => {
    const messages = parseGrokChatHistoryJsonl([
      JSON.stringify({
        content: [
          {
            text: [
              '<user_info>',
              'OS Version: macos',
              'Shell: /bin/zsh',
              'Workspace Path: /vault',
              "</user_info>",
            ].join('\n'),
            type: 'text',
          },
        ],
        type: 'user',
      }),
      JSON.stringify({
        content: [{ text: '<user_query>\nнтык тык', type: 'text' }],
        type: 'user',
      }),
      JSON.stringify({
        content: 'Тык-тык — на связи.',
        type: 'assistant',
      }),
    ].join('\n'));

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'нтык тык',
        id: 'grok-user-2',
        role: 'user',
        timestamp: 2_000,
        userMessageId: 'grok-user-2',
      },
      {
        assistantMessageId: 'grok-assistant-3',
        content: 'Тык-тык — на связи.',
        contentBlocks: [
          { content: 'Тык-тык — на связи.', type: 'text' },
        ],
        id: 'grok-assistant-3',
        role: 'assistant',
        timestamp: 3_000,
      },
    ]);
  });

  it('normalizes already-persisted harness user bubbles for hydrate', () => {
    expect(isImportedGrokUserInfoMessage({
      content: '<user_info>\nOS Version: macos\n</user_info>',
      id: 'u1',
      role: 'user',
      timestamp: 1,
    })).toBe(true);

    expect(normalizeImportedGrokUserMessage({
      content: '<user_info>\nOS Version: macos\n</user_info>',
      id: 'u1',
      role: 'user',
      timestamp: 1,
    })).toBeNull();

    expect(normalizeImportedGrokUserMessage({
      content: '<user_query>\nнтык тык',
      id: 'u2',
      role: 'user',
      timestamp: 1,
    })).toEqual({
      content: 'нтык тык',
      displayContent: 'нтык тык',
      id: 'u2',
      role: 'user',
      timestamp: 1,
    });

    expect(normalizeImportedGrokUserMessage({
      content: '',
      displayContent: 'Question that never reached Grok',
      id: 'u3',
      role: 'user',
      timestamp: 1,
    })).toEqual({
      content: 'Question that never reached Grok',
      displayContent: 'Question that never reached Grok',
      id: 'u3',
      role: 'user',
      timestamp: 1,
    });

    expect(normalizeImportedGrokUserMessage({
      content: '',
      displayContent: [
        '<rules>',
        '<always_applied_workspace_rules>',
        '<always_applied_workspace_rule name="/vault/Agents.md"># AGENTS.md</always_applied_workspace_rule>',
        '</always_applied_workspace_rules>',
        '</rules>',
      ].join('\n'),
      id: 'u4',
      role: 'user',
      timestamp: 1,
    })).toBeNull();
  });
});
