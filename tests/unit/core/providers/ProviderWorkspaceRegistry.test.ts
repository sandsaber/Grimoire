import '@/providers';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';

describe('ProviderWorkspaceRegistry', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
  });

  it('refreshes agent mention state through the workspace registry', async () => {
    const refreshClaude = jest.fn().mockResolvedValue(undefined);
    const refreshCodex = jest.fn().mockResolvedValue(undefined);

    ProviderWorkspaceRegistry.setServices('claude', {
      refreshAgentMentions: refreshClaude,
    });
    ProviderWorkspaceRegistry.setServices('codex', {
      refreshAgentMentions: refreshCodex,
    });

    await ProviderWorkspaceRegistry.refreshAgentMentions('codex');

    expect(refreshClaude).not.toHaveBeenCalled();
    expect(refreshCodex).toHaveBeenCalled();
  });

  it('returns the runtime command loader for a provider', () => {
    const runtimeCommandLoader = {
      isAvailable: jest.fn().mockReturnValue(true),
      loadCommands: jest.fn().mockResolvedValue([]),
    };

    ProviderWorkspaceRegistry.setServices('opencode', {
      runtimeCommandLoader: runtimeCommandLoader,
    });

    expect(ProviderWorkspaceRegistry.getRuntimeCommandLoader('opencode')).toBe(runtimeCommandLoader);
  });

});
