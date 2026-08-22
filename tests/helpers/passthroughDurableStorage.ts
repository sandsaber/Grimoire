import type { DurableStorage } from '@/core/persistence/DurableStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/**
 * A durable store that writes straight through to the adapter behind it.
 *
 * For suites whose subject is what a caller *does* with storage — which path it
 * writes, which it deletes, what it does with a read that fails — rather than
 * whether the write survives a crash. That second question belongs to
 * `VaultDurableStorage`, which owns the pending-and-rename dance and is tested
 * on it directly; a double that reproduced it here would only mean those suites
 * assert against temporary file names.
 */
export function createPassthroughDurableStorage(adapter: VaultFileAdapter): DurableStorage {
  return {
    // `null` for a file that is not there, which is the contract — and a read
    // that fails is answered the same way, because the adapters behind these
    // suites report absence by throwing.
    read: async path => {
      try {
        return await adapter.read(path);
      } catch {
        return null;
      }
    },
    writeAtomic: (path, content) => adapter.write(path, content),
    compareAndSwap: async (path, _expected, next) => {
      if (next === null) {
        await adapter.delete(path);
      } else {
        await adapter.write(path, next);
      }
      return true;
    },
    remove: path => adapter.delete(path),
    // Straight through, like the rest. A stub returning nothing was harmless
    // while no caller listed through the durable store; `SessionStorage` does
    // now, and an empty listing made every conversation invisible in the suites
    // that use this double.
    list: async prefix => {
      try {
        return await adapter.listFiles(prefix);
      } catch {
        return [];
      }
    },
  };
}
