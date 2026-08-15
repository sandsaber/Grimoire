import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Exact-message channel for lifecycle-owned SDK runs. The execution session
 * already enforces one active run, so queuing/merging would only risk changing
 * the durable user-message UUID used as the native run identity.
 */
export class ClaudeExecutionMessageChannel implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private readonly readers: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  enqueue(message: SDKUserMessage): void {
    if (this.closed) {
      throw new Error('Claude execution message channel is closed.');
    }
    const reader = this.readers.shift();
    if (reader) {
      reader({ value: message, done: false });
    } else {
      this.queue.push(message);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.queue.length = 0;
    for (const reader of this.readers.splice(0)) {
      reader({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.queue.shift();
        if (message) {
          return Promise.resolve({ value: message, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise(resolve => this.readers.push(resolve));
      },
    };
  }
}
