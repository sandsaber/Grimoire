import type {
  AgentDispatchOutcome,
  AgentDispatchPort,
  AgentDispatchRequest,
} from '@/core/agents/AgentContracts';
import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage } from '@/core/types';
import type { ProviderId } from '@/core/types/provider';
import type { ChatConversationPort } from '@/features/chat/application/ChatExecutionCoordinator';

import type {
  ChatExecutionComposition,
  SubmittedChatTurn,
} from '../chat/ChatExecutionComposition';

/**
 * Starting an agent, rather than noticing one a provider started.
 *
 * **The first implementation of `AgentDispatchPort`, and the whole of what the
 * worker-tab row was waiting for.** The agent domain could adopt an agent a
 * provider had launched and record what it did; it could not launch one. Every
 * route to a chat turn ran through a tab — its encoder, its adapter, its
 * column — so "a worker without a tab" had nowhere to run.
 *
 * It has one now, and the reason it is short is that nothing new was needed:
 * `ApplicationRuntime.createRuntimeFor` already builds a provider adapter with
 * no tab in it, a tab was only ever one holder of one, and the persistence
 * barrier already runs whether or not a surface is attached. A dispatched turn
 * is an ordinary turn with nobody drawing it.
 *
 * **Where the goal lives, which was the design question.** A control record may
 * hold references and not free text, and a task description is free text
 * somebody wrote — so the words live where free text already lives, in the
 * conversation, and `rootOwner` is how this finds them. On a first dispatch the
 * conversation is empty and the caller supplies the text, which the turn itself
 * persists as that conversation's first user message; on a retry the message is
 * already there and is read back. No second store, no retention rule, and no
 * redaction question.
 */

export interface ConversationAgentDispatcherOptions {
  readonly chat: Pick<ChatExecutionComposition, 'submitTurn'>;
  readonly conversations: Pick<ChatConversationPort, 'read'>;
  /** A provider adapter with no tab behind it. `ApplicationRuntime` builds these. */
  createRuntime(providerId: ProviderId): ExecutionChatRuntimeAdapter | null;
  /**
   * What this run was asked to do, from whoever asked for it.
   *
   * Read only when the conversation has no first message of its own — which is
   * a first dispatch. A caller that has forgotten (a reload between preparing
   * an intent and dispatching it) answers `null`, and this refuses rather than
   * inventing a task: the dispatch recovery port is what settles an intent
   * whose fate is unknown, and a fabricated prompt would make it known and
   * wrong.
   */
  goalFor(request: AgentDispatchRequest): string | null;
  nextCommandId(): string;
  /** The backend a dispatched turn runs on, per provider. */
  backendIdFor(providerId: ProviderId): ExecutionBackendId | null;
}

export class ConversationAgentDispatcher implements AgentDispatchPort {
  constructor(private readonly options: ConversationAgentDispatcherOptions) {}

  async dispatch(request: AgentDispatchRequest): Promise<AgentDispatchOutcome> {
    // Every refusal below is `sideEffectFree: true` and every one of them is
    // reached before `submitTurn`. That is the contract's own rule and it is
    // load-bearing: the coordinator files a rejection as `invalidated`, which
    // says the run never reached the provider, and saying that after a turn had
    // been dispatched would be a durable claim nobody could support.
    if (request.rootOwner.kind !== 'conversation') {
      return rejected('dispatch.owner-not-a-conversation');
    }
    const conversationId = request.rootOwner.ownerId;
    const read = await this.options.conversations.read(conversationId);
    if (read.kind !== 'present') {
      return rejected(read.kind === 'absent'
        ? 'dispatch.conversation-absent'
        : `dispatch.conversation-${read.reason}`);
    }
    const stored = read.conversation.messages.find(message => message.role === 'user');
    const goal = stored?.content ?? this.options.goalFor(request);
    if (!goal?.trim()) {
      return rejected('dispatch.no-goal-recorded');
    }
    const backendId = this.options.backendIdFor(request.providerId);
    if (!backendId) {
      return rejected('dispatch.provider-not-composed');
    }
    const runtime = this.options.createRuntime(request.providerId);
    if (!runtime) {
      return rejected('dispatch.provider-not-composed');
    }

    try {
      // Bound before anything is encoded: a provider resolves its session, its
      // paths and its history against the conversation it is told it is on, and
      // an adapter told nothing answers for whichever conversation it saw last.
      runtime.syncConversationState(read.conversation);
      const submitted = await this.submit(request, conversationId, backendId, runtime, goal, stored);
      const started = await submitted.ticket.started;
      return {
        kind: 'accepted',
        execution: {
          executionSessionId: started.executionSessionId,
          executionRunId: started.runId,
        },
      };
    } catch {
      // **Not a rejection.** `submitTurn` may have reached the provider before
      // it threw, and the contract reserves `rejected` for a refusal that
      // provably made no side effect. Throwing is how the coordinator records
      // `indeterminate`, which is what an unknown fate is called.
      throw new Error('Agent dispatch did not establish an outcome.');
    }
  }

  private submit(
    request: AgentDispatchRequest,
    conversationId: string,
    backendId: ExecutionBackendId,
    runtime: ExecutionChatRuntimeAdapter,
    goal: string,
    stored: ChatMessage | undefined,
  ): Promise<SubmittedChatTurn> {
    return this.options.chat.submitTurn({
      commandId: this.options.nextCommandId(),
      conversationId,
      backendId,
      encoder: runtime.turnEncoder,
      request: { text: goal },
      // Derived from the run, so a redispatch of the same run submits the same
      // message rather than a second one: the coordinator's append is
      // idempotent by id and refuses a different message under an id it holds.
      userMessage: stored ?? {
        id: `user-${request.agentRunId}`,
        role: 'user',
        content: goal,
        timestamp: Date.now(),
      },
      // The session this conversation is already on, where it has one. A worker
      // resuming its own thread is the same question a tab asks.
      ...(runtime.getSessionId() ? { nativeSessionRef: runtime.getSessionId() as string } : {}),
    });
  }
}

function rejected(code: string): AgentDispatchOutcome {
  return { kind: 'rejected', code, sideEffectFree: true };
}
