import type { Unsubscribe } from '@/core/execution/ExecutionContracts';
import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';
import {
  type CodexAuxiliaryInvocation,
  CodexAuxiliaryQuery,
} from '@/providers/codex/execution/CodexAuxiliaryQuery';
import type {
  CodexExecutionConnection,
  CodexExecutionNotificationListener,
  CodexExecutionServerRequestHandler,
} from '@/providers/codex/runtime/CodexExecutionConnection';

/**
 * Auxiliary Codex work, on its own daemon and its own thread.
 *
 * The module `ManagedAcpAuxiliaryQuery` is for the ACP providers, and this is
 * the same problem over a different protocol: there is no session to configure
 * here, so everything that makes a turn auxiliary is on `thread/start`, and what
 * a `reset()` ends is a daemon and the thread it was holding.
 *
 * What is asserted here is what the legacy runner did and what it did not: it
 * kept one thread across calls, because inline edit's second message has to
 * reach the first one's conversation; and it restarted only when the process it
 * had was dead, which is the case that broke every later edit until a reload.
 */
describe('Codex auxiliary query', () => {
  class TestScheduler implements ResultCommitScheduler {
    private next = 1;
    readonly pending = new Map<number, () => void>();

    setTimeout(callback: () => void): unknown {
      const handle = this.next++;
      this.pending.set(handle, callback);
      return handle;
    }

    clearTimeout(handle: unknown): void {
      this.pending.delete(handle as number);
    }

    /** Fires every armed deadline, which is what a real timer would eventually do. */
    expire(): void {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      for (const callback of callbacks) callback();
    }
  }

  class FakeCodexConnection implements CodexExecutionConnection {
    initializeResult = null;
    initializeCalls = 0;
    threadStarts: unknown[] = [];
    turnStarts: unknown[] = [];
    interrupts: unknown[] = [];
    disposeCalls = 0;
    threadCounter = 0;
    turnCounter = 0;
    startFails: string | undefined;
    private readonly notifications = new Set<CodexExecutionNotificationListener>();
    private readonly serverRequests = new Set<CodexExecutionServerRequestHandler>();
    private readonly lost = new Set<(error?: Error) => void>();
    private turnStarted: (() => void) | undefined;

    constructor(readonly label = 'daemon') {}

    async initialize(): Promise<never> {
      this.initializeCalls += 1;
      return undefined as never;
    }

    async request<T>(method: string, params: unknown): Promise<T> {
      if (method === 'thread/start') {
        this.threadStarts.push(params);
        if (this.startFails) throw new Error(this.startFails);
        this.threadCounter += 1;
        return { thread: { id: `thread-${this.threadCounter}` } } as T;
      }
      if (method === 'turn/start') {
        this.turnStarts.push(params);
        this.turnCounter += 1;
        const result = { turn: { id: `turn-${this.turnCounter}` } } as T;
        // Announced after the promise the query awaits has a value, which is
        // when the turn id exists and an interrupt can name it.
        queueMicrotask(() => this.turnStarted?.());
        return result;
      }
      if (method === 'turn/interrupt') {
        this.interrupts.push(params);
        return undefined as T;
      }
      throw new Error(`unexpected ${method}`);
    }

    notify(): void {}

    onNotification(listener: CodexExecutionNotificationListener): Unsubscribe {
      this.notifications.add(listener);
      return () => this.notifications.delete(listener);
    }

    onServerRequest(handler: CodexExecutionServerRequestHandler): Unsubscribe {
      this.serverRequests.add(handler);
      return () => this.serverRequests.delete(handler);
    }

    onConnectionLost(listener: (error?: Error) => void): Unsubscribe {
      this.lost.add(listener);
      return () => this.lost.delete(listener);
    }

    async dispose(): Promise<void> {
      this.disposeCalls += 1;
    }

    emit(method: string, params: unknown): void {
      for (const listener of [...this.notifications]) listener(method, params);
    }

    /** Resolves once the query has started a turn this daemon can answer. */
    async awaitTurn(count = 1): Promise<void> {
      while (this.turnStarts.length < count) {
        await new Promise<void>(resolve => { this.turnStarted = resolve; });
      }
    }

    answer(text: string, threadId = `thread-${this.threadCounter}`): void {
      this.emit('item/agentMessage/delta', {
        threadId,
        turnId: `turn-${this.turnCounter}`,
        itemId: 'item-1',
        delta: text,
      });
      this.emit('turn/completed', {
        threadId,
        turn: { id: `turn-${this.turnCounter}`, items: [], status: 'completed', error: null },
      });
    }

    fail(message: string, threadId = `thread-${this.threadCounter}`): void {
      this.emit('turn/completed', {
        threadId,
        turn: {
          id: `turn-${this.turnCounter}`,
          items: [],
          status: 'failed',
          error: { message, codexErrorInfo: '', additionalDetails: null },
        },
      });
    }

    die(error?: Error): void {
      for (const listener of [...this.lost]) listener(error);
    }

    async askAnything(): Promise<unknown> {
      const handlers = [...this.serverRequests];
      if (handlers.length === 0) throw new Error('no handler');
      return handlers[0](1, 'item/commandExecution/requestApproval', {});
    }
  }

  const THREAD = Object.freeze({
    model: 'gpt-5.4',
    cwd: '/vault',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    baseInstructions: 'Name the conversation.',
    experimentalRawEvents: true,
    persistExtendedHistory: false,
  });

  function createQuery(
    connections: FakeCodexConnection | ((index: number) => FakeCodexConnection),
    invocation: Partial<CodexAuxiliaryInvocation> | (() => Partial<CodexAuxiliaryInvocation>) = {},
    limits: { maxResultBytes?: number; scheduler?: TestScheduler } = {},
  ): { query: CodexAuxiliaryQuery; state: { launches: number }; scheduler: TestScheduler } {
    const state = { launches: 0 };
    const scheduler = limits.scheduler ?? new TestScheduler();
    const query = new CodexAuxiliaryQuery(
      {
        // Read per call, because the store reads the settings per call: a
        // resolver that answered with what was true when the query was built
        // could not express a system prompt changing between turns.
        resolve: async requestRef => ({
          retentionKey: `retain:${requestRef}`,
          thread: { ...THREAD },
          input: [{ type: 'text', text: 'Summarize' }],
          ...(typeof invocation === 'function' ? invocation() : invocation),
        }),
      },
      {
        create: () => {
          const index = state.launches;
          state.launches += 1;
          return typeof connections === 'function' ? connections(index) : connections;
        },
      },
      scheduler,
      limits.maxResultBytes ?? 1024,
      60_000,
    );
    return { query, state, scheduler };
  }

  /** The factory is called inside the launch, which is after `execute` returns. */
  async function waitForDaemon(
    daemons: FakeCodexConnection[],
    index: number,
  ): Promise<FakeCodexConnection> {
    for (let attempt = 0; attempt < 200 && !daemons[index]; attempt += 1) {
      await new Promise(resolve => { setTimeout(resolve, 0); });
    }
    const daemon = daemons[index];
    if (!daemon) throw new Error(`Daemon ${index} never launched.`);
    return daemon;
  }

  it('starts an auxiliary thread with approvals off and the sandbox read-only', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    connection.answer('A Title');

    await expect(turn).resolves.toBe('A Title');
    // **This is the whole of what makes a Codex turn auxiliary.** There is no
    // agent definition and no filesystem delegate to deny anything: an
    // unattended turn is safe because the thread it runs on cannot approve, and
    // cannot write, and is not written into the transcript store the chat reads.
    expect(connection.threadStarts).toEqual([{
      model: 'gpt-5.4',
      cwd: '/vault',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions: 'Name the conversation.',
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    }]);
    await harness.query.dispose();
  });

  it('keeps the thread for the next turn on the same conversation', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection, { restartFingerprint: 'launch-a' });

    const first = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn(1);
    connection.answer('first');
    await expect(first).resolves.toBe('first');
    const second = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn(2);
    connection.answer('second');

    // **The conversation is the point.** Inline edit's second message has to
    // reach the thread the first one made: one daemon, one thread, two turns.
    await expect(second).resolves.toBe('second');
    expect(harness.state.launches).toBe(1);
    expect(connection.threadStarts).toHaveLength(1);
    expect(connection.turnStarts).toHaveLength(2);
    expect(connection.disposeCalls).toBe(0);
    await harness.query.dispose();
  });

  it('keeps one daemon per retention key, and no more', async () => {
    const daemons: FakeCodexConnection[] = [];
    let key = 'retain:a';
    const harness = createQuery(
      index => {
        daemons[index] = new FakeCodexConnection(`daemon-${index}`);
        return daemons[index];
      },
      () => ({ retentionKey: key }),
    );

    const first = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 0)).awaitTurn();
    daemons[0].answer('one');
    await first;
    key = 'retain:b';
    const second = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 1)).awaitTurn();
    daemons[1].answer('two');
    await second;

    // Three purposes are three daemons, and a title generated while an edit is
    // open must not land in the edit's thread.
    expect(harness.state.launches).toBe(2);
    await harness.query.dispose();
  });

  it('relaunches when the daemon it kept was started for other settings', async () => {
    const daemons: FakeCodexConnection[] = [];
    let fingerprint = 'launch-a';
    const harness = createQuery(
      index => {
        daemons[index] = new FakeCodexConnection(`daemon-${index}`);
        return daemons[index];
      },
      () => ({ restartFingerprint: fingerprint }),
    );

    const first = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 0)).awaitTurn();
    daemons[0].answer('one');
    await first;
    fingerprint = 'launch-b';
    const second = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 1)).awaitTurn();
    daemons[1].answer('two');
    await second;

    // Codex takes its instructions on `thread/start` and a thread cannot be told
    // new ones, so a changed system prompt is a changed launch key — and what it
    // relaunches is the pair, because the pair is what was retained.
    expect(harness.state.launches).toBe(2);
    expect(daemons[0].disposeCalls).toBe(1);
    await harness.query.dispose();
  });

  it('ends one conversation on release and leaves the others running', async () => {
    const daemons: FakeCodexConnection[] = [];
    let key = 'retain:a';
    const harness = createQuery(
      index => {
        daemons[index] = new FakeCodexConnection(`daemon-${index}`);
        return daemons[index];
      },
      () => ({ retentionKey: key }),
    );

    const first = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 0)).awaitTurn();
    daemons[0].answer('one');
    await first;
    key = 'retain:b';
    const second = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 1)).awaitTurn();
    daemons[1].answer('two');
    await second;

    await harness.query.release('retain:a');

    // What the title service does after every title, and it must not take the
    // inline edit's daemon with it.
    expect(daemons[0].disposeCalls).toBe(1);
    expect(daemons[1].disposeCalls).toBe(0);
    await harness.query.dispose();
  });

  it('reports the answer as it arrives, for a caller that renders one', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);
    const streamed: string[] = [];

    const turn = harness.query.execute('aux-ref', new AbortController().signal, text => streamed.push(text));
    await connection.awaitTurn();
    connection.emit('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'i', delta: 'Refined',
    });
    connection.emit('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'i', delta: ' instructions',
    });
    connection.emit('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', items: [], status: 'completed', error: null },
    });

    await expect(turn).resolves.toBe('Refined instructions');
    // The refine dialog renders the answer while it arrives, which is the only
    // reason the accumulated text travels rather than the delta.
    expect(streamed).toEqual(['Refined', 'Refined instructions']);
    await harness.query.dispose();
  });

  it('interrupts and rejects an oversized result, and keeps the daemon', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection, {}, { maxResultBytes: 8 });

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    connection.emit('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'i', delta: 'far too much text',
    });

    await expect(turn).rejects.toThrow('byte limit');
    // Stopped rather than left running: a model that misread its instructions
    // goes on producing, and nobody is watching this turn.
    expect(connection.interrupts).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
    expect(connection.disposeCalls).toBe(0);
    await harness.query.dispose();
  });

  it('drops the thread when a turn fails, and keeps the daemon', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);

    const failed = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn(1);
    connection.fail('the model refused');
    await expect(failed).rejects.toThrow('the model refused');

    const next = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn(2);
    connection.answer('recovered', 'thread-2');
    await expect(next).resolves.toBe('recovered');

    // The thread may still have an agent working the input; the daemon says
    // nothing about it and relaunching one is the expensive half.
    expect(harness.state.launches).toBe(1);
    expect(connection.threadStarts).toHaveLength(2);
    await harness.query.dispose();
  });

  it('reports the error the daemon sent, when it says it will not retry', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    // A retry is the daemon still working the turn, and treating it as the end
    // would answer a title with a transient network error.
    connection.emit('error', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      willRetry: true,
      error: { message: 'transient', codexErrorInfo: '', additionalDetails: null },
    });
    connection.emit('error', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      willRetry: false,
      error: { message: 'quota exhausted', codexErrorInfo: '', additionalDetails: null },
    });

    await expect(turn).rejects.toThrow('quota exhausted');
    await harness.query.dispose();
  });

  it('keeps the conversation when the caller cancels its own turn', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);
    const abort = new AbortController();

    const turn = harness.query.execute('aux-ref', abort.signal);
    await connection.awaitTurn();
    abort.abort(new Error('the dialog was closed'));

    await expect(turn).rejects.toThrow('the dialog was closed');
    // Codex's interrupt ends the turn rather than the thread, and inline edit's
    // next message is meant to continue this conversation.
    expect(connection.interrupts).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
    expect(connection.disposeCalls).toBe(0);
    await harness.query.dispose();
  });

  it('gives up on a turn that never completes, and says so', async () => {
    const connection = new FakeCodexConnection();
    const scheduler = new TestScheduler();
    const harness = createQuery(connection, {}, { scheduler });

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    scheduler.expire();

    // Nobody is waiting on this but a title that will not appear, and the daemon
    // would otherwise hold the turn open forever.
    await expect(turn).rejects.toThrow('timed out');
    expect(connection.interrupts).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
    await harness.query.dispose();
  });

  it('relaunches on the next turn when the daemon dies under a retained thread', async () => {
    const daemons: FakeCodexConnection[] = [];
    const harness = createQuery(index => {
      daemons[index] = new FakeCodexConnection(`daemon-${index}`);
      return daemons[index];
    });

    const first = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 0)).awaitTurn();
    daemons[0].answer('one');
    await first;
    daemons[0].die(new Error('the process exited'));
    await new Promise(resolve => { setTimeout(resolve, 0); });
    const second = harness.query.execute('aux-ref', new AbortController().signal);
    await (await waitForDaemon(daemons, 1)).awaitTurn();
    daemons[1].answer('two');

    // The defect the legacy runner shipped and later fixed: after the daemon
    // died both its references stayed non-null, so every later inline edit and
    // title failed against a dead transport until the plugin was reloaded.
    await expect(second).resolves.toBe('two');
    expect(harness.state.launches).toBe(2);
    await harness.query.dispose();
  });

  it('ends a turn whose daemon dies mid-turn rather than waiting forever', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    connection.die(new Error('the process exited'));

    await expect(turn).rejects.toThrow('the process exited');
    await harness.query.dispose();
  });

  it('refuses a server request, because there is nobody to ask', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    connection.answer('done');
    await turn;

    // A well-formed auxiliary thread is `approvalPolicy: 'never'` and never
    // sends one. If one arrives anyway it is refused with an error the daemon
    // reports back into the turn, rather than left hanging on a modal that will
    // never appear.
    await expect(connection.askAnything()).rejects.toThrow('cannot answer');
    await harness.query.dispose();
  });

  it('names the model on the turn only when the caller named one', async () => {
    const connection = new FakeCodexConnection();
    const named = createQuery(connection, { model: 'gpt-5.4-codex' });

    const turn = named.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    connection.answer('done');
    await turn;

    expect(connection.turnStarts).toEqual([{
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Summarize' }],
      model: 'gpt-5.4-codex',
    }]);
    await named.query.dispose();

    const bare = new FakeCodexConnection();
    const plain = createQuery(bare);
    const second = plain.query.execute('aux-ref', new AbortController().signal);
    await bare.awaitTurn();
    bare.answer('done');
    await second;

    // A turn that repeats the thread's own model says nothing, and the legacy
    // runner sent it only when it had been asked for.
    expect(bare.turnStarts).toEqual([{
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Summarize' }],
    }]);
    await plain.query.dispose();
  });

  it('closes every daemon it kept when it is disposed, and refuses turns after', async () => {
    const connection = new FakeCodexConnection();
    const harness = createQuery(connection);

    const turn = harness.query.execute('aux-ref', new AbortController().signal);
    await connection.awaitTurn();
    connection.answer('done');
    await turn;
    await harness.query.dispose();

    // A plugin unload with an idle auxiliary CLI still running is the leak the
    // retained daemon would otherwise be.
    expect(connection.disposeCalls).toBe(1);
    await expect(harness.query.execute('aux-ref', new AbortController().signal))
      .rejects.toThrow('disposed');
  });
});
