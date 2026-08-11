import { PassThrough } from 'node:stream';

import trace from '@test/fixtures/provider-traces/opencode-execution.json';

import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';
import {
  AcpManagedClientAdapterFactory,
  type AcpManagedOwnedProcess,
} from '@/providers/acp/execution/AcpManagedClientAdapter';
import { ManagedAcpAuxiliaryQuery } from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpPromptResponse,
  AcpSessionNotification,
} from '@/providers/acp/types';

describe('managed ACP execution adapters', () => {
  it('composes the owned process, JSON-RPC transport, and ACP initialize handshake', async () => {
    const process = new WireProcess();
    const factory = new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire-tests', version: '1.0.0' },
      processLauncher: { launch: async () => process },
    });
    const client = await factory.create({
      startupRef: 'opaque-startup',
      signal: new AbortController().signal,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    });

    const initialization = client.initialize();
    const request = await process.nextRequest();
    expect(request).toEqual(expect.objectContaining({ method: 'initialize', id: 1 }));
    process.respond(1, {
      protocolVersion: 1,
      agentInfo: { name: 'opencode', version: 'test' },
    });
    await expect(initialization).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBe('confirmed');
    expect(process.terminateCalls).toBe(1);
  });

  it('terminates a process returned after startup was aborted', async () => {
    const process = new WireProcess();
    const abort = new AbortController();
    abort.abort(new Error('startup cancelled'));
    const factory = new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire-tests', version: '1.0.0' },
      processLauncher: { launch: async () => process },
    });

    await expect(factory.create({
      startupRef: 'opaque-startup',
      signal: abort.signal,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    })).rejects.toThrow('startup cancelled');
    expect(process.terminateCalls).toBe(1);
  });

  it('routes provider-owned contained filesystem delegates through ACP', async () => {
    const process = new WireProcess();
    const readTextFile = jest.fn(async () => ({ content: 'contained content' }));
    const factory = new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire-tests', version: '1.0.0' },
      delegate: { fileSystem: { readTextFile } },
      processLauncher: { launch: async () => process },
    });
    const client = await factory.create({
      startupRef: 'opaque-startup',
      signal: new AbortController().signal,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    });
    process.request(99, 'fs/read_text_file', {
      sessionId: 'session-1',
      path: 'notes/result.md',
    });

    await expect(process.nextRequest()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 99,
      result: { content: 'contained content' },
    });
    expect(readTextFile).toHaveBeenCalledWith({
      sessionId: 'session-1',
      path: 'notes/result.md',
    });
    await client.close();
  });

  it('routes provider extension requests, notifications, and direct questions without core coupling', async () => {
    const process = new WireProcess();
    const questions: unknown[] = [];
    const factory = new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire-tests', version: '1.0.0' },
      processLauncher: { launch: async () => process },
    });
    const client = await factory.create({
      startupRef: 'opaque-startup',
      signal: new AbortController().signal,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      askUserQuestion: async request => {
        questions.push(request);
        return { outcome: 'skip_interview' };
      },
    });
    const notifications: Array<{ method: string; params: unknown }> = [];
    const unsubscribe = client.onExtensionNotification?.(
      ['x.ai/session/update'],
      (method, params) => notifications.push({ method, params }),
    );
    process.notification('x.ai/session/update', { sessionId: 'session-1', update: {} });
    process.request(98, '_x.ai/ask_user_question', {
      sessionId: 'session-1',
      questions: [],
    });

    await expect(process.nextRequest()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 98,
      result: { outcome: 'skip_interview' },
    });
    expect(questions).toEqual([{ sessionId: 'session-1', questions: [] }]);
    expect(notifications).toEqual([{
      method: 'x.ai/session/update',
      params: { sessionId: 'session-1', update: {} },
    }]);

    const billing = client.requestExtension?.('x.ai/billing', {});
    const billingRequest = await process.nextRequest() as { id: number };
    expect(billingRequest).toEqual(expect.objectContaining({ method: 'x.ai/billing' }));
    process.respond(billingRequest.id, { plan: 'developer' });
    await expect(billing).resolves.toEqual({ plan: 'developer' });
    unsubscribe?.();
    process.notification('x.ai/session/update', { sessionId: 'session-2', update: {} });
    expect(notifications).toHaveLength(1);
    await client.close();
  });

  it('forwards native ACP model and mode selection without provider policy', async () => {
    const process = new WireProcess();
    const factory = new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire-tests', version: '1.0.0' },
      processLauncher: { launch: async () => process },
    });
    const client = await factory.create({
      startupRef: 'opaque-startup',
      signal: new AbortController().signal,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    });

    const model = client.setModel?.({ sessionId: 'session-1', modelId: 'model-1' });
    const modelRequest = await process.nextRequest() as { id: number };
    expect(modelRequest).toEqual(expect.objectContaining({
      method: 'session/set_model',
      params: { sessionId: 'session-1', modelId: 'model-1' },
    }));
    process.respond(modelRequest.id, {});
    await expect(model).resolves.toEqual({});

    const mode = client.setMode?.({ sessionId: 'session-1', modeId: 'plan' });
    const modeRequest = await process.nextRequest() as { id: number };
    expect(modeRequest).toEqual(expect.objectContaining({
      method: 'session/set_mode',
      params: { sessionId: 'session-1', modeId: 'plan' },
    }));
    process.respond(modeRequest.id, {});
    await expect(mode).resolves.toEqual({});
    await client.close();
  });

  it('runs an auxiliary operation in a cold session and closes its owned client', async () => {
    const client = new AuxiliaryClient();
    const scheduler = new TestScheduler();
    let clientCreates = 0;
    const query = new ManagedAcpAuxiliaryQuery(
      {
        resolve: async () => ({
          startupRef: 'aux-startup',
          cwd: '/vault',
          prompt: [{ type: 'text', text: 'Summarize' }],
          mcpServers: [],
        }),
      },
      { create: async () => { clientCreates += 1; return client; } },
      scheduler,
      1024,
      60_000,
    );
    const execution = query.execute('aux-ref', new AbortController().signal);
    await waitFor(() => client.promptCalls === 1);
    client.emit(agentText('aux-session', 'isolated result'));
    client.complete({ stopReason: 'end_turn' });

    await expect(execution).resolves.toBe('isolated result');
    expect(client.newCalls).toBe(1);
    expect(client.closeCalls).toBe(1);
    expect([
      ...(clientCreates > 0 ? ['client/launch:cold'] : []),
      ...(client.newCalls > 0 ? ['session/new:aux-session'] : []),
      ...(client.promptCalls > 0 ? ['session/prompt'] : []),
      ...(client.closeCalls > 0 ? ['client/close'] : []),
    ]).toEqual(trace.cases.isolatedAuxiliary);
  });

  it('cancels and rejects an oversized isolated result without leaking the client', async () => {
    const client = new AuxiliaryClient();
    const query = new ManagedAcpAuxiliaryQuery(
      {
        resolve: async () => ({
          startupRef: 'aux-startup',
          cwd: '/vault',
          prompt: [{ type: 'text', text: 'Summarize' }],
          mcpServers: [],
        }),
      },
      { create: async () => client },
      new TestScheduler(),
      3,
      60_000,
    );
    const execution = query.execute('aux-ref', new AbortController().signal);
    await waitFor(() => client.promptCalls === 1);
    client.emit(agentText('aux-session', 'too large'));
    client.complete({ stopReason: 'end_turn' });

    await expect(execution).rejects.toThrow('byte limit');
    expect(client.cancelCalls).toEqual(['aux-session']);
    expect(client.closeCalls).toBe(1);
  });

  it('does not report auxiliary success when owned-process cleanup is unconfirmed', async () => {
    const client = new AuxiliaryClient();
    client.closeOutcome = 'unconfirmed';
    const query = new ManagedAcpAuxiliaryQuery(
      {
        resolve: async () => ({
          startupRef: 'aux-startup',
          cwd: '/vault',
          prompt: [{ type: 'text', text: 'Summarize' }],
          mcpServers: [],
        }),
      },
      { create: async () => client },
      new TestScheduler(),
      1024,
      60_000,
    );
    const execution = query.execute('aux-ref', new AbortController().signal);
    await waitFor(() => client.promptCalls === 1);
    client.emit(agentText('aux-session', 'result'));
    client.complete({ stopReason: 'end_turn' });

    await expect(execution).rejects.toThrow('termination was not confirmed');
    expect(client.closeCalls).toBe(1);
  });
});

class WireProcess implements AcpManagedOwnedProcess {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  terminateCalls = 0;
  private readonly requests: unknown[] = [];
  private readonly waiters: Array<(request: unknown) => void> = [];

  constructor() {
    let buffer = '';
    this.output.on('data', chunk => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const parsed = JSON.parse(line) as unknown;
        const waiter = this.waiters.shift();
        if (waiter) waiter(parsed);
        else this.requests.push(parsed);
      }
    });
  }

  onClose(): () => void { return () => undefined; }
  async terminate(): Promise<'confirmed'> { this.terminateCalls += 1; return 'confirmed'; }
  nextRequest(): Promise<unknown> {
    const request = this.requests.shift();
    return request === undefined
      ? new Promise(resolve => this.waiters.push(resolve))
      : Promise.resolve(request);
  }
  respond(id: number, result: unknown): void {
    this.input.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }
  request(id: number, method: string, params: unknown): void {
    this.input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  }
  notification(method: string, params: unknown): void {
    this.input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
}

class AuxiliaryClient implements ManagedAcpClient {
  newCalls = 0;
  promptCalls = 0;
  closeCalls = 0;
  closeOutcome: 'confirmed' | 'unconfirmed' = 'confirmed';
  readonly cancelCalls: string[] = [];
  private readonly notifications = new Set<(notification: AcpSessionNotification) => void>();
  private completion = deferred<AcpPromptResponse>();

  async initialize(): Promise<void> {}
  async newSession() { this.newCalls += 1; return { sessionId: 'aux-session' }; }
  async loadSession() { return { sessionId: 'aux-session' }; }
  prompt(): Promise<AcpPromptResponse> { this.promptCalls += 1; return this.completion.promise; }
  async setConfigOption() { return { configOptions: [] }; }
  cancel(sessionId: string): void { this.cancelCalls.push(sessionId); }
  onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onConnectionLost(): () => void { return () => undefined; }
  async close(): Promise<'confirmed' | 'unconfirmed'> {
    this.closeCalls += 1;
    return this.closeOutcome;
  }
  emit(notification: AcpSessionNotification): void {
    for (const listener of this.notifications) listener(notification);
  }
  complete(response: AcpPromptResponse): void { this.completion.resolve(response); }
}

class TestScheduler implements ResultCommitScheduler {
  private readonly tasks = new Map<object, () => void>();
  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) this.tasks.delete(handle);
  }
}

function agentText(sessionId: string, text: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId: 'assistant-1',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition not reached.');
}
