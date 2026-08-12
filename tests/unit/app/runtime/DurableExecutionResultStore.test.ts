import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('DurableExecutionResultStore', () => {
  it('commits idempotently and materializes a digest-bound result', async () => {
    const store = new DurableExecutionResultStore(new TestDurableStorage(), digest);
    const input = {
      identity: { runId: `run-${'1'.repeat(32)}` },
      output: 'Finished safely.',
      source: 'assistant',
      signal: new AbortController().signal,
    };

    const first = await store.store(input);
    const second = await store.store(input);
    expect(second).toEqual(first);
    expect(first.kind).toBe('committed');
    if (first.kind !== 'committed') throw new Error('Expected committed result.');
    await expect(store.materialize(first.result)).resolves.toEqual({
      resultRef: first.result,
      finalAssistantText: 'Finished safely.',
    });
  });

  it('hashes provider-native identities without treating them as storage paths', async () => {
    const storage = new TestDurableStorage();
    const store = new DurableExecutionResultStore(storage, digest);

    const committed = await store.store({
      identity: {
        nativeRunRef: 'thread/provider turn with spaces',
        nativeSessionRef: 'session\\windows/value',
      },
      output: 'Provider result.',
      source: 'assistant',
      signal: new AbortController().signal,
    });

    expect(committed.kind).toBe('committed');
    await expect(storage.list('.grimoire/results')).resolves.toHaveLength(1);
  });

  it('does not write before an already-aborted commit', async () => {
    const storage = new TestDurableStorage();
    const store = new DurableExecutionResultStore(storage, digest);
    const abort = new AbortController();
    abort.abort();

    await expect(store.store({
      identity: { runId: `run-${'2'.repeat(32)}` },
      output: 'not persisted',
      source: 'assistant',
      signal: abort.signal,
    })).resolves.toEqual({ kind: 'aborted' });
    await expect(storage.list('.grimoire/results')).resolves.toEqual([]);
  });

  it('fails closed on oversize output and a mismatched digest', async () => {
    const store = new DurableExecutionResultStore(new TestDurableStorage(), digest, 4);
    await expect(store.store({
      identity: { runId: `run-${'3'.repeat(32)}` },
      output: '12345',
      source: 'assistant',
      signal: new AbortController().signal,
    })).rejects.toThrow('byte limit');

    const roomy = new DurableExecutionResultStore(new TestDurableStorage(), digest);
    const committed = await roomy.store({
      identity: { runId: `run-${'4'.repeat(32)}` },
      output: 'ok',
      source: 'assistant',
      signal: new AbortController().signal,
    });
    if (committed.kind !== 'committed') throw new Error('Expected committed result.');
    await expect(roomy.materialize({
      ...committed.result,
      digest: 'f'.repeat(64),
    })).rejects.toThrow('identity validation');
  });

  it('rejects a result whose durable text no longer matches its stored digest', async () => {
    const storage = new TestDurableStorage();
    const store = new DurableExecutionResultStore(storage, digest);
    const committed = await store.store({
      identity: { runId: `run-${'5'.repeat(32)}` },
      output: 'original',
      source: 'assistant',
      signal: new AbortController().signal,
    });
    if (committed.kind !== 'committed') throw new Error('Expected committed result.');
    const [path] = await storage.list('.grimoire/results');
    const raw = path ? storage.get(path) : null;
    if (!path || !raw) throw new Error('Expected stored result.');
    const record = JSON.parse(raw) as Record<string, unknown>;
    storage.seed(path, JSON.stringify({ ...record, finalText: 'tampered' }));

    await expect(store.materialize(committed.result)).rejects.toThrow('content validation');
  });

  it('reapplies the configured byte bound while reading existing data', async () => {
    const storage = new TestDurableStorage();
    const writer = new DurableExecutionResultStore(storage, digest, 16);
    const committed = await writer.store({
      identity: { runId: `run-${'6'.repeat(32)}` },
      output: '12345678',
      source: 'assistant',
      signal: new AbortController().signal,
    });
    if (committed.kind !== 'committed') throw new Error('Expected committed result.');

    const boundedReader = new DurableExecutionResultStore(storage, digest, 4);
    await expect(boundedReader.materialize(committed.result)).rejects.toThrow('byte limit');
  });

  it('round-trips near-limit control characters using the serialized record bound', async () => {
    const storage = new TestDurableStorage();
    const store = new DurableExecutionResultStore(storage, digest, 8);
    const committed = await store.store({
      identity: { runId: `run-${'7'.repeat(32)}` },
      output: '\0'.repeat(8),
      source: 'assistant',
      signal: new AbortController().signal,
    });
    if (committed.kind !== 'committed') throw new Error('Expected committed result.');

    await expect(store.store({
      identity: { runId: `run-${'7'.repeat(32)}` },
      output: '\0'.repeat(8),
      source: 'assistant',
      signal: new AbortController().signal,
    })).resolves.toEqual(committed);
    await expect(store.materialize(committed.result)).resolves.toMatchObject({
      finalAssistantText: '\0'.repeat(8),
    });
  });

  it('requires a digest when materializing projection-owned content', async () => {
    const store = new DurableExecutionResultStore(new TestDurableStorage(), digest);
    await expect(store.materialize({
      resultId: 'result-without-digest',
      storage: 'projection',
    })).rejects.toThrow('requires a canonical digest');
  });

  it('rejects a result limit whose worst-case serialized form cannot be bounded safely', () => {
    expect(() => new DurableExecutionResultStore(
      new TestDurableStorage(),
      digest,
      Number.MAX_SAFE_INTEGER,
    )).toThrow('too large');
  });
});
