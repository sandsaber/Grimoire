import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';
import { createApplicationRuntimePluginLifecycle } from '@/app/runtime/ApplicationRuntimePluginLifecycle';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('createApplicationRuntimePluginLifecycle', () => {
  it('starts and shuts down the runtime through the plugin lifecycle adapter', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const lifecycle = createApplicationRuntimePluginLifecycle({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    expect(lifecycle.runtime.state).toBe('constructed');
    await lifecycle.start();
    expect(lifecycle.runtime.state).toBe('accepting');
    await lifecycle.shutdown();
    expect(lifecycle.runtime.state).toBe('stopped');
  });

  it('shares concurrent start calls', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const lifecycle = createApplicationRuntimePluginLifecycle({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    const first = lifecycle.start();
    const second = lifecycle.start();
    await Promise.all([first, second]);
    expect(lifecycle.runtime.state).toBe('accepting');
    await lifecycle.shutdown();
  });
});
