import { PassThrough } from 'node:stream';

import trace from '@test/fixtures/provider-traces/opencode-execution.json';

import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';
import {
  AcpManagedClientAdapterFactory,
  type AcpManagedOwnedProcess,
} from '@/providers/acp/execution/AcpManagedClientAdapter';
import {
  type ManagedAcpAuxiliaryInvocation,
  ManagedAcpAuxiliaryQuery,
} from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
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

  it('carries a vendor request the protocol does not define', async () => {
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

    // The outbound half of what `vendorSessionNotifications` does inbound.
    // Grok's plan indicator is `x.ai/billing` over the same transport a turn
    // runs on: no ACP method says what an account has spent, and launching a
    // second process to ask would be a second process.
    const billing = client.vendorRequest?.('x.ai/billing', {});
    const request = await process.nextRequest() as { id: number; method: string };
    expect(request).toEqual(expect.objectContaining({ method: 'x.ai/billing', params: {} }));
    process.respond(request.id, { remainingCredits: 12 });

    await expect(billing).resolves.toEqual({ remainingCredits: 12 });
    await client.close();
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

  /**
   * The auxiliary port, built for the consumer it has to replace.
   *
   * `AuxQueryRunner` is what titles, refinement and inline edits call today, and
   * two of its four members are about a conversation that outlives one call:
   * `reset()`, and inline edit's `continueConversation`, which sends a second
   * message expecting the first to still be there. The trace called this case
   * `client/launch:cold`, which was the design before anyone read the consumer.
   */
  function auxiliaryQuery(
    client: AuxiliaryClient | ((startupRef: string) => AuxiliaryClient),
    invocation: Partial<ManagedAcpAuxiliaryInvocation>
      | (() => Partial<ManagedAcpAuxiliaryInvocation>) = {},
    limits: { maxResultBytes?: number; timeoutMs?: number; scheduler?: TestScheduler } = {},
  ): { launches: string[]; query: ManagedAcpAuxiliaryQuery } {
    const launches: string[] = [];
    const query = new ManagedAcpAuxiliaryQuery(
      {
        // Read per call, because the store will read the settings per call: a
        // resolver that answered with what was true when the query was built
        // could not express a system prompt changing between turns.
        resolve: async requestRef => ({
          startupRef: 'aux-startup',
          cwd: '/vault',
          prompt: [{ type: 'text', text: 'Summarize' }],
          mcpServers: [],
          retentionKey: `retain:${requestRef}`,
          ...(typeof invocation === 'function' ? invocation() : invocation),
        }),
      },
      {
        create: async input => {
          launches.push(input.startupRef);
          return typeof client === 'function' ? client(input.startupRef) : client;
        },
      },
      limits.scheduler ?? new TestScheduler(),
      limits.maxResultBytes ?? 1024,
      limits.timeoutMs ?? 60_000,
    );
    return { launches, query };
  }

  /**
   * Answers one numbered prompt.
   *
   * The turn is named rather than counted, because a retained session is
   * prompted more than once and "wait until it has been prompted" is true the
   * moment the first turn ran — a helper that counted for itself answered the
   * second turn before it was asked, and the tests hung.
   */
  async function answer(
    client: AuxiliaryClient,
    sessionId: string,
    text: string,
    turn = 1,
  ): Promise<void> {
    await waitFor(() => client.promptCalls >= turn);
    client.emit(agentText(sessionId, text));
    client.complete({ stopReason: 'end_turn' });
  }

  it('runs an auxiliary operation in its own session and keeps it for the next turn', async () => {
    const client = new AuxiliaryClient();
    // With a fingerprint, because "kept" has to mean kept *against* one: a
    // retained process that recorded nothing would compare equal to nothing and
    // relaunch on every turn, which no assertion about a single turn can see.
    const { launches, query } = auxiliaryQuery(client, { restartFingerprint: 'launch-a' });

    const first = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'isolated result');
    await expect(first).resolves.toBe('isolated result');
    const promptsAfterFirst = client.promptCalls;
    const second = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'follow-up result', 2);

    // **The conversation is the point.** Inline edit's second message has to
    // reach the session the first one made: one process, one session, two
    // prompts. A cold query would answer this with a new session that has never
    // heard of the edit it is being asked to continue.
    await expect(second).resolves.toBe('follow-up result');
    expect(launches).toEqual(['aux-startup']);
    expect(client.newCalls).toBe(1);
    expect(client.promptCalls).toBe(promptsAfterFirst + 1);
    expect(client.closeCalls).toBe(0);
    expect([
      ...(launches.length > 0 ? ['client/launch:retained'] : []),
      ...(client.newCalls > 0 ? ['session/new:aux-session'] : []),
      ...(client.promptCalls > 0 ? ['session/prompt'] : []),
      ...(client.promptCalls > 1 ? ['session/prompt:retained'] : []),
    ]).toEqual(trace.cases.isolatedAuxiliary);
    await query.dispose();
  });

  it('keeps one process per retention key, and no more', async () => {
    const clients = new Map<string, AuxiliaryClient>();
    const { launches, query } = auxiliaryQuery(startupRef => {
      const client = new AuxiliaryClient();
      clients.set(`${startupRef}:${clients.size}`, client);
      return client;
    }, {});

    // Two purposes — a title and an inline edit — resolve to two keys, because
    // `requestRef` is what the fake resolver builds the key from here.
    const title = query.execute('titles', new AbortController().signal);
    const inline = query.execute('inline', new AbortController().signal);
    // Both processes exist before either is answered: the clients are made
    // inside `create`, so a loop over the map can otherwise run while it is
    // still empty and wait forever for a prompt nobody has issued.
    await waitFor(() => clients.size === 2);
    for (const client of clients.values()) await answer(client, 'aux-session', 'ok');

    await expect(title).resolves.toBe('ok');
    await expect(inline).resolves.toBe('ok');
    expect(launches).toHaveLength(2);
    await query.dispose();
    expect([...clients.values()].map(client => client.closeCalls)).toEqual([1, 1]);
  });

  it('launches once when two turns ask for the same key before either has a process', async () => {
    // The race a map of settled sessions would lose: both turns miss, both
    // launch, and the first process is left running with nobody holding it.
    const client = new AuxiliaryClient();
    const { launches, query } = auxiliaryQuery(client);

    const first = query.execute('aux-ref', new AbortController().signal);
    const second = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'first');
    await expect(first).resolves.toBe('first');
    await answer(client, 'aux-session', 'second', 2);

    await expect(second).resolves.toBe('second');
    expect(launches).toEqual(['aux-startup']);
    await query.dispose();
  });

  it('ends one conversation on release and leaves the others running', async () => {
    const clients: AuxiliaryClient[] = [];
    const { query } = auxiliaryQuery(() => {
      const client = new AuxiliaryClient();
      clients.push(client);
      return client;
    });

    const title = query.execute('titles', new AbortController().signal);
    const inline = query.execute('inline', new AbortController().signal);
    await waitFor(() => clients.length === 2);
    for (const client of clients) await answer(client, 'aux-session', 'ok');
    await Promise.all([title, inline]);
    await query.release('retain:titles');

    expect(clients.map(client => client.closeCalls)).toEqual([1, 0]);
    // What `reset()` means from the consumer's side: the next turn on that key
    // is a new conversation, on a new process.
    const again = query.execute('titles', new AbortController().signal);
    await waitFor(() => clients.length === 3);
    await answer(clients[2], 'aux-session', 'fresh');
    await expect(again).resolves.toBe('fresh');
    expect(clients).toHaveLength(3);
    await query.dispose();
  });

  it('relaunches when the process it kept was started for other settings', async () => {
    const clients: AuxiliaryClient[] = [];
    let fingerprint = 'launch-a';
    const { launches, query } = auxiliaryQuery(() => {
      const client = new AuxiliaryClient();
      clients.push(client);
      return client;
    }, () => ({ retentionKey: 'retain:titles', restartFingerprint: fingerprint }));

    const first = query.execute('titles', new AbortController().signal);
    await waitFor(() => clients.length === 1);
    await answer(clients[0], 'aux-session', 'under the old prompt');
    await first;
    fingerprint = 'launch-b';
    const second = query.execute('titles', new AbortController().signal);
    await waitFor(() => clients.length === 2);
    await answer(clients[1], 'aux-session', 'under the new one');

    // A system prompt edited in settings must reach the next auxiliary turn. A
    // retained process that ignored it would go on answering under the old
    // instructions for as long as it lived.
    await expect(second).resolves.toBe('under the new one');
    expect(launches).toHaveLength(2);
    expect(clients[0].closeCalls).toBe(1);
    await query.dispose();
  });

  it('applies the session configuration once and the turn configuration every turn', async () => {
    const client = new AuxiliaryClient();
    const { query } = auxiliaryQuery(client, {
      sessionConfiguration: [{ configId: 'mode', value: 'grimoire-aux-readonly' }],
      turnConfiguration: [{ configId: 'model', value: 'anthropic/claude-sonnet-4' }],
    });

    const first = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'one');
    await first;
    const second = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'two', 2);
    await second;

    // The agent an auxiliary turn runs as is decided when the session opens;
    // the model can change between turns, because the caller passes one per
    // query and a retained session would otherwise keep the first forever.
    expect(client.configCalls).toEqual([
      { configId: 'mode', value: 'grimoire-aux-readonly' },
      { configId: 'model', value: 'anthropic/claude-sonnet-4' },
      { configId: 'model', value: 'anthropic/claude-sonnet-4' },
    ]);
    // And *not* the other setter: an agent that carries its model as a config
    // option is one that may not have `session/set_model` at all, and calling
    // it with nothing to set is a request nobody asked for.
    //
    // `toHaveLength(0)` rather than `toEqual([])`, and it is not a style
    // preference: **`expect([undefined]).toEqual([])` passes** — Jest's
    // `toEqual` ignores undefined entries — so a setter called with an
    // undefined model reads exactly like a setter that was never called. The
    // break that removed the guard against exactly that went green here.
    expect(client.modelCalls).toHaveLength(0);
    await query.dispose();
  });

  it('applies the model through the setter the agent has', async () => {
    const client = new AuxiliaryClient();
    const { query } = auxiliaryQuery(client, { modelId: 'grok-4-latest' });

    const first = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'one');
    await first;
    const second = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'two', 2);
    await second;

    // Which of the two setters an agent answers is a property of its release:
    // the OpenCode forks carry the model as a config option, Grok has
    // `session/set_model`. Per turn either way, because the caller passes a
    // model per query and a retained session would keep the first forever.
    expect(client.modelCalls).toEqual(['grok-4-latest', 'grok-4-latest']);
    // See the note above: a length assertion, because an empty array and an
    // array of undefined are the same thing to `toEqual`.
    expect(client.configCalls).toHaveLength(0);
    await query.dispose();
  });

  it('answers under the session default when the agent refuses the model setter', async () => {
    const client = new AuxiliaryClient();
    client.refusesModel = true;
    const { query } = auxiliaryQuery(client, { modelId: 'a-model-this-account-lacks' });

    const execution = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'answered anyway');

    // Best effort, exactly as for a refused config option: a title generated by
    // the wrong model beats a title that failed to generate.
    await expect(execution).resolves.toBe('answered anyway');
    await query.dispose();
  });

  it('answers under the session default when the agent refuses a configuration', async () => {
    const client = new AuxiliaryClient();
    client.refusedConfigIds.add('model');
    const { query } = auxiliaryQuery(client, {
      turnConfiguration: [{ configId: 'model', value: 'a-model-this-account-lacks' }],
    });

    const execution = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'answered anyway');

    // Best effort, and deliberately: a title generated by the wrong model is
    // worth more than a title that failed to generate. The same call the chat
    // path makes for a refused mode.
    await expect(execution).resolves.toBe('answered anyway');
    await query.dispose();
  });

  it('reports the answer as it arrives, for a caller that renders one', async () => {
    const client = new AuxiliaryClient();
    const { query } = auxiliaryQuery(client);
    const seen: string[] = [];

    const execution = query.execute('aux-ref', new AbortController().signal, text => seen.push(text));
    await waitFor(() => client.promptCalls === 1);
    client.emit(agentText('aux-session', 'Refined'));
    client.emit(agentText('aux-session', ' instructions'));
    client.complete({ stopReason: 'end_turn' });

    await expect(execution).resolves.toBe('Refined instructions');
    // Accumulated rather than delta, which is what `AuxQueryConfig.onTextChunk`
    // hands its caller: the refine dialog replaces its text with each call.
    expect(seen).toEqual(['Refined', 'Refined instructions']);
    await query.dispose();
  });

  it('cancels and rejects an oversized isolated result, and keeps the process for the next turn', async () => {
    const client = new AuxiliaryClient(['aux-session', 'aux-session-2']);
    const { launches, query } = auxiliaryQuery(client, {}, { maxResultBytes: 3 });

    const execution = query.execute('aux-ref', new AbortController().signal);
    await waitFor(() => client.promptCalls === 1);
    client.emit(agentText('aux-session', 'too large'));
    client.complete({ stopReason: 'end_turn' });

    await expect(execution).rejects.toThrow('byte limit');
    expect(client.cancelCalls).toEqual(['aux-session']);
    // The session goes and the process stays: what failed was the turn, and an
    // agent that was cancelled mid-answer may still be finishing it, so the
    // next turn gets a session of its own rather than arriving underneath.
    const next = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session-2', 'ok', 2);
    await expect(next).resolves.toBe('ok');
    expect(launches).toEqual(['aux-startup']);
    expect(client.newCalls).toBe(2);
    await query.dispose();
  });

  it('keeps the conversation when the caller cancels its own turn', async () => {
    const client = new AuxiliaryClient(['aux-session', 'aux-session-2']);
    const { query } = auxiliaryQuery(client);
    const controller = new AbortController();

    const execution = query.execute('aux-ref', controller.signal);
    await waitFor(() => client.promptCalls === 1);
    controller.abort(new Error('the dialog was closed'));

    await expect(execution).rejects.toThrow('the dialog was closed');
    expect(client.cancelCalls).toEqual(['aux-session']);
    // ACP's cancel ends the turn, not the session. A caller that stopped one
    // edit and typed another is the case this is for, and dropping the session
    // here would lose the conversation it is about to continue.
    const next = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'continued', 2);
    await expect(next).resolves.toBe('continued');
    expect(client.newCalls).toBe(1);
    await query.dispose();
  });

  it('relaunches on the next turn when the process dies under a retained session', async () => {
    const clients: AuxiliaryClient[] = [];
    const { launches, query } = auxiliaryQuery(() => {
      const client = new AuxiliaryClient();
      clients.push(client);
      return client;
    });

    const first = query.execute('aux-ref', new AbortController().signal);
    await waitFor(() => clients.length === 1);
    await answer(clients[0], 'aux-session', 'ok');
    await first;
    clients[0].loseConnection();
    const second = query.execute('aux-ref', new AbortController().signal);
    await waitFor(() => clients.length === 2);
    await answer(clients[1], 'aux-session', 'after the crash');

    await expect(second).resolves.toBe('after the crash');
    expect(launches).toEqual(['aux-startup', 'aux-startup']);
    await query.dispose();
  });

  it('does not report shutdown clean when an auxiliary process cleanup is unconfirmed', async () => {
    const client = new AuxiliaryClient();
    client.closeOutcome = 'unconfirmed';
    const { query } = auxiliaryQuery(client);

    const execution = query.execute('aux-ref', new AbortController().signal);
    await answer(client, 'aux-session', 'result');

    // The turn succeeds — nothing about it was unconfirmed. What must not pass
    // quietly is the shutdown, which is where the process is supposed to die
    // and where a survivor is a leak nobody would otherwise see.
    await expect(execution).resolves.toBe('result');
    await expect(query.dispose()).rejects.toThrow('termination was not confirmed');
    expect(client.closeCalls).toBe(1);
  });

  it('refuses to start an auxiliary turn after dispose', async () => {
    const client = new AuxiliaryClient();
    const { query } = auxiliaryQuery(client);
    await query.dispose();

    await expect(query.execute('aux-ref', new AbortController().signal))
      .rejects.toThrow('disposed');
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
}

class AuxiliaryClient implements ManagedAcpClient {
  newCalls = 0;
  promptCalls = 0;
  closeCalls = 0;
  closeOutcome: 'confirmed' | 'unconfirmed' = 'confirmed';
  /** Every `session/set_config_option` this client was asked for, in order. */
  readonly configCalls: Array<{ configId: string; value: unknown }> = [];
  /** Config ids the agent refuses, so a best-effort application can be observed. */
  readonly refusedConfigIds = new Set<string>();
  readonly cancelCalls: string[] = [];
  private readonly notifications = new Set<(notification: AcpSessionNotification) => void>();
  private readonly connectionLost = new Set<(error?: Error) => void>();
  private completion = deferred<AcpPromptResponse>();

  constructor(private readonly sessionIds: string[] = ['aux-session']) {}

  async initialize(): Promise<void> {}
  async newSession() {
    const sessionId = this.sessionIds[Math.min(this.newCalls, this.sessionIds.length - 1)];
    this.newCalls += 1;
    return { sessionId };
  }
  async loadSession() { return { sessionId: 'aux-session' }; }
  prompt(): Promise<AcpPromptResponse> {
    this.promptCalls += 1;
    // A fresh promise per turn: a retained session is prompted more than once,
    // and a settled one would answer the second turn before it was asked.
    this.completion = deferred<AcpPromptResponse>();
    return this.completion.promise;
  }
  /** Every `session/set_model` this client was asked for, in order. */
  readonly modelCalls: string[] = [];
  /** Whether the agent refuses the dedicated setter, as one without it would. */
  refusesModel = false;

  async setMode() { return {}; }
  async setModel(request: { modelId: string }) {
    this.modelCalls.push(request.modelId);
    if (this.refusesModel) throw new Error('session/set_model is not supported.');
    return {};
  }
  async setConfigOption(request: { configId: string; value: unknown }) {
    this.configCalls.push({ configId: request.configId, value: request.value });
    if (this.refusedConfigIds.has(request.configId)) {
      throw new Error(`Config option ${request.configId} is not available.`);
    }
    return { configOptions: [] };
  }
  cancel(sessionId: string): void { this.cancelCalls.push(sessionId); }
  onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onConnectionLost(listener: (error?: Error) => void): () => void {
    this.connectionLost.add(listener);
    return () => this.connectionLost.delete(listener);
  }
  async close(): Promise<'confirmed' | 'unconfirmed'> {
    this.closeCalls += 1;
    return this.closeOutcome;
  }
  emit(notification: AcpSessionNotification): void {
    for (const listener of this.notifications) listener(notification);
  }
  complete(response: AcpPromptResponse): void { this.completion.resolve(response); }
  loseConnection(): void {
    for (const listener of this.connectionLost) listener(new Error('transport closed'));
  }
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
