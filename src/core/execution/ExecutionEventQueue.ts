/** Small closeable async queue used by provider run event streams. */
export class ExecutionEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  count = 0;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    this.count += 1;
    const reader = this.readers.shift();
    if (reader) {
      reader({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const reader of this.readers.splice(0)) {
      reader({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>(resolve => this.readers.push(resolve));
      },
    };
  }
}
