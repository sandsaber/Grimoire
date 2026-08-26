import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { CancellationReason } from '@/core/execution/ExecutionContracts';
import type { ChatTurnEncoder } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatRuntimeQueryOptions, ChatTurnRequest } from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import type { ProviderId } from '@/core/types/provider';
import type { ChatProjectionAttachment } from '@/features/chat/application/ChatProjectionAttachment';

import type {
  ChatExecutionComposition,
  ChatSurfaceBinding,
  SubmittedChatTurn,
} from './ChatExecutionComposition';

/**
 * One tab's end of the chat execution path.
 *
 * What a call site needs and what nothing else can hold: a tab's attachment,
 * the conversation it is showing, and the provider identity its turns go out
 * under. The composition owns everything that must be the same for every tab;
 * this owns the three things that must not be.
 *
 * **A blank tab has no conversation, and a turn needs one.** The legacy path
 * creates one lazily — the first user message triggers it — and so does this,
 * for the same reason and slightly earlier: the durable record has to exist
 * before the run does, or a crash mid-turn leaves a run belonging to a
 * conversation nobody can open.
 *
 * Built for a tab whose provider is on the projection path, and rebuilt when
 * that provider changes.
 */

export interface ChatTabExecutionOptions {
  readonly composition: ChatExecutionComposition;
  /** The provider this was built for. A tab that changes provider needs a new one. */
  readonly providerId: ProviderId;
  readonly backendId: ExecutionBackendId;
  readonly surface: ChatSurfaceBinding;
  /**
   * The tab's provider steps from a message to a turn.
   *
   * Read late and allowed to be absent: a cold tab has no runtime until it
   * first sends, which is the same lifetime the encoder has.
   */
  turnEncoder(): ChatTurnEncoder | null;
  /** Creates the conversation this tab writes into, on the first send. */
  createConversation(): Promise<string>;
  nextCommandId(): string;
}

export class ChatTabExecution {
  private readonly attachment: ChatProjectionAttachment;
  private bound: string | null = null;

  constructor(private readonly options: ChatTabExecutionOptions) {
    this.attachment = options.composition.bindSurface(options.surface);
  }

  /** The conversation this tab is showing, or `null` while it is blank. */
  get conversationId(): string | null {
    return this.bound;
  }

  /**
   * The provider this was built for.
   *
   * A tab's provider is not fixed — a blank tab derives it from the model that
   * is picked, and a bound one changes with the conversation — so whoever holds
   * this has to notice when it no longer matches and build another. Which
   * provider a tab is on is the whole of what decides whether it takes this
   * path at all.
   */
  get providerId(): ProviderId {
    return this.options.providerId;
  }

  async open(conversationId: string): Promise<void> {
    this.bound = conversationId;
    await this.attachment.open(conversationId, this.options.composition.coordinator);
  }

  async send(
    request: ChatTurnRequest,
    userMessage: ChatMessage,
    options: {
      readonly queryOptions?: ChatRuntimeQueryOptions;
      readonly nativeSessionRef?: string;
      readonly resumeCheckpoint?: string;
    } = {},
  ): Promise<SubmittedChatTurn> {
    const encoder = this.options.turnEncoder();
    if (!encoder) {
      // Refused rather than defaulted: without the provider's own encoding
      // there is no reference a backend can resolve, and a turn dispatched
      // with a guessed one fails inside the provider with nothing to explain
      // it.
      throw new Error('This tab has no provider runtime to encode a turn with.');
    }
    const conversationId = this.bound ?? await this.openCreated();
    return this.options.composition.submitTurn({
      commandId: this.options.nextCommandId(),
      conversationId,
      backendId: this.options.backendId,
      encoder,
      request,
      userMessage,
      ...(options.queryOptions ? { queryOptions: options.queryOptions } : {}),
      ...(options.nativeSessionRef ? { nativeSessionRef: options.nativeSessionRef } : {}),
      ...(options.resumeCheckpoint ? { resumeCheckpoint: options.resumeCheckpoint } : {}),
    });
  }

  /**
   * Resolves when the column has drawn everything this turn produced.
   *
   * Awaited before the work that runs *after* a turn — the duration footer, the
   * finalizations the surface does itself — because that work is against the
   * same column and following is not the same as interleaving.
   */
  settled(): Promise<void> {
    return this.attachment.settled();
  }

  async cancel(reason?: CancellationReason): Promise<void> {
    if (!this.bound) {
      return;
    }
    await this.options.composition.coordinator.cancelActive(
      this.bound,
      ...(reason ? [reason] as const : []),
    );
  }

  detach(): void {
    this.attachment.detach();
    this.bound = null;
  }

  private async openCreated(): Promise<string> {
    const conversationId = await this.options.createConversation();
    await this.open(conversationId);
    return conversationId;
  }
}
