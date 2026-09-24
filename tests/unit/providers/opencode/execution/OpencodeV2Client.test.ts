import type { OpenCodeEvent } from '@opencode/client';

import type { AcpSessionNotification } from '@/providers/acp/types';
import { OpencodeV2Client } from '@/providers/opencode/execution/OpencodeV2Client';

const mockMake = jest.fn();
const mockFetch = jest.fn();
jest.mock('@opencode/client', () => ({
  OpenCode: { make: (...args: unknown[]) => mockMake(...args) },
  isSessionNotFoundError: (error: { _tag?: string }) => error?._tag === 'SessionNotFoundError',
}));
jest.mock('@/core/mcp/McpTester', () => ({ createNodeFetch: () => mockFetch }));

function createHarness() {
  const queue: OpenCodeEvent[] = [];
  let wake: (() => void) | undefined;
  let disconnect: (error?: Error) => void = () => undefined;
  const terminate = jest.fn().mockResolvedValue('confirmed');
  const requestPermission = jest.fn().mockResolvedValue({ outcome: { outcome: 'selected', optionId: 'once' } });
  const model = { id: 'model', providerID: 'test', name: 'Test', enabled: true,
    limit: { context: 200_000 }, variants: [{ id: 'default' }, { id: 'high' }] };
  const session = { id: 'session', agent: 'build', model: { id: 'model', providerID: 'test' },
    location: { directory: '/vault' }, time: { updated: 1_000 } };
  const agents = [{ id: 'build', name: 'Build', mode: 'primary' },
    { id: 'grimoire-safe', name: 'Safe', mode: 'primary',
      permissions: [{ action: 'external_directory', resource: '*', effect: 'deny' }] }];
  const api = {
    agent: { list: jest.fn().mockResolvedValue({ data: agents }) },
    model: { list: jest.fn().mockResolvedValue({ data: [model] }), default: jest.fn().mockResolvedValue({ data: model }) },
    command: { list: jest.fn().mockResolvedValue({ data: [{ name: 'review' }] }) },
    session: {
      create: jest.fn().mockResolvedValue(session), get: jest.fn().mockResolvedValue(session),
      switchAgent: jest.fn().mockResolvedValue(undefined), switchModel: jest.fn().mockResolvedValue(undefined),
      prompt: jest.fn().mockResolvedValue({ id: 'user-message' }),
      interrupt: jest.fn().mockResolvedValue(undefined), compact: jest.fn().mockResolvedValue(undefined),
    },
    mcp: { add: jest.fn().mockResolvedValue(undefined) },
    form: { cancel: jest.fn().mockResolvedValue(undefined), reply: jest.fn().mockResolvedValue(undefined) },
    event: { subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      yield { type: 'server.connected', data: {} } as OpenCodeEvent;
      while (!signal.aborted) {
        if (!queue.length) await new Promise<void>(resolve => {
          const done = () => { signal.removeEventListener('abort', done); resolve(); };
          wake = done;
          signal.addEventListener('abort', done, { once: true });
        });
        while (queue.length) yield queue.shift()!;
      }
    } },
  };
  mockMake.mockReturnValue(api);
  mockFetch.mockResolvedValue({ ok: true, text: async () => '' });
  const client = new OpencodeV2Client({
    process: { input: {} as never, output: {} as never, terminate,
      onClose: listener => { disconnect = listener; return () => undefined; } },
    url: 'http://127.0.0.1:1234', password: 'test-only', cwd: '/vault', requiredAgents: ['grimoire-safe'],
    signal: new AbortController().signal, requestPermission,
  });
  const notifications: AcpSessionNotification[] = [];
  client.onSessionNotification(event => notifications.push(event));
  const push = (type: string, data: Record<string, unknown>) => {
    queue.push({ type, data: { sessionID: 'session', ...data } } as OpenCodeEvent);
    wake?.();
  };
  return { client, api, agents, push, notifications, terminate, requestPermission,
    disconnect: (error: Error) => disconnect(error),
    open: async () => { await client.initialize(); return client.newSession({ cwd: '/vault', mcpServers: [] }); },
  };
}

async function flush() { for (let index = 0; index < 30; index++) await Promise.resolve(); }

describe('OpenCode V2 transport', () => {
  afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

  it('waits for managed agents rather than caching the first incomplete catalog', async () => {
    jest.useFakeTimers();
    const h = createHarness();
    h.api.agent.list.mockResolvedValueOnce({ data: [] });
    const opened = h.open();
    await jest.advanceTimersByTimeAsync(101);
    const result = await opened;
    expect(h.api.agent.list).toHaveBeenCalledTimes(2);
    expect(result.configOptions[0]).toMatchObject({ options: expect.arrayContaining([{ value: 'grimoire-safe', name: 'Safe' }]) });
    await h.client.close();
  });

  it('streams each delta once and carries token usage into the terminal response', async () => {
    const h = createHarness();
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'hello' }] });
    h.push('session.text.delta', { assistantMessageID: 'message', ordinal: 0, delta: 'Hi' });
    h.push('session.text.ended', { assistantMessageID: 'message', ordinal: 0, text: 'Hi there' });
    h.push('session.step.ended', { tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } }, cost: 0.1 });
    h.push('session.execution.succeeded', {});
    expect(await pending).toMatchObject({ stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 2, cachedReadTokens: 5 } });
    expect(h.notifications.filter(event => event.update.sessionUpdate === 'agent_message_chunk')
      .map(event => (event.update as { content: { text: string } }).content.text)).toEqual(['Hi', ' there']);
    await h.client.close();
  });

  it('also waits for model discovery after the agents become ready', async () => {
    jest.useFakeTimers();
    const h = createHarness();
    h.api.model.list.mockResolvedValueOnce({ data: [] });
    const opened = h.open();
    await jest.advanceTimersByTimeAsync(101);
    await opened;
    expect(h.api.model.list).toHaveBeenCalledTimes(2);
    await h.client.close();
  });

  it.each(['once', 'reject'])('replies to a native permission with the selected %s decision', async decision => {
    const h = createHarness();
    h.requestPermission.mockResolvedValue({ outcome: { outcome: 'selected', optionId: decision } });
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'run' }] });
    h.push('session.tool.input.started', { id: 'tool', name: 'shell', assistantMessageID: 'message' });
    h.push('permission.asked', { id: 'approval', action: 'shell', resources: ['pwd'], source: { type: 'tool', id: 'tool', messageID: 'message' } });
    await flush();
    expect(h.requestPermission).toHaveBeenCalledWith(expect.objectContaining({ toolCall: expect.objectContaining({ title: 'bash', rawInput: { command: 'pwd' } }) }));
    expect(mockFetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: JSON.stringify({ decision }) }));
    h.push('session.execution.succeeded', {});
    await pending;
    await h.client.close();
  });

  it('never sends a late approval after its owned server is closed', async () => {
    const h = createHarness();
    let answer!: (value: unknown) => void;
    h.requestPermission.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'run' }] });
    h.push('permission.asked', { id: 'approval', action: 'edit', resources: ['Note.md'] });
    await flush();
    await h.client.close();
    answer({ outcome: { outcome: 'selected', optionId: 'once' } });
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await pending).toEqual({ stopReason: 'cancelled' });
  });

  it('classifies a missing native session without treating authentication failures as missing', async () => {
    const h = createHarness();
    await h.open();
    h.api.session.get.mockRejectedValueOnce({ _tag: 'SessionNotFoundError' });
    await expect(h.client.loadSession({ sessionId: 'missing', cwd: '/vault', mcpServers: [] }))
      .rejects.toMatchObject({ method: 'session/load', code: -32002 });
    const unauthorized = new Error('Authentication required');
    h.api.session.get.mockRejectedValueOnce(unauthorized);
    await expect(h.client.loadSession({ sessionId: 'session', cwd: '/vault', mcpServers: [] })).rejects.toBe(unauthorized);
    await h.client.close();
  });

  it('reports a known native execution failure without turning it into uncertain transport loss', async () => {
    const h = createHarness();
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'run' }] });
    h.push('session.execution.failed', { error: { type: 'provider.rate_limit', message: 'Rate limit exceeded' } });
    await expect(pending).rejects.toMatchObject({ method: 'session/prompt', code: -32603, message: 'Rate limit exceeded' });
    expect(h.terminate).not.toHaveBeenCalled();
    await h.client.close();
  });

  it('cancels an unsupported native form and waits for the stopped turn', async () => {
    const h = createHarness();
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'run' }] });
    h.push('form.created', { form: { id: 'form', sessionID: 'session', title: 'Question',
      fields: [{ key: 'auth', type: 'external', url: 'https://example.test/auth' }] } });
    await flush();
    expect(h.api.form.cancel).toHaveBeenCalledWith({ sessionID: 'session', formID: 'form' }, expect.anything());
    expect(h.api.session.interrupt).toHaveBeenCalled();
    h.push('session.execution.interrupted', { reason: 'user' });
    await expect(pending).rejects.toThrow('OpenCode CLI');
    await h.client.close();
  });

  it('maps a native choice label back to its value through the question channel', async () => {
    const h = createHarness();
    h.requestPermission.mockResolvedValue({ outcome: { outcome: 'selected', optionId: 'answered' },
      answers: { 'opencode-field-0': 'Blue' } });
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'ask' }] });
    const form = { id: 'form', sessionID: 'session', title: 'Color', fields: [
      { key: 'color', title: 'Choose a color', type: 'string', required: true,
        options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }] },
    ] };
    h.push('form.created', { form });
    h.push('form.created', { form });
    await flush();
    expect(h.requestPermission).toHaveBeenCalledTimes(1);
    expect(h.api.form.reply).toHaveBeenCalledWith({ sessionID: 'session', formID: 'form', answer: { color: 'blue' } }, expect.anything());
    h.push('session.execution.succeeded', {});
    await pending;
    await h.client.close();
  });

  it('shows the completed tool input before asking for write permission', async () => {
    const h = createHarness();
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'write' }] });
    h.push('session.tool.input.started', { id: 'write', name: 'write', assistantMessageID: 'message' });
    h.push('session.tool.input.ended', { id: 'write', assistantMessageID: 'message', text: JSON.stringify({ path: 'Note.md', content: 'New content' }) });
    h.push('permission.asked', { id: 'approval', action: 'edit', resources: ['Note.md'], source: { type: 'tool', id: 'write', messageID: 'message' } });
    await flush();
    expect(h.requestPermission).toHaveBeenCalledWith(expect.objectContaining({ toolCall: expect.objectContaining({
      title: 'edit', rawInput: { file_path: 'Note.md', content: 'New content' },
    }) }));
    h.push('session.execution.succeeded', {});
    await pending;
    await h.client.close();
  });

  it('rejects pending work on process loss and permits an unconfirmed close to retry', async () => {
    const h = createHarness();
    h.terminate.mockResolvedValueOnce('unconfirmed');
    await h.open();
    const pending = h.client.prompt({ sessionId: 'session', prompt: [{ type: 'text', text: 'run' }] });
    h.disconnect(new Error('server lost'));
    await expect(pending).rejects.toThrow('server lost');
    await h.client.close();
    expect(h.terminate).toHaveBeenCalledTimes(2);
  });
});
