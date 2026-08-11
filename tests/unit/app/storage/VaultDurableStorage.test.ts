import {
  type AtomicTextFileAdapter,
  VaultDurableStorage,
} from '@/app/storage/VaultDurableStorage';

class FaultInjectingAdapter implements AtomicTextFileAdapter {
  readonly coordinationKey: object = this;
  readonly files = new Map<string, string>();
  failAfter?: (operation: string) => void;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`Missing ${path}`);
    }
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.failAfter?.(`write:${path}`);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const value = await this.read(oldPath);
    this.files.set(newPath, value);
    this.files.delete(oldPath);
    this.failAfter?.(`rename:${oldPath}->${newPath}`);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.failAfter?.(`delete:${path}`);
  }

  async listFilesRecursive(path: string): Promise<string[]> {
    return [...this.files.keys()].filter(file => (
      file === path || file.startsWith(`${path}/`)
    ));
  }
}

describe('VaultDurableStorage', () => {
  const path = 'control/record.json';

  it('promotes a complete first write interrupted after staging', async () => {
    const adapter = new FaultInjectingAdapter();
    adapter.failAfter = operation => {
      if (operation === `write:${path}.pending`) {
        throw new Error('crash');
      }
    };
    const storage = new VaultDurableStorage(adapter);

    await expect(storage.writeAtomic(path, 'new')).rejects.toThrow('crash');
    adapter.failAfter = undefined;
    await expect(new VaultDurableStorage(adapter).read(path)).resolves.toBe('new');
  });

  it('restores the old value when replacement stops after backup', async () => {
    const adapter = new FaultInjectingAdapter();
    adapter.files.set(path, 'old');
    adapter.failAfter = operation => {
      if (operation === `rename:${path}->${path}.backup`) {
        throw new Error('crash');
      }
    };
    const storage = new VaultDurableStorage(adapter);

    await expect(storage.writeAtomic(path, 'new')).rejects.toThrow('crash');
    adapter.failAfter = undefined;
    await expect(new VaultDurableStorage(adapter).read(path)).resolves.toBe('old');
  });

  it('keeps the new value when replacement stops after publication', async () => {
    const adapter = new FaultInjectingAdapter();
    adapter.files.set(path, 'old');
    adapter.failAfter = operation => {
      if (operation === `rename:${path}.pending->${path}`) {
        throw new Error('crash');
      }
    };
    const storage = new VaultDurableStorage(adapter);

    await expect(storage.writeAtomic(path, 'new')).rejects.toThrow('crash');
    adapter.failAfter = undefined;
    await expect(new VaultDurableStorage(adapter).read(path)).resolves.toBe('new');
    expect(adapter.files.has(`${path}.backup`)).toBe(false);
  });

  it('recovers sidecars while listing and returns only published paths', async () => {
    const adapter = new FaultInjectingAdapter();
    adapter.files.set('control/a.json.pending', 'first');
    adapter.files.set('control/b.json.backup', 'second');
    adapter.files.set('control/c.json', 'third');
    adapter.files.set('other/ignored.json', 'ignored');
    const storage = new VaultDurableStorage(adapter);

    await expect(storage.list('control')).resolves.toEqual([
      'control/a.json',
      'control/b.json',
      'control/c.json',
    ]);
    await expect(storage.read('control/a.json')).resolves.toBe('first');
    await expect(storage.read('control/b.json')).resolves.toBe('second');
    expect([...adapter.files.keys()].some(file => (
      file.endsWith('.pending') || file.endsWith('.backup')
    ))).toBe(false);
  });
});
