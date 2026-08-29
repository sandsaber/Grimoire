import { createMockEl } from '@test/helpers/mockElement';

import { MessageQueue } from '@/features/chat/queue/MessageQueue';
import type { QueuedMessage } from '@/features/chat/state/types';
import { renderQueueIndicator } from '@/features/chat/ui/QueueIndicator';

function createMessage(content: string): QueuedMessage {
  return {
    content,
    editorContext: null,
    browserContext: null,
    canvasContext: null,
  };
}

function render(
  queue: MessageQueue,
  overrides: Partial<Parameters<typeof renderQueueIndicator>[0]> = {},
) {
  const containerEl = createMockEl();
  const callbacks = {
    onSteerHead: jest.fn(),
    onEdit: jest.fn(),
    onRemove: jest.fn(),
    onResume: jest.fn(),
    onClearAll: jest.fn(),
  };
  renderQueueIndicator({
    containerEl,
    queue,
    pendingSteerMessage: null,
    canSteer: false,
    steerInFlight: false,
    callbacks,
    ...overrides,
  });
  return { callbacks, containerEl };
}

describe('QueueIndicator', () => {
  it('renders no header for a single queued message', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('only one'));

    const { containerEl } = render(queue);

    expect(containerEl.querySelector('.grimoire-queue-indicator-header')).toBeNull();
    expect(containerEl.querySelectorAll('.grimoire-queue-indicator-item')).toHaveLength(1);
  });

  it('renders a header and one row per message when several are queued', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('first'));
    queue.enqueue(createMessage('second'));
    queue.enqueue(createMessage('third'));

    const { containerEl } = render(queue);

    expect(containerEl.querySelector('.grimoire-queue-indicator-header')).not.toBeNull();
    expect(containerEl.querySelectorAll('.grimoire-queue-indicator-item')).toHaveLength(3);
  });

  it('offers steer on the first row only', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('first'));
    queue.enqueue(createMessage('second'));

    const { containerEl } = render(queue, { canSteer: true });
    const rows = containerEl.querySelectorAll('.grimoire-queue-indicator-item');

    expect(rows[0].querySelector('.grimoire-queue-indicator-action')).not.toBeNull();
    expect(rows[1].querySelector('.grimoire-queue-indicator-action')).toBeNull();
  });

  it('announces a steer in flight above the list, not on the row behind it', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('the message behind the steer'));

    const { containerEl } = render(queue, {
      canSteer: true,
      pendingSteerMessage: createMessage('the steered one'),
      steerInFlight: true,
    });

    // The steered message has already left the queue, so row 0 is a different
    // message and must not wear its label.
    const texts = Array.from(containerEl.querySelectorAll('.grimoire-queue-indicator-text'))
      .map((el: any) => el.textContent as string);
    expect(texts.some(text => text.includes('Steering: the steered one'))).toBe(true);

    const rows = containerEl.querySelectorAll('.grimoire-queue-indicator-item');
    expect(rows[0].querySelector('.grimoire-queue-indicator-text')?.textContent)
      .toContain('the message behind the steer');
    // The steer button belongs to a head that is no longer the steered message.
    expect(rows[0].querySelector('.grimoire-queue-indicator-action')).toBeNull();
  });

  it('removes the row the user pointed at, not the head', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('first'));
    queue.enqueue(createMessage('second'));

    const { callbacks, containerEl } = render(queue);
    const rows = containerEl.querySelectorAll('.grimoire-queue-indicator-item');
    rows[1].querySelectorAll('.grimoire-queue-indicator-icon-action')[1].click();

    expect(callbacks.onRemove).toHaveBeenCalledWith(1);
    expect(callbacks.onRemove).not.toHaveBeenCalledWith(0);
  });

  it('edits the row the user pointed at', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('first'));
    queue.enqueue(createMessage('second'));

    const { callbacks, containerEl } = render(queue);
    const rows = containerEl.querySelectorAll('.grimoire-queue-indicator-item');
    rows[1].querySelectorAll('.grimoire-queue-indicator-icon-action')[0].click();

    expect(callbacks.onEdit).toHaveBeenCalledWith(1);
  });

  it('shows a resume affordance while the queue is paused', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('held'));
    queue.pause('failed');

    const { callbacks, containerEl } = render(queue);
    const header = containerEl.querySelector('.grimoire-queue-indicator-header');
    expect(header).not.toBeNull();
    expect(header!.querySelector('.grimoire-queue-indicator-text')!.textContent)
      .toContain('error');

    header!.querySelectorAll('.grimoire-queue-indicator-action')[0].click();
    expect(callbacks.onResume).toHaveBeenCalled();
  });

  it('keeps a header for a single message once the queue is held', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('held'));
    queue.pause('cancelled');

    const { containerEl } = render(queue);

    expect(containerEl.querySelector('.grimoire-queue-indicator-header')).not.toBeNull();
  });

  it('hides itself when nothing is queued', () => {
    const { containerEl } = render(new MessageQueue());

    expect(containerEl.hasClass('grimoire-hidden')).toBe(true);
    expect(containerEl.querySelectorAll('.grimoire-queue-indicator-item')).toHaveLength(0);
  });
});
