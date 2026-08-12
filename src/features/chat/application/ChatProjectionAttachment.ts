import type { ChatProjection } from '../projections/ChatProjection';

export interface ChatProjectionSource {
  attach(
    conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void>;
}

export interface ChatAttachmentSelection {
  readonly source: 'editor' | 'browser' | 'canvas';
  readonly reference: string;
}

export interface ChatAttachmentState {
  readonly conversationId: string;
  readonly draft: string;
  readonly scrollTop: number;
  readonly autoFollow: boolean;
  readonly selection?: ChatAttachmentSelection;
  readonly projection?: ChatProjection;
}

export class ChatProjectionAttachment {
  private state: ChatAttachmentState;
  private detachProjection?: () => void;
  private attachmentTask?: Promise<void>;
  private attachmentGeneration = 0;
  private readonly listeners = new Set<(state: ChatAttachmentState) => void>();

  constructor(
    private readonly source: ChatProjectionSource,
    conversationId: string,
  ) {
    this.state = {
      conversationId,
      draft: '',
      scrollTop: 0,
      autoFollow: true,
    };
  }

  async attach(): Promise<void> {
    if (this.detachProjection) return;
    if (this.attachmentTask) return this.attachmentTask;
    const generation = ++this.attachmentGeneration;
    const task = this.source.attach(
      this.state.conversationId,
      projection => {
        if (generation === this.attachmentGeneration) {
          this.update({ ...this.state, projection });
        }
      },
    ).then(detach => {
      if (generation !== this.attachmentGeneration) {
        detach();
        return;
      }
      this.detachProjection = detach;
    }).finally(() => {
      if (this.attachmentTask === task) this.attachmentTask = undefined;
    });
    this.attachmentTask = task;
    return task;
  }

  detach(): void {
    this.attachmentGeneration += 1;
    this.attachmentTask = undefined;
    this.detachProjection?.();
    this.detachProjection = undefined;
    if (this.state.projection) {
      const { projection: _projection, ...detached } = this.state;
      this.update(detached);
    }
  }

  getState(): ChatAttachmentState {
    return this.state;
  }

  setDraft(draft: string): void {
    this.update({ ...this.state, draft });
  }

  setScroll(scrollTop: number, autoFollow: boolean): void {
    this.update({ ...this.state, scrollTop, autoFollow });
  }

  setSelection(selection: ChatAttachmentSelection | undefined): void {
    this.update({
      ...this.state,
      ...(selection ? { selection } : { selection: undefined }),
    });
  }

  subscribe(listener: (state: ChatAttachmentState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(state: ChatAttachmentState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
