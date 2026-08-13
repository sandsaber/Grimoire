import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';
import { createApplicationRuntime } from '@/app/runtime/ApplicationRuntimeFactory';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('createApplicationRuntime', () => {
  it('constructs the runtime admission boundary with native agent bridge from the composition', () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    expect(runtime.state).toBe('constructed');
    expect(() => runtime.loadConversation('c1')).toThrow();
  });

  it('starts, accepts commands, and shuts down through the full composition', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    await runtime.start();
    expect(runtime.state).toBe('accepting');
    await runtime.shutdown();
    expect(runtime.state).toBe('stopped');
  });
});
