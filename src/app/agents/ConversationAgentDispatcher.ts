import type {
  AgentDispatchOutcome,
  AgentDispatchPort,
  AgentDispatchRequest,
} from '@/core/agents/AgentContracts';
import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
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
 * conversation the run names. On a first dispatch that conversation is empty
 * and the caller supplies the text, which the turn itself persists as its first
 * user message; on a retry the message is already there and is read back. No
 * second store, no retention rule, and no redaction question.
 *
 * **Two conversations, and the run says which is which (D10).** `conversationId`
 * is the one this writes into, because a conversation runs one turn at a time
 * and two dispatched workers cannot share one. `rootOwner` is the one a person
 * is looking at, so the background work card — which looks up by the
 * conversation a tab is showing — lists the workers that conversation started.
 * A run that names no conversation of its own writes into its owner's, which is
 * the single-conversation case and the simpler one.
 */

export interface ConversationAgentDispatcherOptions {
  readonly chat: Pick<ChatExecutionComposition, 'submitTurn'>;
  readonly conversations: Pick<ChatConversationPort, 'read'>;
  /** A provider adapter with no tab behind it. `ApplicationRuntime` builds these. */
  createRuntime(providerId: ProviderId): ExecutionChatRuntimeAdapter | null;
  nextCommandId(): string;
  /** The backend a dispatched turn runs on, per provider. */
  backendIdFor(providerId: ProviderId): ExecutionBackendId | null;
}

export class ConversationAgentDispatcher implements AgentDispatchPort {
  /**
   * What a run was asked to do, until its conversation holds it.
   *
   * **Needed for one window and no longer.** A first dispatch writes into a
   * conversation that is still empty, so the words have to come from whoever
   * asked; every attempt after that reads them back from the vault, which is
   * the copy that survives a reload. Entries are dropped as soon as the turn is
   * submitted, so this holds at most the plan currently being started.
   *
   * A reload inside that window leaves a dispatch intent in `prepared` with no
   * remembered goal, and this refuses rather than inventing a task — which is
   * the correct answer: an intent whose fate is unknown is what the dispatch
   * recovery port settles, and a fabricated prompt would make it known and
   * wrong.
   */
  private readonly remembered = new Map<string, string>();

  constructor(private readonly options: ConversationAgentDispatcherOptions) {}

  /** Tells this what a run it is about to dispatch was asked to do. */
  rememberGoal(agentRunId: string, goal: string): void {
    this.remembered.set(agentRunId, goal);
  }

  async dispatch(request: AgentDispatchRequest): Promise<AgentDispatchOutcome> {
    // Every refusal below is `sideEffectFree: true` and every one of them is
    // reached before `submitTurn`. That is the contract's own rule and it is
    // load-bearing: the coordinator files a rejection as `invalidated`, which
    // says the run never reached the provider, and saying that after a turn had
    // been dispatched would be a durable claim nobody could support.
    const conversationId = request.conversationId
      ?? (request.rootOwner.kind === 'conversation' ? request.rootOwner.ownerId : null);
    if (!conversationId) {
      return rejected('dispatch.no-conversation-to-write-into');
    }
    const read = await this.options.conversations.read(conversationId);
    if (read.kind !== 'present') {
      return rejected(read.kind === 'absent'
        ? 'dispatch.conversation-absent'
        : `dispatch.conversation-${read.reason}`);
    }
    // **The stored message is read for its text and not resubmitted.** A
    // provider composes what a turn actually persists — three of the nine
    // replace it outright, two rewrite it — so handing back the message this
    // conversation already holds would append a *different* object under an id
    // it already has, which the coordinator refuses as a caller bug. It is
    // right to refuse: what it protects is that a stored message is what was
    // sent. So the goal travels as text, and the turn writes its own message.
    const stored = read.conversation.messages.find(message => message.role === 'user');
    const goal = stored?.content ?? this.remembered.get(request.agentRunId) ?? null;
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
      const submitted = await this.submit(request, conversationId, backendId, runtime, goal);
      const started = await submitted.ticket.started;
      // The conversation holds the goal now, so the caller's copy is spent:
      // every later attempt on this run reads it back from the vault, which is
      // the copy that survives a reload.
      this.remembered.delete(request.agentRunId);
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
  ): Promise<SubmittedChatTurn> {
    return this.options.chat.submitTurn({
      commandId: this.options.nextCommandId(),
      conversationId,
      backendId,
      encoder: runtime.turnEncoder,
      request: { text: goal },
      // Derived from the run, so a redispatch of the same run submits the same
      // message rather than a second one: the coordinator's append is
      // idempotent by id, and the content is whatever the provider composed
      // both times because it is the same provider and the same text.
      userMessage: {
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
