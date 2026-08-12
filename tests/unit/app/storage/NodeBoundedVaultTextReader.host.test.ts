import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { App } from 'obsidian';

import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import { NodeBoundedVaultTextReader } from '@/app/storage/NodeBoundedVaultTextReader';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

describe('NodeBoundedVaultTextReader host integration', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'grimoire-bounded-vault-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('caps a real descriptor read before decoding', async () => {
    await writeFile(join(root, 'bounded.txt'), '123456789', 'utf8');
    const reader = new NodeBoundedVaultTextReader({ getBasePath: () => root });

    await expect(reader.readBounded('bounded.txt', 8)).rejects.toThrow('byte limit');
    await expect(reader.readBounded('bounded.txt', 9)).resolves.toBe('123456789');
  });

  it('round-trips a digest-bound result through vault CAS and capped reads', async () => {
    const dataAdapter = nodeDataAdapter(root);
    const files = new VaultFileAdapter(
      { vault: { adapter: dataAdapter } } as unknown as App,
      new NodeBoundedVaultTextReader({ getBasePath: () => root }),
    );
    const results = new DurableExecutionResultStore(
      new VaultDurableStorage(files),
      { digestUtf8: async value => createHash('sha256').update(value).digest('hex') },
      64,
    );

    const committed = await results.store({
      identity: { runId: `run-${'1'.repeat(32)}` },
      output: 'cross-platform result',
      source: 'assistant',
      signal: new AbortController().signal,
    });
    if (committed.kind !== 'committed') throw new Error('Expected committed result.');

    await expect(results.materialize(committed.result)).resolves.toEqual({
      resultRef: committed.result,
      finalAssistantText: 'cross-platform result',
    });
  });
});

function nodeDataAdapter(root: string) {
  const absolute = (path: string) => join(root, ...path.split('/'));
  return {
    exists: async (path: string) => stat(absolute(path)).then(() => true, () => false),
    stat: async (path: string) => stat(absolute(path)).then(value => ({
      ctime: value.ctimeMs,
      mtime: value.mtimeMs,
      size: value.size,
      type: value.isDirectory() ? 'folder' as const : 'file' as const,
    }), () => null),
    read: async (path: string) => readFile(absolute(path), 'utf8'),
    readBinary: async (path: string) => {
      const value = await readFile(absolute(path));
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
    write: async (path: string, content: string) => {
      await mkdir(dirname(absolute(path)), { recursive: true });
      await writeFile(absolute(path), content, 'utf8');
    },
    remove: async (path: string) => { await rm(absolute(path), { force: true }); },
    rename: async (from: string, to: string) => {
      await mkdir(dirname(absolute(to)), { recursive: true });
      await rename(absolute(from), absolute(to));
    },
    mkdir: async (path: string) => { await mkdir(absolute(path), { recursive: true }); },
    list: async () => ({ files: [], folders: [] }),
  };
}
