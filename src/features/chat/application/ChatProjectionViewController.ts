import type { ApplicationRuntime } from '@/app/runtime/ApplicationRuntime';

import type { ChatProjection } from '../projections/ChatProjection';
import type { ChatProjectionRenderer } from '../rendering/ChatProjectionRenderer';
import type { ChatExecutionCoordinator } from './ChatExecutionCoordinator';
import type { ChatInputCommand,ChatInputCommandAdapter } from './ChatInputCommandAdapter';
import type { ChatProjectionAttachment } from './ChatProjectionAttachment';

export interface ChatProjectionViewControllerOptions {
  readonly runtime: ApplicationRuntime;
  readonly conversationId: string;
  readonly inputAdapter: ChatInputCommandAdapter;
  readonly renderer: ChatProjectionRenderer;
}

/**
 * Projection-backed view controller replacing the legacy tab-owned chat runtime.
 * Owns a single conversation attachment, its input adapter, and its renderer.
 * The controller never creates, queries, cancels, or disposes execution resources
 * directly — it issues commands through the runtime and renders projections.
 */
export class ChatProjectionViewController {
  readonly attachment: ChatProjectionAttachment;
  private disposed = false;

  constructor(
    private readonly options: ChatProjectionViewControllerOptions,
    attachment: ChatProjectionAttachment,
  ) {
    this.attachment = attachment;
  }

  async load(): Promise<ChatProjection> {
    return this.options.runtime.loadConversation(this.options.conversationId);
  }

  async attach(): Promise<void> {
    await this.attachment.attach();
  }

  submitTurn(command: Omit<ChatInputCommand, 'conversationId'>): ReturnType<ChatInputCommandAdapter['submit']> {
    return this.options.inputAdapter.submit({
      ...command,
      conversationId: this.options.conversationId,
    });
  }

  cancelActive(): Promise<void> {
    return this.options.runtime.cancelChatTurn(this.options.conversationId);
  }

  render(projection: ChatProjection): void {
    this.options.renderer.render(projection);
  }

  detach(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attachment.detach();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

export type { ChatExecutionCoordinator };
