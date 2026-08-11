import type { AcpSessionNotification } from '@/providers/acp/types';

import type {
  GeminiExecutionScheduler,
  GeminiHistoryReplayPort,
} from './GeminiExecutionBackend';

export interface GeminiHistoryReplayExpectationResolver {
  count(input: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  }): Promise<number>;
}

interface ReplayState {
  abortListener: () => void;
  error?: Error;
  loadResponseObserved: boolean;
  reject?: (error: Error) => void;
  remaining?: number;
  removeAbort: () => void;
  resolve?: () => void;
  settleTask?: Promise<void>;
  timeoutHandle: unknown;
}

export class GeminiHistoryReplayInventoryUnavailableError extends Error {
  constructor() {
    super('Gemini native history replay inventory is unavailable.');
    this.name = 'GeminiHistoryReplayInventoryUnavailableError';
  }
}

const GEMINI_HISTORY_UPDATE_KINDS = new Set([
  'user_message_chunk',
  'agent_thought_chunk',
  'agent_message_chunk',
  'tool_call',
]);

/**
 * Gemini replays saved transcript entries during `session/load` without a completion marker.
 * The provider-owned resolver supplies the exact expected notification count from native history;
 * the fence consumes that many notifications and fails closed on missing or additional entries.
 */
export class GeminiHistoryReplayFence implements GeminiHistoryReplayPort {
  private readonly states = new Map<string, ReplayState>();

  constructor(
    private readonly expectations: GeminiHistoryReplayExpectationResolver,
    private readonly scheduler: GeminiExecutionScheduler,
    private readonly timeoutMs: number,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Gemini history replay bound is invalid.');
    }
  }

  async begin(input: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    this.clear(input.sessionId);
    throwIfAborted(input.signal);
    let expected: number | undefined;
    try {
      expected = await this.expectations.count(input);
    } catch (error) {
      if (!(error instanceof GeminiHistoryReplayInventoryUnavailableError)) throw error;
    }
    throwIfAborted(input.signal);
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0)) {
      throw new Error('Gemini history replay inventory is invalid.');
    }

    const state = {} as ReplayState;
    state.remaining = expected;
    state.loadResponseObserved = false;
    state.abortListener = () => this.fail(
      input.sessionId,
      state,
      input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error('Gemini history replay was aborted.'),
    );
    input.signal.addEventListener('abort', state.abortListener, { once: true });
    state.removeAbort = () => input.signal.removeEventListener('abort', state.abortListener);
    state.timeoutHandle = this.scheduler.setTimeout(() => {
      this.fail(
        input.sessionId,
        state,
        new Error('Gemini history replay did not match its native inventory.'),
      );
    }, this.timeoutMs);
    this.states.set(input.sessionId, state);
  }

  observe(notification: AcpSessionNotification): boolean {
    const state = this.states.get(notification.sessionId);
    if (!state) return false;
    if (isGeminiHistoryNotification(notification)) {
      if (state.remaining === undefined) return true;
      if (state.remaining === 0) {
        this.fail(
          notification.sessionId,
          state,
          new Error('Gemini history replay exceeded its native inventory.'),
        );
      } else {
        state.remaining -= 1;
        if (state.loadResponseObserved && state.remaining === 0) {
          this.finish(notification.sessionId, state);
        }
      }
    }
    return true;
  }

  settle(input: { readonly sessionId: string; readonly signal: AbortSignal }): Promise<void> {
    const state = this.states.get(input.sessionId);
    if (!state) return Promise.reject(new Error('Gemini history replay was not prepared.'));
    if (state.settleTask) return state.settleTask;
    state.loadResponseObserved = true;
    state.settleTask = new Promise<void>((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
    if (state.remaining === undefined) {
      this.finish(
        input.sessionId,
        state,
        new GeminiHistoryReplayInventoryUnavailableError(),
      );
    } else if (state.error) this.finish(input.sessionId, state, state.error);
    else if (state.remaining === 0) this.finish(input.sessionId, state);
    return state.settleTask;
  }

  clear(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    this.finish(sessionId, state, new Error('Gemini history replay was cleared.'));
  }

  private fail(sessionId: string, state: ReplayState, error: Error): void {
    if (this.states.get(sessionId) !== state || state.error) return;
    state.error = error;
    if (state.loadResponseObserved) this.finish(sessionId, state, error);
  }

  private finish(sessionId: string, state: ReplayState, error?: Error): void {
    if (this.states.get(sessionId) !== state) return;
    this.states.delete(sessionId);
    this.scheduler.clearTimeout(state.timeoutHandle);
    state.removeAbort();
    if (error) state.reject?.(error);
    else state.resolve?.();
  }
}

function isGeminiHistoryNotification(notification: AcpSessionNotification): boolean {
  return GEMINI_HISTORY_UPDATE_KINDS.has(notification.update.sessionUpdate);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Gemini history replay was aborted.');
}
