import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';

import type {
  AgentMessageDeltaNotification,
  ErrorNotification,
  ThreadStartParams,
  ThreadStartResult,
  TurnCompletedNotification,
  TurnStartResult,
  UserInput,
} from '../runtime/codexAppServerTypes';
import type { CodexExecutionConnection } from '../runtime/CodexExecutionConnection';
import type { CodexExecutionConnectionFactory } from './CodexExecutionBackend';

/** What one auxiliary turn asks the daemon for, resolved from a reference. */
export interface CodexAuxiliaryInvocation {
  /**
   * Which auxiliary conversation this is — a title, a refinement, an edit.
   *
   * One retained daemon and thread per key, which is what the legacy runner is
   * as separate instances. Opaque here: what counts as a separate auxiliary
   * conversation is the provider's decision.
   */
  readonly retentionKey: string;
  /**
   * What the retained daemon was started for, hashed.
   *
   * The same thing the chat side's restart fingerprint is, and for the same
   * reason: a CLI path, an execution target or a system prompt that changed
   * means the daemon still running under this key was started for something
   * else. Codex takes its instructions on `thread/start` rather than from a
   * file, so a changed system prompt is a new *thread* rather than a new
   * process — but the launch spec behind it can change too, and only a
   * fingerprint can tell the two apart.
   */
  readonly restartFingerprint?: string;
  /**
   * What the auxiliary thread is started with.
   *
   * **This is where an auxiliary turn is made safe**, and it is the whole of it
   * for this provider: `approvalPolicy: 'never'` and `sandbox: 'read-only'` are
   * what stop an unattended turn from writing to the vault or asking a question
   * nobody is there to answer, and `persistExtendedHistory: false` is what keeps
   * it out of the transcript store the chat path reads.
   */
  readonly thread: ThreadStartParams;
  readonly input: readonly UserInput[];
  /** The model this turn runs under, where the caller named one. */
  readonly model?: string;
}

export interface CodexAuxiliaryResolver {
  resolve(requestRef: string): Promise<CodexAuxiliaryInvocation>;
}

/** The text so far, for a caller that renders an auxiliary answer as it arrives. */
export type CodexAuxiliaryTextSink = (accumulated: string) => void;

interface RetainedThread {
  readonly connection: CodexExecutionConnection;
  readonly key: string;
  readonly fingerprint: string | undefined;
  threadId: string | undefined;
  /** Serializes turns on one retained thread; two callers must not interleave. */
  queue: Promise<unknown>;
}

/**
 * Auxiliary Codex work — titles, refinement, inline edits — on its own daemon.
 *
 * Isolated from chat by construction: its own `codex app-server` process, its
 * own thread, and a thread started read-only with approvals turned off. What it
 * must **not** be is cold. `AuxQueryRunner.reset()` exists in the contract
 * because inline edit holds a conversation across calls — `continueConversation`
 * is a second turn on the first turn's thread — so a query that started a fresh
 * thread each time would lose the thread it was asked to continue.
 *
 * Retention is keyed rather than global. The legacy runner is one instance per
 * service, up to three idle daemons, each restarting when the process it kept
 * has died; the same shape lives here in one object, so the daemons are counted
 * in one place and closed by one `dispose`.
 *
 * The shape is `ManagedAcpAuxiliaryQuery`'s deliberately — claim, launch, queue,
 * run, forget — because it is the same problem. What is not shared is the
 * protocol underneath: there is no session to configure here, so the thread
 * parameters carry everything a turn runs under, and the model is the one thing
 * a caller may change between turns.
 */
export class CodexAuxiliaryQuery {
  // Promises rather than threads, because two turns can ask for the same key
  // before either has a daemon: a map of settled threads would launch twice and
  // keep the second, leaving the first running with nobody holding it.
  private readonly retained = new Map<string, Promise<RetainedThread>>();
  private disposed = false;

  constructor(
    private readonly resolver: CodexAuxiliaryResolver,
    private readonly connectionFactory: CodexExecutionConnectionFactory,
    private readonly scheduler: ResultCommitScheduler,
    private readonly maxResultBytes: number,
    private readonly timeoutMs: number,
  ) {}

  async execute(
    requestRef: string,
    signal: AbortSignal,
    onText?: CodexAuxiliaryTextSink,
  ): Promise<string> {
    if (this.disposed) throw new Error('Codex auxiliary queries are disposed.');
    if (signal.aborted) throw abortError(signal);
    const invocation = await raceAbort(this.resolver.resolve(requestRef), signal);
    const thread = await this.claim(invocation, signal);
    // Queued on the thread rather than on this object: two purposes are two
    // daemons and have no reason to wait for each other.
    const turn = thread.queue.then(
      () => this.runTurn(thread, invocation, signal, onText),
      () => this.runTurn(thread, invocation, signal, onText),
    );
    thread.queue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * Closes one retained daemon, which is what `AuxQueryRunner.reset()` means.
   *
   * A reset in flight is not a reason to keep it: the caller has already decided
   * the conversation is over, so the turn goes with the process.
   */
  async release(retentionKey: string): Promise<void> {
    const pending = this.retained.get(retentionKey);
    if (!pending) return;
    this.retained.delete(retentionKey);
    const thread = await pending.catch(() => undefined);
    if (thread) await this.close(thread);
  }

  /** Closes every retained daemon. The composition calls this on unload. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const pending = [...this.retained.values()];
    this.retained.clear();
    const threads = (await Promise.all(pending.map(entry => entry.catch(() => undefined))))
      .filter((thread): thread is RetainedThread => thread !== undefined);
    await Promise.all(threads.map(thread => this.close(thread)));
  }

  /** The retained thread for this invocation, launching or relaunching as the key says. */
  private async claim(
    invocation: CodexAuxiliaryInvocation,
    signal: AbortSignal,
  ): Promise<RetainedThread> {
    const existing = this.retained.get(invocation.retentionKey);
    if (existing) {
      const thread = await existing.catch(() => undefined);
      if (thread && thread.fingerprint === invocation.restartFingerprint) return thread;
      // Started for something else: the settings behind it changed, and what it
      // would answer is what the old ones said.
      await this.release(invocation.retentionKey);
    }
    const launch = this.launch(invocation, signal);
    this.retained.set(invocation.retentionKey, launch);
    // A launch that fails must not be what every later turn on this key awaits.
    void launch.catch(() => {
      if (this.retained.get(invocation.retentionKey) === launch) {
        this.retained.delete(invocation.retentionKey);
      }
    });
    return launch;
  }

  private async launch(
    invocation: CodexAuxiliaryInvocation,
    signal: AbortSignal,
  ): Promise<RetainedThread> {
    const connection = this.connectionFactory.create();
    // Nothing here asks a person anything. An auxiliary turn has no surface to
    // ask on, and the policy it runs under is on the thread — a well-formed
    // auxiliary thread is `approvalPolicy: 'never'` and never sends one. A
    // refusal rather than a silent cancel, because the daemon reports the error
    // back into the turn and the agent can say what it could not do.
    connection.onServerRequest(async (_requestId, method) => {
      throw new Error(`Codex auxiliary work cannot answer ${method}.`);
    });
    const thread: RetainedThread = {
      connection,
      key: invocation.retentionKey,
      fingerprint: invocation.restartFingerprint,
      threadId: undefined,
      queue: Promise.resolve(),
    };
    // A daemon that dies takes its retention with it: the next turn on this key
    // launches rather than prompting a thread nobody is listening to.
    connection.onConnectionLost(() => {
      void this.forget(thread);
    });
    try {
      await raceAbort(connection.initialize(), signal);
    } catch (error) {
      await connection.dispose().catch(() => undefined);
      throw error;
    }
    return thread;
  }

  /** Drops a thread from retention without waiting on it, and closes what is left. */
  private async forget(thread: RetainedThread): Promise<void> {
    const pending = this.retained.get(thread.key);
    if (!pending) return;
    if (await pending.catch(() => undefined) !== thread) return;
    if (this.retained.get(thread.key) === pending) this.retained.delete(thread.key);
    await thread.connection.dispose().catch(() => undefined);
  }

  private async runTurn(
    thread: RetainedThread,
    invocation: CodexAuxiliaryInvocation,
    signal: AbortSignal,
    onText?: CodexAuxiliaryTextSink,
  ): Promise<string> {
    if (signal.aborted) throw abortError(signal);
    let output = '';
    let outputExceeded = false;
    let turnId: string | undefined;
    let failure: string | undefined;
    // Resolved with a value rather than with nothing, because `withDeadline`
    // reports a missed deadline as `undefined` — and a `Promise<void>` resolves
    // to `undefined` too, so every answered turn read as a timeout. The first
    // run of this file's tests found it.
    let settle: (() => void) | undefined;
    const completed = new Promise<'settled'>(resolve => { settle = () => resolve('settled'); });
    const interrupt = (): void => {
      if (!thread.threadId || !turnId) return;
      void thread.connection
        .request('turn/interrupt', { threadId: thread.threadId, turnId })
        .catch(() => undefined);
    };
    const removeNotification = thread.connection.onNotification((method, params) => {
      if (method === 'item/agentMessage/delta') {
        const notification = params as AgentMessageDeltaNotification;
        if (notification.threadId !== thread.threadId) return;
        const next = `${output}${notification.delta}`;
        if (Buffer.byteLength(next, 'utf8') > this.maxResultBytes) {
          outputExceeded = true;
          interrupt();
          settle?.();
          return;
        }
        output = next;
        onText?.(output);
        return;
      }
      if (method === 'turn/completed') {
        const notification = params as TurnCompletedNotification;
        if (notification.threadId !== thread.threadId) return;
        if (notification.turn.status === 'failed' && notification.turn.error) {
          failure = notification.turn.error.message;
        }
        if (notification.turn.status === 'interrupted') {
          failure ??= 'Codex auxiliary turn was interrupted.';
        }
        settle?.();
        return;
      }
      if (method === 'error') {
        const notification = params as ErrorNotification;
        // A retry is the daemon still working the turn, not the turn ending.
        if (notification.willRetry) return;
        failure = notification.error.message;
        settle?.();
      }
    });
    // A daemon that dies mid-turn would otherwise leave this waiting on a
    // completion nothing will send.
    const removeConnectionLost = thread.connection.onConnectionLost(error => {
      failure ??= error?.message ?? 'The Codex auxiliary process exited unexpectedly.';
      settle?.();
    });
    const abort = () => {
      interrupt();
      settle?.();
    };
    signal.addEventListener('abort', abort, { once: true });
    const outcome = await (async () => {
      try {
        if (!thread.threadId) {
          const started = await raceAbort(
            thread.connection.request<ThreadStartResult>('thread/start', invocation.thread),
            signal,
          );
          thread.threadId = started.thread.id;
        }
        const started = await raceAbort(
          thread.connection.request<TurnStartResult>('turn/start', {
            threadId: thread.threadId,
            input: [...invocation.input],
            ...(invocation.model ? { model: invocation.model } : {}),
          }),
          signal,
        );
        turnId = started.turn.id;
        const finished = await withDeadline(completed, this.scheduler, this.timeoutMs);
        if (finished === undefined) {
          interrupt();
          throw new Error('Codex auxiliary query timed out.');
        }
        if (signal.aborted) throw abortError(signal);
        if (outputExceeded) {
          throw new Error('Codex auxiliary result exceeded the byte limit.');
        }
        if (failure) throw new Error(failure);
        return { kind: 'success' as const, value: output.trim() };
      } catch (error) {
        return { kind: 'failure' as const, error: toError(error) };
      }
    })();
    signal.removeEventListener('abort', abort);
    removeNotification();
    removeConnectionLost();
    if (outcome.kind === 'failure') {
      // **The thread goes, the daemon stays.** A turn that failed says nothing
      // about the process, and relaunching one is the expensive half; but the
      // thread it failed on may still have an agent working the input — a
      // timeout is exactly that — and the next turn would arrive underneath it.
      //
      // A caller that aborted is the exception, and it is the one that matters:
      // an interrupt ends the turn rather than the thread, and inline edit's
      // next message is meant to continue this conversation.
      if (!signal.aborted) thread.threadId = undefined;
      throw outcome.error;
    }
    return outcome.value;
  }

  private async close(thread: RetainedThread): Promise<void> {
    await thread.connection.dispose();
  }
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(toError(error)); },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Codex auxiliary operation aborted.');
}

function withDeadline<T>(
  operation: Promise<T>,
  scheduler: ResultCommitScheduler,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = scheduler.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, timeoutMs);
    void operation.then(
      value => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(timeout);
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(timeout);
        reject(toError(error));
      },
    );
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
