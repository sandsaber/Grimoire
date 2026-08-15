import {
  isImportedGrokSystemReminder,
  isImportedGrokUserInfoMessage,
  mapGrokMessages,
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

describe('mapGrokMessages', () => {
  it('maps stored Grok Build messages into Grimoire chat messages', () => {
    const messages = mapGrokMessages([
      {
        info: {
          id: 'msg-user',
          role: 'user',
          time: { created: 1_000 },
        },
        parts: [
          {
            id: 'part-user',
            text: 'Summarize this\n\n<current_note>\nnotes/today.md\n</current_note>',
            type: 'text',
          },
        ],
      },
      {
        info: {
          id: 'msg-assistant',
          role: 'assistant',
          time: { created: 2_000, completed: 4_000 },
        },
        parts: [
          {
            id: 'part-thinking',
            text: 'Thinking...',
            time: { start: 2_000, end: 3_000 },
            type: 'reasoning',
          },
          {
            callID: 'tool-1',
            id: 'part-tool',
            state: {
              input: { filePath: 'notes/today.md' },
              output: 'read ok',
              status: 'completed',
            },
            tool: 'read',
            type: 'tool',
          },
          {
            id: 'part-text',
            text: 'Done.',
            type: 'text',
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'Summarize this',
        id: 'msg-user',
        role: 'user',
        timestamp: 1_000,
        userMessageId: 'msg-user',
      },
      {
        assistantMessageId: 'msg-assistant',
        content: 'Done.',
        contentBlocks: [
          { content: 'Thinking...', durationSeconds: 1, type: 'thinking' },
          { toolId: 'tool-1', type: 'tool_use' },
          { content: 'Done.', type: 'text' },
        ],
        durationSeconds: 2,
        id: 'msg-assistant',
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

  it('shows only the latest user turn when Grok Build stores a rebuilt prompt with history', () => {
    const messages = mapGrokMessages([
      {
        info: {
          id: 'msg-user',
          role: 'user',
          time: { created: 1_000 },
        },
        parts: [
          {
            id: 'part-user',
            text: [
              'User: раз раз?',
              '',
              'Assistant: Готов!',
              '',
              '[Thinking: 1 block(s), 5.6s total]',
              '',
              'User: расскажи коротко, посмотри линки',
              '',
              'Assistant: ## Заметка Marine Life/Акулы (Sharks).md',
              '',
              '**Содержимое** — структурированный обзор акул.',
            ].join('\n'),
            type: 'text',
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'расскажи коротко, посмотри линки',
        id: 'msg-user',
        role: 'user',
        timestamp: 1_000,
        userMessageId: 'msg-user',
      },
    ]);
  });

  it('hydrates stored question tools with resolved answers', () => {
    const messages = mapGrokMessages([
      {
        info: {
          id: 'msg-assistant',
          role: 'assistant',
          time: { created: 2_000, completed: 4_000 },
        },
        parts: [
          {
            callID: 'tool-question',
            id: 'part-tool',
            state: {
              input: {
                questions: [{
                  header: 'Deploy',
                  id: 'deploy',
                  options: [
                    { description: 'Ship the change', label: 'Yes' },
                    { description: 'Hold the deploy', label: 'No' },
                  ],
                  question: 'Deploy now?',
                }],
              },
              metadata: {
                answers: [['Yes']],
              },
              output: 'User has answered your questions.',
              status: 'completed',
            },
            tool: 'question',
            type: 'tool',
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        assistantMessageId: 'msg-assistant',
        content: '',
        contentBlocks: [
          { toolId: 'tool-question', type: 'tool_use' },
        ],
        durationSeconds: 2,
        id: 'msg-assistant',
        role: 'assistant',
        timestamp: 2_000,
        toolCalls: [{
          id: 'tool-question',
          input: {
            questions: [{
              header: 'Deploy',
              id: 'deploy',
              multiSelect: false,
              options: [
                { description: 'Ship the change', label: 'Yes' },
                { description: 'Hold the deploy', label: 'No' },
              ],
              question: 'Deploy now?',
            }],
          },
          name: 'AskUserQuestion',
          resolvedAnswers: {
            deploy: 'Yes',
            'Deploy now?': 'Yes',
          },
          result: 'User has answered your questions.',
          status: 'completed',
        }],
      },
    ]);
  });

  it('merges adjacent assistant fragments from one Grok Build turn', () => {
    const messages = mapGrokMessages([
      {
        info: {
          id: 'msg-user',
          role: 'user',
          time: { created: 1_000 },
        },
        parts: [
          {
            id: 'part-user',
            text: 'Search it',
            type: 'text',
          },
        ],
      },
      {
        info: {
          id: 'msg-assistant-1',
          role: 'assistant',
          time: { created: 2_000, completed: 4_000 },
        },
        parts: [
          {
            id: 'part-thinking-1',
            text: 'Searching...',
            time: { start: 2_000, end: 3_000 },
            type: 'reasoning',
          },
          {
            callID: 'tool-websearch',
            id: 'part-tool',
            state: {
              input: {
                action: {
                  query: 'Apple stock price today',
                },
              },
              output: 'Search complete',
              status: 'completed',
            },
            tool: 'websearch',
            type: 'tool',
          },
        ],
      },
      {
        info: {
          id: 'msg-assistant-2',
          role: 'assistant',
          time: { created: 4_500, completed: 7_000 },
        },
        parts: [
          {
            id: 'part-thinking-2',
            text: 'Summarizing...',
            time: { start: 4_500, end: 5_000 },
            type: 'reasoning',
          },
          {
            id: 'part-text',
            text: 'Apple is trading at $272.41.',
            type: 'text',
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'Search it',
        id: 'msg-user',
        role: 'user',
        timestamp: 1_000,
        userMessageId: 'msg-user',
      },
      {
        assistantMessageId: 'msg-assistant-2',
        content: 'Apple is trading at $272.41.',
        contentBlocks: [
          { content: 'Searching...', durationSeconds: 1, type: 'thinking' },
          { toolId: 'tool-websearch', type: 'tool_use' },
          { content: 'Summarizing...', durationSeconds: 0.5, type: 'thinking' },
          { content: 'Apple is trading at $272.41.', type: 'text' },
        ],
        durationSeconds: 5,
        id: 'msg-assistant-1',
        role: 'assistant',
        timestamp: 2_000,
        toolCalls: [{
          id: 'tool-websearch',
          input: {
            actionType: 'search',
            query: 'Apple stock price today',
          },
          name: 'WebSearch',
          result: 'Search complete',
          status: 'completed',
        }],
      },
    ]);
  });
});
