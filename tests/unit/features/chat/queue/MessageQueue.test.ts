import { MessageQueue } from '@/features/chat/queue/MessageQueue';
import type { QueuedMessage } from '@/features/chat/state/types';

function createMessage(content: string, notePath?: string): QueuedMessage {
  return {
    content,
    editorContext: null,
    browserContext: null,
    canvasContext: null,
    turnRequest: {
      text: content,
      currentNotePath: notePath,
      editorSelection: null,
      browserSelection: null,
      canvasSelection: null,
    },
  };
}

describe('MessageQueue ordering', () => {
  it('hands messages back in the order they arrived', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('first'));
    queue.enqueue(createMessage('second'));
    queue.enqueue(createMessage('third'));

    expect(queue.size).toBe(3);
    expect(queue.dequeue()?.content).toBe('first');
    expect(queue.dequeue()?.content).toBe('second');
    expect(queue.dequeue()?.content).toBe('third');
    expect(queue.dequeue()).toBeNull();
  });

  it('keeps each message on its own note instead of collapsing them', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('about A', 'notes/A.md'));
    queue.enqueue(createMessage('about B', 'notes/B.md'));

    expect(queue.items[0].turnRequest?.currentNotePath).toBe('notes/A.md');
    expect(queue.items[1].turnRequest?.currentNotePath).toBe('notes/B.md');
    expect(queue.items[0].content).toBe('about A');
  });

  it('returns a failed steer to the head, not the tail', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('second'));
    queue.unshift(createMessage('first'));

    expect(queue.items.map(item => item.content)).toEqual(['first', 'second']);
  });

  it('removes by index and hands the message back', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('a'));
    queue.enqueue(createMessage('b'));
    queue.enqueue(createMessage('c'));

    expect(queue.remove(1)?.content).toBe('b');
    expect(queue.items.map(item => item.content)).toEqual(['a', 'c']);
    expect(queue.remove(9)).toBeNull();
    expect(queue.remove(-1)).toBeNull();
  });

  it('inserts at a specific position, shifting later entries', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('a'));
    queue.enqueue(createMessage('b'));
    queue.enqueue(createMessage('c'));

    queue.insertAt(1, createMessage('X'));
    expect(queue.items.map(item => item.content)).toEqual(['a', 'X', 'b', 'c']);

    // insertAt at the end is equivalent to enqueue
    queue.insertAt(99, createMessage('Z'));
    expect(queue.items.map(item => item.content)).toEqual(['a', 'X', 'b', 'c', 'Z']);

    // insertAt at 0 prepends
    queue.insertAt(0, createMessage('W'));
    expect(queue.items.map(item => item.content)).toEqual(['W', 'a', 'X', 'b', 'c', 'Z']);
  });

  it('empties itself through takeAll', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('a'));
    queue.enqueue(createMessage('b'));

    expect(queue.takeAll().map(item => item.content)).toEqual(['a', 'b']);
    expect(queue.size).toBe(0);
    expect(queue.takeAll()).toEqual([]);
  });
});

describe('MessageQueue pausing', () => {
  it('starts unpaused and records why it stopped', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('a'));

    expect(queue.isPaused).toBe(false);
    queue.pause('failed');
    expect(queue.isPaused).toBe(true);
    expect(queue.pauseReason).toBe('failed');
  });

  it('clears the pause on an explicit resume', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('a'));
    queue.pause('cancelled');
    queue.resume();

    expect(queue.isPaused).toBe(false);
    expect(queue.pauseReason).toBeNull();
  });

  it('drops the pause once nothing is left to hold back', () => {
    const queue = new MessageQueue();
    queue.enqueue(createMessage('a'));
    queue.pause('failed');
    queue.remove(0);

    expect(queue.isPaused).toBe(false);
    expect(queue.pauseReason).toBeNull();
  });

  it('does not arm a pause on an empty queue', () => {
    const queue = new MessageQueue();
    queue.pause('failed');

    expect(queue.isPaused).toBe(false);
  });
});
