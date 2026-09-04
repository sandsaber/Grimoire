import { mapMimocodeMessages } from '../../../../src/providers/mimocode/history/MimocodeHistoryStore';

describe('mapMimocodeMessages', () => {
  it('hydrates an error-only assistant row instead of restoring a blank message', () => {
    expect(mapMimocodeMessages([{
      info: {
        id: 'msg-assistant',
        role: 'assistant',
        error: {
          name: 'APIError',
          data: {
            message: 'Not supported model mimo-v2.5-pro-ultraspeed',
            statusCode: 400,
          },
        },
        time: { created: 2_000, completed: 2_500 },
      },
      parts: [],
    }])).toEqual([expect.objectContaining({
      content: '**Error:** MiMo request failed: Not supported model mimo-v2.5-pro-ultraspeed',
      contentBlocks: [{
        content: '**Error:** MiMo request failed: Not supported model mimo-v2.5-pro-ultraspeed',
        type: 'text',
      }],
    })]);
  });

  it('maps stored MiMoCode messages into Grimoire chat messages', () => {
    const messages = mapMimocodeMessages([
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

  it('shows only the latest user turn when MiMoCode stores a rebuilt prompt with history', () => {
    const messages = mapMimocodeMessages([
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
              'User: ping ping?',
              '',
              'Assistant: Ready!',
              '',
              '[Thinking: 1 block(s), 5.6s total]',
              '',
              'User: summarize briefly, check the links',
              '',
              'Assistant: ## Note Marine Life/Sharks (Selachii).md',
              '',
              '**Contents** — a structured overview of sharks.',
            ].join('\n'),
            type: 'text',
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        assistantMessageId: undefined,
        content: 'summarize briefly, check the links',
        id: 'msg-user',
        role: 'user',
        timestamp: 1_000,
        userMessageId: 'msg-user',
      },
    ]);
  });

  it('hydrates stored question tools with resolved answers', () => {
    const messages = mapMimocodeMessages([
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

  it('merges adjacent assistant fragments from one MiMoCode turn', () => {
    const messages = mapMimocodeMessages([
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
