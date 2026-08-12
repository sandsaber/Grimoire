import type { ExecutionLifecycleRegistry } from '../../core/execution/ExecutionLifecycleRegistry';
import type { ConversationRepository } from '../../core/persistence/ConversationRepository';
import {
  ChatExecutionCoordinator,
  type ChatExecutionLifecyclePort,
  type ChatExecutionRequestPort,
} from '../../features/chat/application/ChatExecutionCoordinator';
import type { ApplicationExecutionRequestBroker } from './ApplicationExecutionRequestBroker';
import type { ApplicationIdentityFactory } from './ApplicationIdentityFactory';
import type { DurableExecutionResultStore } from './DurableExecutionResultStore';

export interface ChatRuntimeWiringOptions {
  readonly lifecycle: ExecutionLifecycleRegistry;
  readonly conversations: ConversationRepository;
  readonly results: DurableExecutionResultStore;
  readonly identities: ApplicationIdentityFactory;
  readonly requests?: ApplicationExecutionRequestBroker;
  readonly now?: () => number;
}

/**
 * Production composition of the chat execution coordinator from the lifecycle
 * registry, conversation repository, result store, and identity factory.
 */
export function createChatExecutionCoordinator(
  options: ChatRuntimeWiringOptions,
): ChatExecutionCoordinator {
  const lifecycle: ChatExecutionLifecyclePort = options.lifecycle;
  const requests: ChatExecutionRequestPort | undefined = options.requests
    ? { forget: requestRef => options.requests!.forget(requestRef) }
    : undefined;
  return new ChatExecutionCoordinator({
    lifecycle,
    conversations: {
      read: recordId => options.conversations.read(recordId),
      update: (recordId, expectedRevision, mutation) => options.conversations.update(
        recordId,
        expectedRevision,
        mutation,
      ),
    },
    results: { materialize: resultRef => options.results.materialize(resultRef) },
    nextExecutionSessionId: () => options.identities.nextExecutionSessionId(),
    nextRunId: () => options.identities.nextRunId(),
    nextLeaseId: () => options.identities.nextLeaseId(),
    assistantMessageIdForRun: runId => `msg-${runId}`,
    ...(requests ? { requests } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
