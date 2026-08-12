import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ApplicationRuntimeComposition', () => {
  it('constructs the complete production runtime from a single durable storage', () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });

    expect(composition.infrastructure).toBeDefined();
    expect(composition.composition).toBeDefined();
    expect(composition.generations).toBeDefined();
    expect(composition.startup).toBeDefined();
    expect(composition.lifecycleAdapter).toBeDefined();
    expect(composition.migration).toBeDefined();
    expect(composition.requests).toBeDefined();
    expect(composition.results).toBeDefined();
    expect(composition.presentations).toBeDefined();
    expect(composition.conversations).toBeDefined();
    expect(composition.agents).toBeDefined();
    expect(composition.work).toBeDefined();
    expect(composition.chat).toBeDefined();
    expect(composition.shell).toBeDefined();
    expect(composition.auxiliary).toBeDefined();
    expect(composition.identities).toBeDefined();
  });

  it('initializes all nine provider backends and starts the lifecycle registry', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });

    await composition.lifecycleAdapter.initialize();
    await composition.lifecycleAdapter.start();

    // Every coordinator should be ready to accept commands.
    expect(typeof composition.chat.submitTurn).toBe('function');
    expect(typeof composition.shell.recover).toBe('function');
    expect(typeof composition.auxiliary.recover).toBe('function');

    await composition.lifecycleAdapter.shutdown(`sd-${'1'.repeat(32)}`);
    await composition.lifecycleAdapter.dispose();
  });
});
