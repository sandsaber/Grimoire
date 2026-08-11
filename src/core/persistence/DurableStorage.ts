/**
 * Platform-neutral storage contract. Conditional replacement must be atomic
 * across every client that shares the same backing store.
 */
export interface DurableStorage {
  read(path: string): Promise<string | null>;
  writeAtomic(path: string, content: string): Promise<void>;
  compareAndSwap(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
  ): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
