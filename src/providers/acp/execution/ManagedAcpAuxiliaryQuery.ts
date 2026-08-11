import type { ResultCommitScheduler } from '@/core/execution/ResultCommit';

import type { AcpContentBlock } from '../types';
import type { ManagedAcpClientFactory } from './ManagedAcpClient';
import { ManagedAcpTerminationUnconfirmedError } from './ManagedAcpClient';

export interface ManagedAcpAuxiliaryInvocation {
  readonly startupRef: string;
  readonly cwd: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly mcpServers: readonly [];
}

export interface ManagedAcpAuxiliaryResolver {
  resolve(requestRef: string): Promise<ManagedAcpAuxiliaryInvocation>;
}

/** A cold, isolated ACP session for title/refine/inline auxiliary work. */
export class ManagedAcpAuxiliaryQuery {
  constructor(
    private readonly resolver: ManagedAcpAuxiliaryResolver,
    private readonly clientFactory: ManagedAcpClientFactory,
    private readonly scheduler: ResultCommitScheduler,
    private readonly maxResultBytes: number,
    private readonly timeoutMs: number,
  ) {}

  async execute(requestRef: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw abortError(signal);
    const invocation = await raceAbort(this.resolver.resolve(requestRef), signal);
    const creation = this.clientFactory.create({
      startupRef: invocation.startupRef,
      signal,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    });
    let client;
    try {
      client = await raceAbort(creation, signal);
    } catch (error) {
      void creation
        .then(lateClient => lateClient.close(), () => undefined)
        .catch(() => undefined);
      throw error;
    }
    let output = '';
    let outputExceeded = false;
    let sessionId: string | undefined;
    const removeNotification = client.onSessionNotification(notification => {
      if (notification.sessionId !== sessionId) return;
      const update = notification.update;
      if (update.sessionUpdate !== 'agent_message_chunk' || update.content.type !== 'text') return;
      const next = `${output}${update.content.text}`;
      if (Buffer.byteLength(next, 'utf8') > this.maxResultBytes) {
        outputExceeded = true;
        if (sessionId) client.cancel(sessionId);
        return;
      }
      output = next;
    });
    const abort = () => {
      if (sessionId) client.cancel(sessionId);
    };
    signal.addEventListener('abort', abort, { once: true });
    const outcome = await (async () => {
      try {
        await raceAbort(client.initialize(), signal);
        const session = await raceAbort(client.newSession({
          cwd: invocation.cwd,
          mcpServers: [],
        }), signal);
        sessionId = session.sessionId;
        const response = await withDeadline(
          raceAbort(client.prompt({ prompt: [...invocation.prompt], sessionId }), signal),
          this.scheduler,
          this.timeoutMs,
        );
        if (!response) {
          client.cancel(sessionId);
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
    if (await client.close() === 'unconfirmed') {
      throw new ManagedAcpTerminationUnconfirmedError(
        'Managed ACP auxiliary process termination was not confirmed.',
      );
    }
    if (outcome.kind === 'failure') throw outcome.error;
    return outcome.value;
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
