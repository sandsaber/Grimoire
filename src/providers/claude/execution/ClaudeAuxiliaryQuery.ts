import {
  type Options,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type {
  ClaudeAuxiliaryQueryPort,
  ClaudeExecutionScheduler,
} from './ClaudeExecutionBackend';
import type { ClaudeSdkQueryFunction } from './ClaudeSdkExecutionAdapter';

export interface ClaudeAuxiliaryInvocation {
  readonly prompt: string | AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}

export interface ClaudeAuxiliaryRequestResolver {
  resolve(requestRef: string, signal: AbortSignal): Promise<ClaudeAuxiliaryInvocation>;
}

/** A cold, single-purpose SDK query that never touches the conversation query. */
export class ClaudeAuxiliaryQuery implements ClaudeAuxiliaryQueryPort {
  constructor(
    private readonly resolver: ClaudeAuxiliaryRequestResolver,
    private readonly maxResultBytes: number,
    private readonly queryFunction: ClaudeSdkQueryFunction,
    private readonly scheduler: ClaudeExecutionScheduler,
    private readonly timeoutMs = 30_000,
    private readonly controlTimeoutMs = 2_000,
  ) {
    if (!Number.isFinite(maxResultBytes) || maxResultBytes <= 0) {
      throw new Error('Claude auxiliary result byte limit must be positive.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0
      || !Number.isFinite(controlTimeoutMs) || controlTimeoutMs <= 0) {
      throw new Error('Claude auxiliary query timeouts must be positive.');
    }
  }

  async execute(requestRef: string, signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const invocation = await raceAbort(this.resolver.resolve(requestRef, signal), signal);
    throwIfAborted(signal);
    const abortController = new AbortController();
    const forwardAbort = () => abortController.abort(signal.reason);
    signal.addEventListener('abort', forwardAbort, { once: true });
    const query = this.queryFunction({
      prompt: invocation.prompt,
      options: { ...invocation.options, abortController },
    });
    let closed = false;
    const closeQuery = () => {
      if (!closed) {
        closed = true;
        query.close();
      }
    };
    const closeOnAbort = () => closeQuery();
    abortController.signal.addEventListener('abort', closeOnAbort, { once: true });
    const timeout = this.scheduler.setTimeout(() => {
      abortController.abort(new Error('Claude auxiliary query timed out.'));
    }, this.timeoutMs);
    try {
      return await raceAbort(this.consume(query), abortController.signal);
    } finally {
      this.scheduler.clearTimeout(timeout);
      signal.removeEventListener('abort', forwardAbort);
      abortController.signal.removeEventListener('abort', closeOnAbort);
      closeQuery();
    }
  }

  private async consume(query: ReturnType<ClaudeSdkQueryFunction>): Promise<string> {
    for await (const message of query) {
      if (message.type !== 'result') {
        continue;
      }
      if (message.subtype !== 'success' || message.is_error) {
        throw new Error('Claude auxiliary query failed.');
      }
      if (Buffer.byteLength(message.result, 'utf8') > this.maxResultBytes) {
        await withTimeout(query.interrupt(), this.scheduler, this.controlTimeoutMs);
        throw new Error('Claude auxiliary result exceeds the configured byte limit.');
      }
      return message.result;
    }
    throw new Error('Claude auxiliary query ended without a result.');
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.');
  }
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.'),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      value => { cleanup(); resolve(value); },
      error => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Claude auxiliary query failed.'));
      },
    );
  });
}

function withTimeout<T>(
  operation: Promise<T>,
  scheduler: ClaudeExecutionScheduler,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T | undefined) => {
      if (settled) return;
      settled = true;
      scheduler.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = scheduler.setTimeout(() => finish(undefined), timeoutMs);
    void operation.then(value => finish(value), () => finish(undefined));
  });
}
