import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';
import { CatalogNativeAgentProviderProfilePort } from '@/app/runtime/CatalogNativeAgentProviderProfilePort';
import { createNativeAgentLifecycleBridge } from '@/app/runtime/NativeAgentLifecycleBridgeWiring';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('CatalogNativeAgentProviderProfilePort', () => {
  it('maps provider backends to their agent observation profiles', () => {
    const port = new CatalogNativeAgentProviderProfilePort(builtInProviderCatalog);
    // Claude has 'full' agent observation; Antigravity has 'none'.
    const claude = port.forBackend(executionBackendId('provider-claude'));
    expect(claude).not.toBeNull();
    expect(claude?.observation).toBe('full');
    const antigravity = port.forBackend(executionBackendId('provider-antigravity'));
    expect(antigravity).toBeNull();
  });

  it('returns null for an unknown backend', () => {
    const port = new CatalogNativeAgentProviderProfilePort(builtInProviderCatalog);
    expect(port.forBackend(executionBackendId('unknown-backend'))).toBeNull();
  });
});

describe('createNativeAgentLifecycleBridge', () => {
  it('constructs the native agent lifecycle bridge from the composition', () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const bridge = createNativeAgentLifecycleBridge(composition, builtInProviderCatalog);
    expect(bridge).toBeDefined();
    expect(typeof bridge.recover).toBe('function');
    expect(typeof bridge.waitForIdle).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
  });
});
