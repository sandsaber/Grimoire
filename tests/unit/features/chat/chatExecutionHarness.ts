import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ChatExecutionComposition } from '@/app/chat/ChatExecutionComposition';
import { ConversationRepository } from '@/core/conversations/ConversationRepository';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ExecutionControlRepositories } from '@/core/execution/ExecutionControlRepositories';
import { ExecutionControlTransactionCoordinator } from '@/core/execution/ExecutionControlTransactionCoordinator';
import {
  executionSessionId,
  lifecycleLeaseId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { DeterministicFakeBackend } from '@/core/execution/testing/DeterministicFakeBackend';
import type { ChatMessage, Conversation, SessionMetadata } from '@/core/types';
import {
  type ChatConversationPort,
  ChatExecutionCoordinator,
  type SubmitChatTurnCommand,
} from '@/features/chat/application/ChatExecutionCoordinator';

/**
 * The chat execution seam, composed the way production composes it.
 *
 * Shared because two suites need the same composition and a second copy of it
 * would drift: the coordinator's tests and the renderer's both need a real
 * registry, a real conversation store and a fake provider, and the point of
 * composing rather than stubbing is lost the moment the two disagree about what
 * "composed" means.
 */

export const INSTANCE_ID = sessionInstanceId(`si-${'1'.repeat(32)}`);
export const CONVERSATION_ID = 'conv-1';
export const FAKE_BACKEND_ID = executionBackendId('internal-deterministic-fake');

export interface Harness {
  readonly coordinator: ChatExecutionCoordinator;
  readonly registry: ExecutionLifecycleRegistry;
  readonly backend: DeterministicFakeBackend;
  readonly storage: TestDurableStorage;
  readonly conversations: ConversationRepository;
  /**
   * The production composition over the same kernel and vault.
   *
   * Built here rather than in the suites that need it, because it is the seam
   * a turn is actually submitted through — `submitTurn` is where the provider's
   * encoding happens and where the user message the vault holds is decided, and
   * a caller that reached past it to the coordinator would be testing a path no
   * surface takes.
   */
  readonly composition: ChatExecutionComposition;
  advance(milliseconds: number): void;
  /** A second coordinator over the same kernel and vault, as a reload gives. */
  createCoordinator(): ChatExecutionCoordinator;
}

export function opaque(prefix: string, ordinal: number): string {
  return `${prefix}-${ordinal.toString(16).padStart(32, '0')}`;
}

/**
 * The conversation as the store holds it, and as the chat surface reads it.
 *
 * The two shapes differ — a stored conversation's provider, messages and
 * session binding are all optional, because a vault in the field holds files
 * this build did not write. The projection this coordinator feeds is the chat
 * surface's shape, so the port is where the two meet. Only the fields a turn
 * touches are carried here — and `usage` is one of them, which a first version
 * of this left out: a mapping that drops a field a turn writes reads exactly
 * like a turn that does not write it. The plugin does the whole of it today.
 */
function toConversation(metadata: SessionMetadata): Conversation {
  return {
    id: metadata.id,
    providerId: metadata.providerId ?? 'claude',
    title: metadata.title,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...(metadata.lastResponseAt !== undefined
      ? { lastResponseAt: metadata.lastResponseAt }
      : {}),
    sessionId: metadata.sessionId ?? null,
    // **Carried, because the barrier writes it.** This projection is a local
    // stand-in for the vault's own, and dropping a field here makes a write the
    // production store keeps look like one nothing persists.
    ...(metadata.providerState ? { providerState: metadata.providerState } : {}),
    ...(metadata.usage ? { usage: metadata.usage } : {}),
    messages: metadata.messages ? [...metadata.messages] : [],
  };
}

function toMetadata(conversation: Conversation): SessionMetadata {
  return {
    id: conversation.id,
    providerId: conversation.providerId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...(conversation.lastResponseAt !== undefined
      ? { lastResponseAt: conversation.lastResponseAt }
      : {}),
    sessionId: conversation.sessionId,
    ...(conversation.providerState ? { providerState: conversation.providerState } : {}),
    ...(conversation.usage ? { usage: conversation.usage } : {}),
    messages: [...conversation.messages],
  };
}

export function conversationPort(repository: ConversationRepository): ChatConversationPort {
  return {
    async read(conversationId) {
      const read = await repository.read(conversationId);
      if (read.kind === 'absent') {
        return { kind: 'absent' };
      }
      if (read.kind === 'unreadable') {
        return { kind: 'unreadable', reason: read.reason, detail: read.detail };
      }
      return {
        kind: 'present',
        conversation: toConversation(read.metadata),
        revision: read.revision,
      };
    },
    async apply(conversationId, change) {
      const applied = await repository.apply(conversationId, current => (
        toMetadata(change(toConversation(current)))
      ));
      return { conversation: toConversation(applied.metadata), revision: applied.revision };
    },
  };
}

export async function createHarness(options: { readonly withRecovery?: boolean } = {}): Promise<Harness> {
  const storage = new TestDurableStorage();
  let clock = 1_000;
  const now = () => clock;
  let ordinal = 0;
  const repositories = new ExecutionControlRepositories(storage, now);
  const registry = new ExecutionLifecycleRegistry({
    repositories,
    controlTransactions: new ExecutionControlTransactionCoordinator(
      storage,
      repositories,
      { now },
    ),
    nextTransactionId: () => opaque('tx', ++ordinal),
    now,
    scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
  });
  const backend = new DeterministicFakeBackend({
    sessionInstanceIdFactory: () => INSTANCE_ID,
    now,
  });
  registry.registerBackend({
    backend,
    interactions: backend,
    // Left off by default so a recovery falls straight through to the terminal
    // the registry states itself, which is the case with no ingested envelope
    // behind it.
    ...(options.withRecovery ? { recovery: backend.nativeStatusRecovery } : {}),
  });
  await registry.start();

  const conversations = new ConversationRepository({ storage, now });
  await conversations.save({
    id: CONVERSATION_ID,
    providerId: 'claude',
    title: 'Tomatoes',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }, null);

  let sessionOrdinal = 0;
  let runOrdinal = 0;
  let leaseOrdinal = 0;
  const createCoordinator = () => new ChatExecutionCoordinator({
    lifecycle: registry,
    conversations: conversationPort(conversations),
    nextExecutionSessionId: () => executionSessionId(opaque('es', ++sessionOrdinal)),
    nextRunId: () => runId(opaque('run', ++runOrdinal)),
    nextLeaseId: () => lifecycleLeaseId(opaque('lease', ++leaseOrdinal)),
    assistantMessageIdForRun: forRunId => `assistant-${forRunId}`,
    now,
  });

  const coordinator = createCoordinator();
  return {
    coordinator,
    registry,
    backend,
    storage,
    conversations,
    composition: new ChatExecutionComposition({
      lifecycle: registry,
      conversations: conversationPort(conversations),
      now,
    }),
    createCoordinator,
    advance(milliseconds) {
      clock += milliseconds;
    },
  };
}

/** Waits for something the kernel drives, which no ticket is waiting on. */
export async function waitUntil(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

export function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, timestamp: 1 };
}

export function turnCommand(overrides: Partial<SubmitChatTurnCommand> = {}): SubmitChatTurnCommand {
  return {
    commandId: 'cmd-1',
    conversationId: CONVERSATION_ID,
    backendId: FAKE_BACKEND_ID,
    requestRef: 'req-1',
    resultExpectation: 'optional',
    userMessage: userMessage('msg-user-1', 'Are tomatoes a fruit?'),
    ...overrides,
  };
}

export async function storedMessages(harness: Harness): Promise<ChatMessage[]> {
  // Read through a store built over the same vault rather than the one that
  // wrote: what the file holds is the claim, and the writer's own cache cannot
  // be the witness for it.
  const reopened = new ConversationRepository({ storage: harness.storage });
  const read = await reopened.read(CONVERSATION_ID);
  return read.kind === 'present' ? read.metadata.messages ?? [] : [];
}

