import type { DurableStorage } from '@/core/persistence/DurableStorage';

export class TestDurableStorage implements DurableStorage {
  constructor(private readonly records = new Map<string, string>()) {}

  async read(path: string): Promise<string | null> {
    return this.records.get(path) ?? null;
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    this.records.set(path, content);
  }

  async compareAndSwap(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
  ): Promise<boolean> {
    if ((this.records.get(path) ?? null) !== expectedContent) {
      return false;
    }
    if (nextContent === null) {
      this.records.delete(path);
    } else {
      this.records.set(path, nextContent);
    }
    return true;
  }

  async remove(path: string): Promise<void> {
    this.records.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.records.keys()]
      .filter(path => path === prefix || path.startsWith(`${prefix}/`))
      .sort();
  }

  seed(path: string, content: string): void {
    this.records.set(path, content);
  }

  get(path: string): string | null {
    return this.records.get(path) ?? null;
  }
}
