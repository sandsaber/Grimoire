import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';
import { createApplicationRuntime } from '@/app/runtime/ApplicationRuntimeFactory';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('createApplicationRuntime', () => {
  it('constructs the runtime admission boundary from the production composition', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      agents: {
        recover: async () => undefined,
        waitForIdle: async () => undefined,
        dispose: () => undefined,
      },
      projections: { dispose: () => undefined },
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    expect(runtime.state).toBe('constructed');
    expect(() => runtime.loadConversation('c1')).toThrow();
  });
});
