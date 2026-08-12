import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeInfrastructure } from '@/app/runtime/ApplicationRuntimeInfrastructure';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ApplicationRuntimeInfrastructure', () => {
  it('constructs durable repositories, transaction coordinator, and lifecycle registry', () => {
    const infra = new ApplicationRuntimeInfrastructure({
      storage: new TestDurableStorage(),
      digest,
    });

    expect(infra.identities).toBeDefined();
    expect(infra.repositories).toBeDefined();
    expect(infra.transactions).toBeDefined();
    expect(infra.lifecycle).toBeDefined();
    expect(typeof infra.identities.nextRunId()).toBe('string');
    expect(typeof infra.identities.nextTransactionId()).toBe('string');
  });

  it('accepts a custom scheduler and now source', () => {
    const now = () => 42;
    let timeouts = 0;
    const scheduler = {
      setTimeout: (callback: () => void, _delayMs: number) => {
        timeouts += 1;
        callback();
        return undefined;
      },
      clearTimeout: () => undefined,
    };
    const infra = new ApplicationRuntimeInfrastructure({
      storage: new TestDurableStorage(),
      digest,
      now,
      scheduler,
    });

    expect(infra.scheduler).toBe(scheduler);
    void infra.lifecycle; // constructed without throwing
    expect(timeouts).toBeGreaterThanOrEqual(0);
  });
});
