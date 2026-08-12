import type { DurableStorage } from '../../core/persistence/DurableStorage';

const backingStoreQueues = new WeakMap<object, Map<string, Promise<void>>>();

export interface AtomicTextFileAdapter {
  /** Stable identity shared by every adapter instance for the same live vault. */
  readonly coordinationKey: object;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBounded(path: string, maxBytes: number): Promise<string>;
  write(path: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  listFilesRecursive(path: string): Promise<string[]>;
}

/**
 * Recoverable same-directory replacement for vault adapters without a native
 * replace operation. Recovery always publishes either the old complete value
 * or the new complete value, never a partially written record.
 */
export class VaultDurableStorage implements DurableStorage {
  private readonly queues: Map<string, Promise<void>>;

  constructor(private readonly adapter: AtomicTextFileAdapter) {
    const existingQueues = backingStoreQueues.get(adapter.coordinationKey);
    if (existingQueues) {
      this.queues = existingQueues;
    } else {
      this.queues = new Map();
      backingStoreQueues.set(adapter.coordinationKey, this.queues);
    }
  }

  read(path: string): Promise<string | null> {
    return this.enqueue(path, async () => {
      await this.recover(path);
      return await this.adapter.exists(path) ? this.adapter.read(path) : null;
    });
  }

  readBounded(path: string, maxBytes: number): Promise<string | null> {
    requireByteLimit(maxBytes);
    return this.enqueue(path, async () => {
      await this.recover(path);
      return await this.adapter.exists(path)
        ? this.adapter.readBounded(path, maxBytes)
        : null;
    });
  }

  writeAtomic(path: string, content: string): Promise<void> {
    return this.enqueue(path, async () => {
      await this.recover(path);
      await this.writeAtomicUnlocked(path, content);
    });
  }

  compareAndSwap(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
  ): Promise<boolean> {
    return this.enqueue(path, async () => {
      await this.recover(path);
      const current = await this.adapter.exists(path)
        ? await this.adapter.read(path)
        : null;
      if (current !== expectedContent) {
        return false;
      }
      if (nextContent === null) {
        await this.removeUnlocked(path);
      } else {
        await this.writeAtomicUnlocked(path, nextContent);
      }
      return true;
    });
  }

  compareAndSwapBounded(
    path: string,
    expectedContent: string | null,
    nextContent: string | null,
    maxCurrentBytes: number,
  ): Promise<boolean> {
    requireByteLimit(maxCurrentBytes);
    return this.enqueue(path, async () => {
      await this.recover(path);
      const current = await this.adapter.exists(path)
        ? await this.adapter.readBounded(path, maxCurrentBytes)
        : null;
      if (current !== expectedContent) return false;
      if (nextContent === null) {
        await this.removeUnlocked(path);
      } else {
        await this.writeAtomicUnlocked(path, nextContent);
      }
      return true;
    });
  }

  remove(path: string): Promise<void> {
    return this.enqueue(path, async () => {
      await this.removeUnlocked(path);
    });
  }

  async list(prefix: string): Promise<string[]> {
    const files = await this.adapter.listFilesRecursive(prefix);
    const basePaths = new Set(files.map(path => (
      path.endsWith('.pending')
        ? path.slice(0, -'.pending'.length)
        : path.endsWith('.backup')
          ? path.slice(0, -'.backup'.length)
          : path
    )));
    const recovered: string[] = [];
    for (const path of [...basePaths].sort()) {
      if (await this.read(path) !== null) {
        recovered.push(path);
      }
    }
    return recovered;
  }

  private async recover(path: string): Promise<void> {
    const pendingPath = getPendingPath(path);
    const backupPath = getBackupPath(path);
    if (await this.adapter.exists(path)) {
      await this.adapter.delete(pendingPath);
      await this.adapter.delete(backupPath);
      return;
    }
    if (await this.adapter.exists(backupPath)) {
      await this.adapter.rename(backupPath, path);
      await this.adapter.delete(pendingPath);
      return;
    }
    if (await this.adapter.exists(pendingPath)) {
      await this.adapter.rename(pendingPath, path);
    }
  }

  private async writeAtomicUnlocked(path: string, content: string): Promise<void> {
    const pendingPath = getPendingPath(path);
    const backupPath = getBackupPath(path);
    await this.adapter.write(pendingPath, content);
    if (await this.adapter.exists(path)) {
      await this.adapter.rename(path, backupPath);
    }
    await this.adapter.rename(pendingPath, path);
    await this.adapter.delete(backupPath);
  }

  private async removeUnlocked(path: string): Promise<void> {
    await this.adapter.delete(path);
    await this.adapter.delete(getPendingPath(path));
    await this.adapter.delete(getBackupPath(path));
  }

  private enqueue<TResult>(path: string, task: () => Promise<TResult>): Promise<TResult> {
    const previous = this.queues.get(path) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(() => undefined, () => undefined);
    this.queues.set(path, tail);
    return operation.finally(() => {
      if (this.queues.get(path) === tail) {
        this.queues.delete(path);
      }
    });
  }
}

function requireByteLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Durable storage byte limit must be a positive safe integer.');
  }
}

function getPendingPath(path: string): string {
  return `${path}.pending`;
}

function getBackupPath(path: string): string {
  return `${path}.backup`;
}
