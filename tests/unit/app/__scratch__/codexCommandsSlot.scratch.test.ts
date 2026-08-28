import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { ApplicationRuntime } from '@/app/ApplicationRuntime';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';

describe('codex commands slot vs workspace publish order', () => {
  function runtime(): ApplicationRuntime {
    return new ApplicationRuntime({
      adapter: createDurableInMemoryVaultAdapter(),
      defaultProviderId: 'codex',
      plugin: {
        app: { vault: { adapter: { basePath: '/vault' } } },
        getActiveEnvironmentVariables: () => '',
        getResolvedProviderCliPath: () => null,
        recordDebugLog: () => undefined,
        settings: {},
      } as never,
      report: () => undefined,
      resolveTitleProviderId: () => 'codex',
      sessions: {
        records: {} as never,
        toConversation: (() => null) as never,
        toSessionMetadata: (() => null) as never,
      },
    });
  }

  afterEach(() => {
    ProviderWorkspaceRegistry.setServices('codex', undefined);
  });

  it('loses the commands slot forever when the workspace is built before services publish', async () => {
    const app = runtime();

    // Built while the registry is empty, exactly as ApplicationRuntime.start()
    // does for codex before main.onload runs startProviderWorkspaces().
    const early = await app.workspaceFor('codex');
    expect(early.commands).toBeUndefined();

    const catalog = {
      listDropdownEntries: async () => [{ name: 'review', kind: 'command' }],
      listVaultEntries: async () => [{ name: 'review', kind: 'skill' }],
      saveVaultEntry: async () => undefined,
      deleteVaultEntry: async () => undefined,
      setRuntimeCommands: () => undefined,
      refresh: async () => undefined,
    };
    ProviderWorkspaceRegistry.setServices('codex', { commandCatalog: catalog } as never);

    const later = await app.workspaceFor('codex');
    expect(later.commands).toBeUndefined();

    app.dispose();
  });
});
