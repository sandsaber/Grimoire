import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionInteractionPresentationStore } from '@/app/runtime/ExecutionInteractionPresentationStore';
import { EXECUTION_PRESENTATIONS_PATH } from '@/core/bootstrap/StoragePaths';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ExecutionInteractionPresentationStore', () => {
  it('stores and replays a bounded content-addressed presentation idempotently', async () => {
    const storage = new TestDurableStorage();
    const store = new ExecutionInteractionPresentationStore(storage, digest);
    const input = {
      kind: 'approval' as const,
      title: 'Write file',
      description: 'Allow the provider to update notes/example.md?',
      options: [
        { responseId: 'allow-once', label: 'Allow once' },
        { responseId: 'deny', label: 'Deny', description: 'Keep the vault unchanged' },
      ],
    };

    const first = await store.store(input);
    expect(first.presentationRef).toMatch(/^pr-[0-9a-f]{64}$/);
    await expect(store.store(input)).resolves.toEqual(first);
    await expect(store.read(first.presentationRef)).resolves.toEqual(first);
  });

  it('detects a valid-schema label swap through the content-addressed ref', async () => {
    const storage = new TestDurableStorage();
    const store = new ExecutionInteractionPresentationStore(storage, digest);
    const record = await store.store({
      kind: 'approval',
      title: 'Write note',
      options: [
        { responseId: 'allow', label: 'Allow' },
        { responseId: 'deny', label: 'Deny' },
      ],
    });
    const path = `${EXECUTION_PRESENTATIONS_PATH}/${record.presentationRef}.json`;
    const raw = storage.get(path);
    if (!raw) throw new Error('Expected stored presentation.');
    const tampered = JSON.parse(raw) as Record<string, unknown>;
    tampered.options = [
      { responseId: 'allow', label: 'Deny' },
      { responseId: 'deny', label: 'Allow' },
    ];
    await storage.writeAtomic(path, JSON.stringify(tampered));

    await expect(store.read(record.presentationRef)).rejects.toThrow('content digest is invalid');
  });

  it('bounds unique records and removes pre-open crash orphans during recovery', async () => {
    const storage = new TestDurableStorage();
    const store = new ExecutionInteractionPresentationStore(storage, digest, 512, 2, 1_024);
    const retained = await store.store({
      kind: 'question',
      title: 'Retained',
      options: [{ responseId: 'one', label: 'One' }],
    });
    const orphan = await store.store({
      kind: 'approval',
      title: 'Crashed before interaction-opened',
      options: [{ responseId: 'deny', label: 'Deny' }],
    });
    await expect(store.store({
      kind: 'approval',
      title: 'Capacity exhausted',
      options: [{ responseId: 'deny', label: 'Deny' }],
    })).rejects.toThrow('capacity');

    await expect(store.recover([retained.presentationRef])).resolves.toMatchObject({
      retained: 1,
      removed: 1,
    });
    await expect(store.read(orphan.presentationRef)).resolves.toBeNull();
    await expect(store.store({
      kind: 'approval',
      title: 'Capacity restored',
      options: [{ responseId: 'deny', label: 'Deny' }],
    })).resolves.toBeDefined();
  });

  it('rejects missing retained records, invalid refs, duplicate responses, and unsafe text', async () => {
    const store = new ExecutionInteractionPresentationStore(
      new TestDurableStorage(),
      digest,
    );
    await expect(store.read('provider-native-path')).rejects.toThrow('content-addressed');
    await expect(store.recover([`pr-${'1'.repeat(64)}`])).rejects.toThrow('is missing');
    await expect(store.store({
      kind: 'approval',
      title: 'Approve',
      options: [
        { responseId: 'same', label: 'One' },
        { responseId: 'same', label: 'Two' },
      ],
    })).rejects.toThrow('unique');
    await expect(store.store({
      kind: 'approval',
      title: 'Unsafe\u0000title',
      options: [{ responseId: 'allow', label: 'Allow' }],
    })).rejects.toThrow('title is invalid');
  });
});
