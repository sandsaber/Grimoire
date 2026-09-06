import {
  AcpSessionUpdateNormalizer,
  renderAcpContentBlock,
} from '../../../../src/providers/acp';

describe('AcpSessionUpdateNormalizer', () => {
  it('answers something for an update it has never seen', () => {
    const normalizer = new AcpSessionUpdateNormalizer();

    // The vendor channel delivers updates ACP does not define — Grok's three
    // are the reason it exists. The switch had no default and no trailing
    // return, so an unknown one came back as `undefined` from a signature that
    // promises otherwise, and the presenter read `.type` off it.
    const normalized = normalizer.normalize({
      sessionUpdate: 'something_only_this_vendor_sends',
    } as never);

    expect(normalized).toEqual({ type: 'unsupported' });
  });

  it('reports a message chunk as text, with the id it belongs to', () => {
    // **No boundary chunk.** This asserted one per message id, fired by a claim
    // the normalizer kept. Nothing received it: the tab binding filters framing
    // off the content channel, and the defect the claim guarded — a provider
    // reusing an id across turns, so a second answer joins the first bubble —
    // is unreachable, because the projection derives a turn's assistant message
    // id from its run. What a presenter needs is the id, and it is on the
    // result rather than inside a chunk.
    const normalizer = new AcpSessionUpdateNormalizer();

    const first = normalizer.normalize({
      content: { text: 'Hello', type: 'text' },
      messageId: 'assistant-1',
      sessionUpdate: 'agent_message_chunk',
    });
    const second = normalizer.normalize({
      content: { text: ' world', type: 'text' },
      messageId: 'assistant-1',
      sessionUpdate: 'agent_message_chunk',
    });

    expect(first).toMatchObject({
      messageId: 'assistant-1',
      role: 'assistant',
      streamChunks: [{ content: 'Hello', type: 'text' }],
      type: 'message_chunk',
    });
    expect(second).toMatchObject({
      messageId: 'assistant-1',
      role: 'assistant',
      streamChunks: [{ content: ' world', type: 'text' }],
      type: 'message_chunk',
    });
  });

  it('converts tool call state into stream chunks', () => {
    const normalizer = new AcpSessionUpdateNormalizer();

    const start = normalizer.normalize({
      rawInput: { path: 'src/index.ts' },
      sessionUpdate: 'tool_call',
      title: 'Read file',
      toolCallId: 'tool-1',
    });
    const progress = normalizer.normalize({
      content: [{
        content: { text: 'line 1', type: 'text' },
        type: 'content',
      }],
      sessionUpdate: 'tool_call_update',
      status: 'in_progress',
      toolCallId: 'tool-1',
    });
    const done = normalizer.normalize({
      content: [{
        content: { text: 'line 1', type: 'text' },
        type: 'content',
      }],
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'tool-1',
    });

    expect(start).toMatchObject({
      streamChunks: [{
        id: 'tool-1',
        input: { path: 'src/index.ts' },
        name: 'Read file',
        type: 'tool_use',
      }],
      type: 'tool_call',
    });
    expect(progress).toMatchObject({
      streamChunks: [{
        content: 'line 1',
        id: 'tool-1',
        type: 'tool_output',
      }],
      type: 'tool_call_update',
    });
    expect(done).toMatchObject({
      streamChunks: [{
        content: 'line 1',
        id: 'tool-1',
        isError: false,
        type: 'tool_result',
      }],
      type: 'tool_call_update',
    });
  });

  it('maps ACP commands into slash commands', () => {
    const normalizer = new AcpSessionUpdateNormalizer();

    const commands = normalizer.normalize({
      availableCommands: [{
        description: 'Review the current changes',
        input: { hint: '[focus]' },
        name: '/review',
      }],
      sessionUpdate: 'available_commands_update',
    });

    expect(commands).toEqual({
      commands: [{
        argumentHint: '[focus]',
        content: '',
        description: 'Review the current changes',
        id: 'acp:review',
        name: 'review',
        source: 'sdk',
      }],
      type: 'commands',
    });
  });

  it('maps ACP plan updates into a stable user-visible progress chunk', () => {
    const normalizer = new AcpSessionUpdateNormalizer();

    const plan = normalizer.normalize({
      entries: [
        { content: 'Inspect the workspace', priority: 'high', status: 'completed' },
        { content: 'Implement the change', priority: 'high', status: 'in_progress' },
        { content: 'Run focused tests', priority: 'medium', status: 'pending' },
      ],
      sessionUpdate: 'plan',
    });

    expect(plan).toEqual({
      plan: expect.objectContaining({ sessionUpdate: 'plan' }),
      streamChunks: [{
        content: 'Implement the change',
        id: 'acp:plan',
        items: [
          { content: 'Inspect the workspace', status: 'completed' },
          { content: 'Implement the change', status: 'in_progress' },
          { content: 'Run focused tests', status: 'pending' },
        ],
        state: 'running',
        type: 'progress',
      }],
      type: 'plan',
    });
  });

  it('keeps raw ACP thoughts private instead of promoting them to progress', () => {
    const normalizer = new AcpSessionUpdateNormalizer();

    const thought = normalizer.normalize({
      content: { text: 'Internal chain of thought', type: 'text' },
      messageId: 'thought-1',
      sessionUpdate: 'agent_thought_chunk',
    });

    expect(thought).toMatchObject({
      role: 'thinking',
      streamChunks: [{ content: 'Internal chain of thought', type: 'thinking' }],
      type: 'message_chunk',
    });
    expect((thought as any).streamChunks).not.toContainEqual(expect.objectContaining({
      type: 'progress',
    }));
  });

  it('marks a fully completed ACP plan as completed progress', () => {
    const normalizer = new AcpSessionUpdateNormalizer();

    const plan = normalizer.normalize({
      entries: [
        { content: 'Implement the change', priority: 'high', status: 'completed' },
        { content: 'Run focused tests', priority: 'medium', status: 'completed' },
      ],
      sessionUpdate: 'plan',
    });

    expect(plan).toMatchObject({
      streamChunks: [{
        content: 'Plan completed',
        id: 'acp:plan',
        state: 'completed',
        type: 'progress',
      }],
      type: 'plan',
    });
  });

  it('parses session info timestamps and renders non-text content blocks', () => {
    const normalizer = new AcpSessionUpdateNormalizer();
    const updatedAt = '2026-04-19T00:00:00.000Z';

    const info = normalizer.normalize({
      sessionUpdate: 'session_info_update',
      title: 'Session title',
      updatedAt,
    });

    expect(info).toEqual({
      sessionInfo: {
        sessionUpdate: 'session_info_update',
        title: 'Session title',
        updatedAt,
        updatedAtMs: Date.parse(updatedAt),
      },
      type: 'session_info',
    });

    expect(renderAcpContentBlock({
      name: 'README.md',
      type: 'resource_link',
      uri: 'file:///tmp/project/README.md',
    })).toBe('README.md');
  });
});
