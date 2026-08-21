import * as sdkModule from '@anthropic-ai/claude-agent-sdk';
import { requestUrl } from 'obsidian';

import { createClaudeWorkspaceServices } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { getClaudeModelOptions } from '@/providers/claude/modelOptions';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '@/providers/claude/settings';

const sdkMock = sdkModule as unknown as {
  getLastOptions: () => sdkModule.Options | undefined;
  getQueryCallCount: () => number;
  resetMockMessages: () => void;
  setMockMessages: (messages: unknown[], options?: { appendResult?: boolean }) => void;
  setMockSupportedModels: (models: unknown[]) => void;
};

function createVaultAdapter() {
  return {
    // Identity of the backing store, which the durable writer behind session
    // metadata serializes per path against.
    coordinationKey: {},
    delete: jest.fn(),
    ensureFolder: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    listFiles: jest.fn().mockResolvedValue([]),
    listFilesRecursive: jest.fn().mockResolvedValue([]),
    read: jest.fn(),
    rename: jest.fn().mockResolvedValue(undefined),
    write: jest.fn(),
  };
}

describe('createClaudeWorkspaceServices', () => {
  afterEach(() => {
    jest.mocked(requestUrl).mockReset();
    sdkMock.resetMockMessages();
    jest.restoreAllMocks();
  });

  it('uses the authenticated SDK model catalog without an API key or static aliases', async () => {
    sdkMock.setMockMessages([{ type: 'system', subtype: 'init' }], { appendResult: false });
    sdkMock.setMockSupportedModels([
      {
        value: 'default',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Default (recommended)',
        description: 'Claude Opus 5',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        value: 'opus[1m]',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Opus (1M context)',
        description: 'Claude Opus 5 with 1M context',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ]);
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      enableChrome: true,
      loadUserSettings: false,
    });
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/mock/claude'),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };

    const services = await createClaudeWorkspaceServices(plugin as any, createVaultAdapter() as any);
    await services.modelCatalog.refreshModels({ plugin: plugin as any, settings });

    expect(requestUrl).not.toHaveBeenCalled();
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      expect.objectContaining({ id: 'default', resolvedModel: 'claude-opus-5[1m]', source: 'sdk' }),
      expect.objectContaining({ id: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', source: 'sdk' }),
    ]);
    expect(getClaudeModelOptions(settings).map(option => option.value)).toEqual(['default', 'opus[1m]']);
    expect(sdkMock.getLastOptions()?.settingSources).toEqual(['project', 'local']);
    expect(sdkMock.getLastOptions()?.extraArgs).toEqual({ chrome: null });
    expect(sdkMock.getLastOptions()?.abortController?.signal.aborted).toBe(true);
  });

  it('preserves a persisted catalog when both SDK and API discovery fail', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      environmentVariables: 'ANTHROPIC_API_KEY=test-key',
      discoveredModels: [{ id: 'default', displayName: 'Default', source: 'sdk' }],
    });
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/mock/claude'),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    sdkMock.setMockMessages([{ type: 'system', subtype: 'init' }], { appendResult: false });
    jest.mocked(requestUrl).mockRejectedValue(new Error('offline'));

    const services = await createClaudeWorkspaceServices(plugin as any, createVaultAdapter() as any);
    await services.modelCatalog.refreshModels({ plugin: plugin as any, settings });

    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      { id: 'default', displayName: 'Default', source: 'sdk' },
    ]);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('refreshes a persisted catalog on first picker open, then uses the ten-minute cache', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'legacy', displayName: 'Legacy', source: 'api' }],
    });
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/mock/claude'),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    sdkMock.setMockMessages([{ type: 'system', subtype: 'init' }], { appendResult: false });
    sdkMock.setMockSupportedModels([{ value: 'default', displayName: 'Default', description: 'Native model' }]);

    const services = await createClaudeWorkspaceServices(plugin as any, createVaultAdapter() as any);
    await services.modelCatalog.refreshModels({ plugin: plugin as any, settings });
    await services.modelCatalog.refreshModels({ plugin: plugin as any, settings });

    expect(sdkMock.getQueryCallCount()).toBe(1);
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      expect.objectContaining({ id: 'default', source: 'sdk' }),
    ]);
  });

  it('coalesces concurrent SDK catalog refreshes', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/mock/claude'),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    sdkMock.setMockMessages([{ type: 'system', subtype: 'init' }], { appendResult: false });
    sdkMock.setMockSupportedModels([
      { value: 'default', displayName: 'Default', description: 'Native model' },
    ]);

    const services = await createClaudeWorkspaceServices(plugin as any, createVaultAdapter() as any);
    await Promise.all([
      services.modelCatalog.refreshModels({ plugin: plugin as any, settings }),
      services.modelCatalog.refreshModels({ plugin: plugin as any, settings }),
    ]);

    expect(sdkMock.getQueryCallCount()).toBe(1);
  });

  it('refreshes Claude models through the Anthropic Models API when an API key is configured', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      environmentVariables: 'ANTHROPIC_API_KEY=test-key',
    });
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      recordDebugLog: jest.fn(),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    jest.mocked(requestUrl).mockResolvedValue({
      json: {
        data: [
          {
            id: 'claude-fable-5',
            display_name: 'Claude Fable 5',
            max_input_tokens: 1000000,
            type: 'model',
          },
          {
            id: 'claude-sonnet-5',
            display_name: 'Claude Sonnet 5',
            max_input_tokens: 1000000,
            type: 'model',
          },
        ],
        has_more: false,
      },
      status: 200,
    } as any);

    const services = await createClaudeWorkspaceServices(plugin as any, createVaultAdapter() as any);
    const changed = await services.modelCatalog.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(true);
    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key',
      },
      method: 'GET',
    });
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      {
        displayName: 'Claude Fable 5',
        id: 'claude-fable-5',
        maxInputTokens: 1000000,
        source: 'api',
      },
      {
        displayName: 'Claude Sonnet 5',
        id: 'claude-sonnet-5',
        maxInputTokens: 1000000,
        source: 'api',
      },
    ]);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('keeps the static fallback when no Anthropic API key is configured', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    const plugin = {
      app: { vault: { adapter: { basePath: '/vault' } } },
      recordDebugLog: jest.fn(),
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };

    const services = await createClaudeWorkspaceServices(plugin as any, createVaultAdapter() as any);
    const changed = await services.modelCatalog.refreshModels({
      plugin: plugin as any,
      settings,
    });

    expect(changed).toBe(false);
    expect(requestUrl).not.toHaveBeenCalled();
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([]);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});
