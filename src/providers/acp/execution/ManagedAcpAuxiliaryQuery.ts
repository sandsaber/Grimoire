import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';

import type { AcpContentBlock, AcpSessionConfigId, AcpSessionConfigValueId } from '../types';
import type { ManagedAcpClient, ManagedAcpClientFactory } from './ManagedAcpClient';
import { ManagedAcpTerminationUnconfirmedError } from './ManagedAcpClient';

/** One `session/set_config_option`, as an auxiliary turn asks for it. */
export interface ManagedAcpAuxiliaryConfigOption {
  readonly configId: AcpSessionConfigId;
  readonly value: AcpSessionConfigValueId;
}

export interface ManagedAcpAuxiliaryInvocation {
  readonly startupRef: string;
  readonly cwd: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly mcpServers: readonly [];
  /**
   * Which auxiliary conversation this is — a title, a refinement, an edit.
   *
   * One retained process per key, which is what the legacy runners are as
   * separate instances. Opaque here: what counts as a separate auxiliary
   * conversation is the provider's decision.
   */
  readonly retentionKey: string;
  /**
   * What the retained process was started for, hashed.
   *
   * The same thing `ManagedAcpExecutionInvocation.restartFingerprint` is on the
   * chat side, and for the same reason: a CLI path, a generated config, an
   * environment or a system prompt that changed means the process still running
   * under this key was started for something else. Without it a system prompt
   * edited in settings would go on being ignored for as long as the process
   * lived — which is exactly what the legacy runners relaunch to avoid.
   */
  readonly restartFingerprint?: string;
  /** Applied once, when the session is created — the agent an auxiliary turn runs as. */
  readonly sessionConfiguration?: readonly ManagedAcpAuxiliaryConfigOption[];
  /** Applied before every prompt — the model, which the caller may change between turns. */
  readonly turnConfiguration?: readonly ManagedAcpAuxiliaryConfigOption[];
}

export interface ManagedAcpAuxiliaryResolver {
  resolve(requestRef: string): Promise<ManagedAcpAuxiliaryInvocation>;
}

/** The text so far, for a caller that renders an auxiliary answer as it arrives. */
export type ManagedAcpAuxiliaryTextSink = (accumulated: string) => void;

interface RetainedSession {
  readonly client: ManagedAcpClient;
  readonly key: string;
  readonly fingerprint: string | undefined;
  sessionId: string | undefined;
  /** Serializes turns on one retained session; two callers must not interleave prompts. */
  queue: Promise<unknown>;
}

/**
 * Auxiliary ACP work — titles, refinement, inline edits — on its own process.
 *
 * Isolated from chat by construction: its own client, its own session, and a
 * permission answer that refuses everything. What it must **not** be is cold,
 * and that is the correction this module needed before it could replace
 * anything. `AuxQueryRunner.reset()` exists in the contract because inline edit
 * holds a conversation across calls — `continueConversation` is a second turn on
 * the first turn's session — so a query that closed its session each time would
 * lose the thread it was asked to continue. The retained session is not a
 * performance decision.
 *
 * Retention is keyed rather than global. The legacy runners are one instance per
 * purpose, up to three idle processes per provider, each relaunching when its
 * own launch key changes; the same shape lives here in one object, so the
 * processes are counted in one place and closed by one `dispose`.
 *
 * Configuration is applied **best effort**. A refused option leaves the turn to
 * run under whatever the session already had, because an auxiliary answer under
 * the default model is worth more than no answer at all — the same call the chat
 * path makes for a refused mode.
 */
export class ManagedAcpAuxiliaryQuery {
  // Promises rather than sessions, because two turns can ask for the same key
  // before either has a process: a map of settled sessions would launch twice
  // and keep the second, leaving the first running with nobody holding it.
  private readonly retained = new Map<string, Promise<RetainedSession>>();
  private disposed = false;

  constructor(
    private readonly resolver: ManagedAcpAuxiliaryResolver,
    private readonly clientFactory: ManagedAcpClientFactory,
    private readonly scheduler: ResultCommitScheduler,
    private readonly maxResultBytes: number,
    private readonly timeoutMs: number,
  ) {}

  async execute(
    requestRef: string,
    signal: AbortSignal,
    onText?: ManagedAcpAuxiliaryTextSink,
  ): Promise<string> {
    if (this.disposed) throw new Error('Managed ACP auxiliary queries are disposed.');
    if (signal.aborted) throw abortError(signal);
    const invocation = await raceAbort(this.resolver.resolve(requestRef), signal);
    const session = await this.claim(invocation, signal);
    // Queued on the session rather than on this object: two purposes are two
    // processes and have no reason to wait for each other.
    const turn = session.queue.then(
      () => this.runTurn(session, invocation, signal, onText),
      () => this.runTurn(session, invocation, signal, onText),
    );
    session.queue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * Closes one retained process, which is what `AuxQueryRunner.reset()` means.
   *
   * A reset in flight is not a reason to keep the process: the caller has
   * already decided the conversation is over, so the turn is cancelled and the
   * session goes with it.
   */
  async release(retentionKey: string): Promise<void> {
    const pending = this.retained.get(retentionKey);
    if (!pending) return;
    this.retained.delete(retentionKey);
    const session = await pending.catch(() => undefined);
    if (session) await this.close(session);
  }

  /** Closes every retained process. The composition calls this on unload. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const pending = [...this.retained.values()];
    this.retained.clear();
    const sessions = (await Promise.all(pending.map(entry => entry.catch(() => undefined))))
      .filter((session): session is RetainedSession => session !== undefined);
    const outcomes = await Promise.allSettled(sessions.map(session => this.close(session)));
    const unconfirmed = outcomes.find(outcome => (
      outcome.status === 'rejected'
      && outcome.reason instanceof ManagedAcpTerminationUnconfirmedError
    ));
    if (unconfirmed?.status === 'rejected') throw unconfirmed.reason;
  }

  /** The retained session for this invocation, launching or relaunching as the key says. */
  private async claim(
    invocation: ManagedAcpAuxiliaryInvocation,
    signal: AbortSignal,
  ): Promise<RetainedSession> {
    const existing = this.retained.get(invocation.retentionKey);
    if (existing) {
      const session = await existing.catch(() => undefined);
      if (session && session.fingerprint === invocation.restartFingerprint) return session;
      // Started for something else: the settings behind it changed, and what it
      // would answer is what the old ones said.
      await this.release(invocation.retentionKey);
    }
    // A key that is not in the map means either nothing has launched for it or
    // what launched was for something this turn is not: a different CLI path, a
    // different generated config, a different system prompt. The provider
    // decides that by choosing the key; reuse here is only ever exact.
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
    invocation: ManagedAcpAuxiliaryInvocation,
    signal: AbortSignal,
  ): Promise<RetainedSession> {
    const creation = this.clientFactory.create({
      startupRef: invocation.startupRef,
      signal,
      // Nothing here asks a person anything. An auxiliary turn has no surface
      // to ask on, and the permission policy it should be running under belongs
      // to the launch the `startupRef` names — that is where the legacy runners
      // put it, in the generated agent config, so a well-formed auxiliary agent
      // never reaches this callback.
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    });
    let client: ManagedAcpClient;
    try {
      client = await raceAbort(creation, signal);
    } catch (error) {
      void creation
        .then(lateClient => lateClient.close(), () => undefined)
        .catch(() => undefined);
      throw error;
    }
    const session: RetainedSession = {
      client,
      key: invocation.retentionKey,
      fingerprint: invocation.restartFingerprint,
      sessionId: undefined,
      queue: Promise.resolve(),
    };
    // A process that dies takes its retention with it: the next turn on this
    // key launches rather than prompting a session nobody is listening to.
    client.onConnectionLost(() => {
      void this.forget(session);
    });
    return session;
  }

  /** Drops a session from retention without waiting on it, and closes what is left. */
  private async forget(session: RetainedSession): Promise<void> {
    const pending = this.retained.get(session.key);
    if (!pending) return;
    if (await pending.catch(() => undefined) !== session) return;
    if (this.retained.get(session.key) === pending) this.retained.delete(session.key);
    await session.client.close().catch(() => undefined);
  }

  private async runTurn(
    session: RetainedSession,
    invocation: ManagedAcpAuxiliaryInvocation,
    signal: AbortSignal,
    onText?: ManagedAcpAuxiliaryTextSink,
  ): Promise<string> {
    if (signal.aborted) throw abortError(signal);
    let output = '';
    let outputExceeded = false;
    const removeNotification = session.client.onSessionNotification(notification => {
      if (notification.sessionId !== session.sessionId) return;
      const update = notification.update;
      if (update.sessionUpdate !== 'agent_message_chunk' || update.content.type !== 'text') return;
      const next = `${output}${update.content.text}`;
      if (Buffer.byteLength(next, 'utf8') > this.maxResultBytes) {
        outputExceeded = true;
        if (session.sessionId) session.client.cancel(session.sessionId);
        return;
      }
      output = next;
      onText?.(output);
    });
    const abort = () => {
      if (session.sessionId) session.client.cancel(session.sessionId);
    };
    signal.addEventListener('abort', abort, { once: true });
    const outcome = await (async () => {
      try {
        if (!session.sessionId) {
          await raceAbort(session.client.initialize(), signal);
          const opened = await raceAbort(session.client.newSession({
            cwd: invocation.cwd,
            mcpServers: [],
          }), signal);
          session.sessionId = opened.sessionId;
          await this.configure(session, invocation.sessionConfiguration, signal);
        }
        await this.configure(session, invocation.turnConfiguration, signal);
        const sessionId = session.sessionId;
        const response = await withDeadline(
          raceAbort(session.client.prompt({ prompt: [...invocation.prompt], sessionId }), signal),
          this.scheduler,
          this.timeoutMs,
        );
        if (!response) {
          session.client.cancel(sessionId);
          throw new Error('Managed ACP auxiliary query timed out.');
        }
        if (outputExceeded) {
          throw new Error('Managed ACP auxiliary result exceeded the byte limit.');
        }
        if (/cancel/i.test(response.stopReason)) {
          throw new Error('Managed ACP auxiliary query cancelled.');
        }
        return { kind: 'success' as const, value: output.trim() };
      } catch (error) {
        return { kind: 'failure' as const, error };
      }
    })();
    signal.removeEventListener('abort', abort);
    removeNotification();
    if (outcome.kind === 'failure') {
      // **The session goes, the process stays.** A turn that failed says nothing
      // about the process, and relaunching one is the expensive half; but the
      // session it failed on may still have an agent working the prompt — a
      // timeout is exactly that — and the next turn would arrive underneath it.
      //
      // A caller that aborted is the exception, and it is the one that matters:
      // ACP's cancel ends the turn rather than the session, and inline edit's
      // next message is meant to continue this conversation.
      if (!signal.aborted) session.sessionId = undefined;
      throw outcome.error;
    }
    return outcome.value;
  }

  private async configure(
    session: RetainedSession,
    options: readonly ManagedAcpAuxiliaryConfigOption[] | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const sessionId = session.sessionId;
    if (!options?.length || !sessionId) return;
    for (const option of options) {
      try {
        await raceAbort(session.client.setConfigOption({
          configId: option.configId,
          sessionId,
          type: 'select',
          value: option.value,
        }), signal);
      } catch (error) {
        // Best effort, and only for what the *agent* refused. An abort is the
        // caller leaving, and continuing to configure a session nobody is
        // waiting for would be the query ignoring its own cancellation.
        if (signal.aborted) throw error;
      }
    }
  }

  private async close(session: RetainedSession): Promise<void> {
    if (session.sessionId) session.client.cancel(session.sessionId);
    if (await session.client.close() === 'unconfirmed') {
      throw new ManagedAcpTerminationUnconfirmedError(
        'Managed ACP auxiliary process termination was not confirmed.',
      );
    }
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
  return signal.reason instanceof Error ? signal.reason : new Error('Managed ACP operation aborted.');
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
