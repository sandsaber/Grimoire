import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { DurableExecutionResultStore } from '@/app/runtime/DurableExecutionResultStore';
import {
  createNativeScopedResultSink,
  createRunScopedResultSink,
} from '@/app/runtime/ProviderExecutionResultAdapters';
import { runId } from '@/core/execution/ExecutionIds';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ProviderExecutionResultAdapters', () => {
  it('keeps provider and Grimoire run identity in a run-scoped commit', async () => {
    const storage = new TestDurableStorage();
    const sink = createRunScopedResultSink(
      'codex',
      new DurableExecutionResultStore(storage, digest),
    );

    const committed = await sink.storeResult({
      runId: runId(`run-${'1'.repeat(32)}`),
      output: 'done',
      source: 'native-agent',
      nativeAgentKey: 'agent/provider key',
      signal: new AbortController().signal,
    });

    expect(committed.kind).toBe('committed');
    await expect(storage.list('.grimoire/results')).resolves.toHaveLength(1);
  });

  it('hashes arbitrary managed-session identity without exposing it as a path', async () => {
    const storage = new TestDurableStorage();
    const sink = createNativeScopedResultSink(
      'opencode',
      new DurableExecutionResultStore(storage, digest),
    );

    const committed = await sink.storeResult({
      output: 'done',
      nativeSessionRef: 'session/with path separators',
      nativeRunRef: 'turn with spaces',
      signal: new AbortController().signal,
    });

    expect(committed.kind).toBe('committed');
    const paths = await storage.list('.grimoire/results');
    expect(paths).toHaveLength(1);
    expect(paths[0]).not.toContain('session');
  });
});
