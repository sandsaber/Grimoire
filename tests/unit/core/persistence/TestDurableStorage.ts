import type { DurableStorage } from '@/core/persistence/DurableStorage';

export class TestDurableStorage implements DurableStorage {
  constructor(private readonly records = new Map<string, string>()) {}

  async read(path: string): Promise<string | null> {
    return this.records.get(path) ?? null;
  }

  async readBounded(path: string, maxBytes: number): Promise<string | null> {
    const value = await this.read(path);
    if (value !== null && Buffer.byteLength(value, 'utf8') > maxBytes) {
      throw new Error('Durable value exceeds the byte limit.');
    }
    return value;
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

  async compareAndSwapBounded(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
    maxCurrentBytes: number,
  ): Promise<boolean> {
    await this.readBounded(path, maxCurrentBytes);
    return this.compareAndSwap(path, expectedContent, nextContent);
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
