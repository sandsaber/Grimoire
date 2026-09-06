import type { BoundConversation } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type {
  ThreadResumeParams,
  ThreadStartParams,
} from '../runtime/codexAppServerTypes';
import { getCodexState } from '../types';
import type { CodexThreadIntent } from './CodexExecutionBackend';

/**
 * What a conversation tells the next dispatch to do with a Codex thread.
 *
 * Three cases, and the order between them matters: a conversation carrying a
 * fork source has not started its own thread yet, so the fork must be taken
 * before anything reads `threadId`, or the fork would be silently downgraded
 * into a plain resume of the source and the rollback would never happen.
 */
export type CodexConversationBinding =
  | { readonly kind: 'none' }
  | { readonly kind: 'thread'; readonly threadId: string }
  | {
    readonly kind: 'fork';
    readonly sourceThreadId: string;
    readonly resumeAtTurnId: string;
  };

/**
 * Reads the binding the legacy runtime read, from the same two places.
 *
 * `sessionId` is the neutral column and `providerState.threadId` the provider's
 * own copy; they normally agree, and where they do not the provider's own is
 * the one Codex can act on.
 */
export function readCodexConversationBinding(
  conversation: BoundConversation | null,
): CodexConversationBinding {
  if (!conversation) {
    return { kind: 'none' };
  }
  const state = getCodexState(conversation.providerState);
  // A fork is pending only while the conversation has no thread of its own.
  // Once the fork has been taken, the new thread is the binding and the fork
  // source is history.
  if (state.forkSource && !state.threadId && !conversation.sessionId) {
    return {
      kind: 'fork',
      sourceThreadId: state.forkSource.sessionId,
      resumeAtTurnId: state.forkSource.resumeAt,
    };
  }
  const threadId = state.threadId ?? conversation.sessionId ?? null;
  return threadId ? { kind: 'thread', threadId } : { kind: 'none' };
}

/**
 * The intent the backend acts on, from the binding and the launch parameters.
 *
 * The backend decides for itself whether a bound thread still needs resuming —
 * it tracks which thread this session already loaded — so this states what the
 * conversation is, not what the daemon should be asked. Reproducing the legacy
 * runtime's "already loaded, just start a turn" branch here would be a second
 * opinion about state the backend owns.
 */
export function toCodexThreadIntent(
  binding: CodexConversationBinding,
  params: {
    readonly start: ThreadStartParams;
    readonly resume: Omit<ThreadResumeParams, 'threadId'>;
  },
): CodexThreadIntent {
  if (binding.kind === 'fork') {
    return {
      kind: 'fork',
      sourceThreadId: binding.sourceThreadId,
      resumeAtTurnId: binding.resumeAtTurnId,
      resumeParams: params.resume,
    };
  }
  if (binding.kind === 'thread') {
    return { kind: 'resume', threadId: binding.threadId, params: params.resume };
  }
  return { kind: 'new', params: params.start };
}
