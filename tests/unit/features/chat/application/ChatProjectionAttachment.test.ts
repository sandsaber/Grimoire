import {
  ChatProjectionAttachment,
  type ChatProjectionSource,
} from '@/features/chat/application/ChatProjectionAttachment';
import type { ChatProjection } from '@/features/chat/projections/ChatProjection';

describe('ChatProjectionAttachment', () => {
  it('owns only draft, scroll, selection, and a detachable projection reference', async () => {
    const source = new FakeProjectionSource();
    const attachment = new ChatProjectionAttachment(source, 'conversation-1');

    attachment.setDraft('draft');
    attachment.setScroll(42, false);
    attachment.setSelection({ source: 'editor', reference: 'selection-1' });
    await attachment.attach();
    source.publish(projection());

    expect(attachment.getState()).toMatchObject({
      conversationId: 'conversation-1',
      draft: 'draft',
      scrollTop: 42,
      autoFollow: false,
      selection: { source: 'editor', reference: 'selection-1' },
      projection: { conversationId: 'conversation-1' },
    });

    attachment.detach();
    expect(source.detachCount).toBe(1);
    expect(attachment.getState().projection).toBeUndefined();
    expect(attachment.getState().draft).toBe('draft');
  });

  it('coalesces concurrent attachment attempts into one subscription', async () => {
    const source = new DelayedProjectionSource();
    const attachment = new ChatProjectionAttachment(source, 'conversation-1');

    const first = attachment.attach();
    const second = attachment.attach();
    expect(source.attachCount).toBe(1);
    source.resolve();
    await Promise.all([first, second]);
    attachment.detach();

    expect(source.detachCount).toBe(1);
  });

  it('fences a late attach result after the view already detached', async () => {
    const source = new DelayedProjectionSource();
    const attachment = new ChatProjectionAttachment(source, 'conversation-1');

    const attaching = attachment.attach();
    attachment.detach();
    source.publish(projection());
    source.resolve();
    await attaching;
    source.publish(projection());

    expect(source.detachCount).toBe(1);
    expect(attachment.getState().projection).toBeUndefined();
  });
});

class FakeProjectionSource implements ChatProjectionSource {
  private listener?: (projection: ChatProjection) => void;
  detachCount = 0;

  async attach(
    _conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void> {
    this.listener = listener;
    return () => {
      this.listener = undefined;
      this.detachCount += 1;
    };
  }

  publish(value: ChatProjection): void {
    this.listener?.(value);
  }
}

class DelayedProjectionSource implements ChatProjectionSource {
  private listener?: (projection: ChatProjection) => void;
  private resolveAttach: (detach: () => void) => void = () => undefined;
  attachCount = 0;
  detachCount = 0;

  attach(
    _conversationId: string,
    listener: (projection: ChatProjection) => void,
  ): Promise<() => void> {
    this.attachCount += 1;
    this.listener = listener;
    return new Promise(resolve => {
      this.resolveAttach = resolve;
    });
  }

  resolve(): void {
    this.resolveAttach(() => {
      this.listener = undefined;
      this.detachCount += 1;
    });
  }

  publish(value: ChatProjection): void {
    this.listener?.(value);
  }
}

function projection(): ChatProjection {
  return {
    conversationId: 'conversation-1',
    providerId: 'provider-1',
    title: 'Projection',
    conversationRevision: 1,
    messages: [],
    turns: [],
    interactions: [],
    queuedCommandIds: [],
  };
}
