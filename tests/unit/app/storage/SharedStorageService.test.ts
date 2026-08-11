import type { Plugin } from 'obsidian';

import { SharedStorageService } from '@/app/storage/SharedStorageService';

describe('SharedStorageService', () => {
  it('preserves every provider-neutral tab field during validation', async () => {
    const state = {
      openTabs: [{
        tabId: 'tab-1',
        conversationId: null,
        draftModel: 'model-1',
        draftSettings: { effortLevel: 'high' },
        titleOverride: 'Research',
        orchestratorMode: true,
      }],
      activeTabId: 'tab-1',
    };
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn().mockResolvedValue({ tabManagerState: state }),
      saveData: jest.fn().mockResolvedValue(undefined),
    } as unknown as Plugin;
    const storage = new SharedStorageService(plugin);

    await expect(storage.getTabManagerState()).resolves.toEqual(state);
  });
});
