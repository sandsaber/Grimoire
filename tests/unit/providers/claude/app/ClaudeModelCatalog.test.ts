import { setImmediate } from 'node:timers';

import { requestUrl } from 'obsidian';

import { getCliBinaryFingerprint } from '@/core/providers/cliBinaryFingerprint';
import { createClaudeModelCatalog as createCatalog } from '@/providers/claude/app/ClaudeModelCatalog';
import { probeRuntimeModels } from '@/providers/claude/commands/probeRuntimeModels';
import { getClaudeModelOptions } from '@/providers/claude/modelOptions';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '@/providers/claude/settings';

jest.mock('@/providers/claude/commands/probeRuntimeModels', () => ({ probeRuntimeModels: jest.fn() }));
let mockUserSettings: Record<string, unknown> = {};
jest.mock('@/core/storage/HomeFileAdapter', () => ({
  HomeFileAdapter: jest.fn().mockImplementation(() => ({
    exists: async () => true,
    read: async () => JSON.stringify(mockUserSettings),
  })),
}));
jest.mock('@/core/providers/cliBinaryFingerprint', () => ({
  getCliBinaryFingerprint: jest.fn().mockReturnValue(''),
}));

const mockedProbe = jest.mocked(probeRuntimeModels);
const mockedBinaryFingerprint = jest.mocked(getCliBinaryFingerprint);

function createPlugin(settings: Record<string, unknown>, saveSettings = jest.fn().mockResolvedValue(undefined)) {
  return {
    app: { vault: { adapter: { basePath: '/vault' } } },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/claude'),
    recordDebugLog: jest.fn(),
    saveSettings,
    settings,
  } as any;
}

const adapter = { exists: jest.fn().mockResolvedValue(false), read: jest.fn() };
const createClaudeModelCatalog = (plugin: any) => createCatalog(plugin, adapter);

describe('ClaudeModelCatalog', () => {
  beforeEach(() => {
    mockUserSettings = {};
    adapter.exists.mockReset().mockResolvedValue(false);
    adapter.read.mockReset();
    jest.mocked(requestUrl).mockReset();
    mockedProbe.mockReset();
    mockedBinaryFingerprint.mockReset().mockReturnValue('');
  });

  afterEach(() => jest.useRealTimers());

  it('prefers a custom endpoint catalog over SDK slots and uses bearer authentication', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      environmentVariables: 'ANTHROPIC_BASE_URL=https://gateway.example/anthropic\nANTHROPIC_AUTH_TOKEN=test-token\nANTHROPIC_DEFAULT_OPUS_MODEL=vendor/reasoner',
    });
    mockedProbe.mockResolvedValue([{ id: 'opus', displayName: 'Old name', source: 'sdk' }]);
    jest.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [
      { id: 'vendor/reasoner', display_name: 'Reasoner' },
      { id: 'other/new-model', display_name: 'New model' },
    ] } } as any);
    const plugin = createPlugin(settings);

    await expect(createClaudeModelCatalog(plugin).refreshModels({ plugin, settings, force: true })).resolves.toBe('refreshed');

    expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://gateway.example/anthropic/v1/models?limit=1000',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
    expect(mockedProbe).not.toHaveBeenCalled();
    expect(getClaudeModelOptions(settings)).toEqual([
      expect.objectContaining({ value: 'vendor/reasoner', label: 'Reasoner' }),
      expect.objectContaining({ value: 'other/new-model', label: 'New model' }),
      expect.objectContaining({ value: 'opus', label: 'Reasoner' }),
    ]);
  });

  it('does not commit a completed probe after its cache key becomes stale', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, environmentVariables: 'A=1' });
    let resolveProbe!: (models: any[]) => void;
    mockedProbe.mockReturnValue(new Promise(resolve => { resolveProbe = resolve; }));
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    const refresh = catalog.refreshModels({ plugin, settings });
    await new Promise(resolve => setImmediate(resolve));
    updateClaudeProviderSettings(settings, { environmentVariables: 'A=2' });
    resolveProbe([{ id: 'default', displayName: 'Default', source: 'sdk' }]);

    await expect(refresh).resolves.toBe('failed');
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([]);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('reloads user settings on picker open and removes a deleted Fable selection', async () => {
    mockUserSettings = { model: 'claude-fable-5-1[1m]' };
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, respectProjectSettings: true });
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Before', source: 'sdk' }]);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);
    await catalog.refreshModels({ plugin, settings });
    expect(getClaudeModelOptions(settings).map(model => model.value)).toContain('claude-fable-5-1[1m]');

    mockUserSettings = { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'any-vendor/new-model' } };
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'New model', resolvedModel: 'any-vendor/new-model', source: 'sdk' }]);
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('refreshed');

    expect(mockedProbe).toHaveBeenCalledTimes(2);
    expect(getClaudeModelOptions(settings)).toEqual([expect.objectContaining({ value: 'sonnet', label: 'New model' })]);
    expect(getClaudeProviderSettings(settings).projectSettingsSnapshot.model).toBe('');
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('skipped');
    expect(mockedProbe).toHaveBeenCalledTimes(2);

    mockUserSettings = { model: 'claude-fable-5-1[1m]' };
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Before', source: 'sdk' }]);
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('refreshed');
    expect(mockedProbe).toHaveBeenCalledTimes(3);
    expect(getClaudeModelOptions(settings)[0].label).toBe('Before');
  });

  it.each([404, 401, 500])('falls back to SDK discovery when a custom endpoint returns %s', async status => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, environmentVariables: 'ANTHROPIC_BASE_URL=https://gateway.example/v1' });
    jest.mocked(requestUrl).mockResolvedValue({ status, json: {} } as any);
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Vendor model', source: 'sdk' }]);
    const plugin = createPlugin(settings);
    await expect(createClaudeModelCatalog(plugin).refreshModels({ plugin, settings })).resolves.toBe('refreshed');
    expect(getClaudeProviderSettings(settings).discoveredModels[0].source).toBe('sdk');
  });

  it('paginates a gateway catalog and replaces removed models on forced refresh', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, environmentVariables: 'ANTHROPIC_BASE_URL=https://gateway.example/v1/\nANTHROPIC_API_KEY=test-key\nANTHROPIC_DEFAULT_OPUS_MODEL=removed' });
    const request = jest.mocked(requestUrl);
    request.mockResolvedValueOnce({ status: 200, json: { data: [{ id: 'removed' }], has_more: true, last_id: 'removed' } } as any);
    request.mockResolvedValueOnce({ status: 200, json: { data: [{ id: 'kept', display_name: 'Before' }], has_more: false } } as any);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);
    await catalog.refreshModels({ plugin, settings });
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://gateway.example/v1/models?limit=1000&after_id=removed' }));
    request.mockResolvedValueOnce({ status: 200, json: { data: [{ id: 'kept', display_name: 'After' }], hasMore: true, lastId: 'kept' } } as any);
    request.mockResolvedValueOnce({ status: 200, json: { data: [{ id: 'added' }], hasMore: false } } as any);
    await catalog.refreshModels({ plugin, settings, force: true });
    expect(getClaudeModelOptions(settings)).toEqual([
      expect.objectContaining({ value: 'kept', label: 'After' }),
      expect.objectContaining({ value: 'added', label: 'added' }),
    ]);
  });

  it('uses an environment name only when the endpoint omits its display name', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, environmentVariables: 'ANTHROPIC_BASE_URL=http://localhost:1234\nANTHROPIC_DEFAULT_OPUS_MODEL=vendor/model\nANTHROPIC_DEFAULT_OPUS_MODEL_NAME=Fallback' });
    jest.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [{ id: 'vendor/model' }] } } as any);
    const plugin = createPlugin(settings);
    await createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });
    expect(getClaudeModelOptions(settings)[0].label).toBe('Fallback');
  });

  it('bounds an unresponsive endpoint before falling back to SDK models', async () => {
    jest.useFakeTimers();
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, environmentVariables: 'ANTHROPIC_BASE_URL=https://gateway.example' });
    jest.mocked(requestUrl).mockReturnValue(new Promise(() => {}) as ReturnType<typeof requestUrl>);
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Fallback', source: 'sdk' }]);
    const plugin = createPlugin(settings);
    const refresh = createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });
    await jest.advanceTimersByTimeAsync(10_001);
    await expect(refresh).resolves.toBe('refreshed');
    expect(mockedProbe).toHaveBeenCalledTimes(1);
  });

  it('rejects discovery if an external settings file changes while it is running', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    let resolveProbe!: (models: any[]) => void;
    mockedProbe.mockReturnValue(new Promise(resolve => { resolveProbe = resolve; }));
    const plugin = createPlugin(settings);
    const refresh = createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });
    await new Promise(resolve => setImmediate(resolve));
    mockUserSettings = { env: { ANTHROPIC_MODEL: 'new-provider/model' } };
    resolveProbe([{ id: 'old', displayName: 'Old', source: 'sdk' }]);
    await expect(refresh).resolves.toBe('failed');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps the previous snapshot and catalog when a settings file cannot be read', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, projectSettingsSnapshot: { model: 'old', env: {}, hash: '' }, discoveredModels: [{ id: 'old', displayName: 'Old', source: 'sdk' }] });
    adapter.exists.mockResolvedValue(true);
    adapter.read.mockRejectedValue(new Error('unreadable'));
    const plugin = createPlugin(settings);
    await expect(createClaudeModelCatalog(plugin).refreshModels({ plugin, settings, force: true })).resolves.toBe('failed');
    expect(getClaudeProviderSettings(settings).projectSettingsSnapshot.model).toBe('old');
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it('caches empty discovery attempts for ten minutes', async () => {
    jest.useFakeTimers();
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    mockedProbe.mockResolvedValue([]);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    await catalog.refreshModels({ plugin, settings });
    await catalog.refreshModels({ plugin, settings });

    expect(mockedProbe).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('restores the prior catalog if saving the refreshed result fails', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'legacy', displayName: 'Legacy', source: 'api' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'default', displayName: 'Default', source: 'sdk' }]);
    const plugin = createPlugin(settings, jest.fn().mockRejectedValue(new Error('disk full')));
    const catalog = createClaudeModelCatalog(plugin);

    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('failed');
    expect(mockedProbe).toHaveBeenCalledTimes(1);
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      { id: 'legacy', displayName: 'Legacy', source: 'api' },
    ]);
  });

  it('does not probe again after a reload when a catalog is already persisted', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'opus', displayName: 'Opus', source: 'sdk' }]);
    const plugin = createPlugin(settings);

    // A fresh catalog stands in for a plugin reload: the in-memory attempt log
    // starts empty, but the persisted models must still suppress the probe.
    const catalog = createClaudeModelCatalog(plugin);
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('skipped');

    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it('still probes after a reload when the resolved CLI path changed', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Sonnet', source: 'sdk' }]);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);
    plugin.getResolvedProviderCliPath.mockReturnValue('/opt/claude');

    await catalog.refreshModels({ plugin, settings });

    expect(mockedProbe).toHaveBeenCalledTimes(1);
  });
  it('suppresses the reload probe even when the CLI resolver is not reachable yet at construction', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'opus', displayName: 'Opus', source: 'sdk' }]);
    const plugin = createPlugin(settings);

    // Production ordering: the catalog is built inside createClaudeWorkspaceServices,
    // which runs *inside* ProviderWorkspaceRegistry.initialize(). The registry only
    // assigns this.services[providerId] after initialize() resolves, so
    // getCliResolver -> getResolvedProviderCliPath returns null while the catalog
    // is being constructed, and the real path only afterwards.
    plugin.getResolvedProviderCliPath.mockReturnValue(null);
    const catalog = createClaudeModelCatalog(plugin);
    plugin.getResolvedProviderCliPath.mockReturnValue('/claude');

    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('skipped');

    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it('still probes when the Claude config changed before the first refresh', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      environmentVariables: 'A=1',
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Sonnet', source: 'sdk' }]);
    const plugin = createPlugin(settings);

    plugin.getResolvedProviderCliPath.mockReturnValue(null);
    const catalog = createClaudeModelCatalog(plugin);
    plugin.getResolvedProviderCliPath.mockReturnValue('/claude');
    // The deferred seed only stands in for the unresolved CLI path. An
    // environment change since the load is a real invalidation, so it must
    // still reach the probe instead of being absorbed by the seed.
    updateClaudeProviderSettings(settings, { environmentVariables: 'A=2' });

    await catalog.refreshModels({ plugin, settings });

    expect(mockedProbe).toHaveBeenCalledTimes(1);
  });

  it('retries an empty discovery attempt once ten minutes have passed', async () => {
    jest.useFakeTimers();
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    mockedProbe.mockResolvedValue([]);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    await catalog.refreshModels({ plugin, settings });
    jest.advanceTimersByTime(10 * 60 * 1000 + 1);
    await catalog.refreshModels({ plugin, settings });

    expect(mockedProbe).toHaveBeenCalledTimes(2);
  });

  it('never re-probes a settled catalog on a timer', async () => {
    jest.useFakeTimers();
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'opus', displayName: 'Opus', source: 'sdk' }]);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    await catalog.refreshModels({ plugin, settings });
    // Well past the former ten-minute window: a picker opened an hour into a
    // session used to start a full SDK session here.
    jest.advanceTimersByTime(60 * 60 * 1000);
    await catalog.refreshModels({ plugin, settings });

    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it('re-probes a settled catalog when the caller forces it', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Sonnet', source: 'sdk' }]);
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('skipped');
    expect(mockedProbe).not.toHaveBeenCalled();

    await expect(catalog.refreshModels({ force: true, plugin, settings })).resolves.toBe('refreshed');
    expect(mockedProbe).toHaveBeenCalledTimes(1);
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      { id: 'sonnet', displayName: 'Sonnet', source: 'sdk' },
    ]);
  });

  it('re-probes when the CLI binary changes behind an unchanged path', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Sonnet', source: 'sdk' }]);
    mockedBinaryFingerprint.mockReturnValue('100:1');
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    await catalog.refreshModels({ plugin, settings });
    expect(mockedProbe).not.toHaveBeenCalled();

    // `npm install -g` over the same path: the file changes, the path does not.
    mockedBinaryFingerprint.mockReturnValue('120:2');
    await catalog.refreshModels({ plugin, settings });

    expect(mockedBinaryFingerprint).toHaveBeenCalledWith('/claude');
    expect(mockedProbe).toHaveBeenCalledTimes(1);
  });

  it('re-probes when the CLI binary changed while the plugin was not running', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    mockedProbe.mockResolvedValue([{ id: 'opus', displayName: 'Opus', source: 'sdk' }]);
    mockedBinaryFingerprint.mockReturnValue('100:1');
    const plugin = createPlugin(settings);

    // First session: discovery runs and records which key produced the catalog.
    await createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });
    expect(mockedProbe).toHaveBeenCalledTimes(1);
    expect(getClaudeProviderSettings(settings).discoveredModelsFingerprint).not.toBe('');

    // Obsidian was closed, the user ran `npm install -g`, and reopened it. The
    // new binary is already in place while the catalog is constructed, so both
    // the seed and the lookup compute '120:2' - the in-memory key comparison
    // cannot see the change, and with no timer left it would never self-heal.
    mockedBinaryFingerprint.mockReturnValue('120:2');
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Sonnet', source: 'sdk' }]);
    await createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });

    expect(mockedProbe).toHaveBeenCalledTimes(2);
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([
      { id: 'sonnet', displayName: 'Sonnet', source: 'sdk' },
    ]);
  });

  it('re-probes when the CLI path changed while the plugin was not running', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });
    mockedProbe.mockResolvedValue([{ id: 'opus', displayName: 'Opus', source: 'sdk' }]);
    const plugin = createPlugin(settings);

    await createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });
    expect(mockedProbe).toHaveBeenCalledTimes(1);

    // The user switched install channel between sessions, so the path already
    // resolves to the new location when the catalog is constructed.
    plugin.getResolvedProviderCliPath.mockReturnValue('/opt/claude');
    await createClaudeModelCatalog(plugin).refreshModels({ plugin, settings });

    expect(mockedProbe).toHaveBeenCalledTimes(2);
  });

  it('keeps trusting a catalog persisted before the fingerprint existed', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, {
      enabled: true,
      discoveredModels: [{ id: 'opus', displayName: 'Opus', source: 'sdk' }],
    });
    mockedProbe.mockResolvedValue([{ id: 'sonnet', displayName: 'Sonnet', source: 'sdk' }]);
    const plugin = createPlugin(settings);

    // No fingerprint on disk: migrating must not cost a probe, and must not
    // force a settings write either, so the catalog is trusted exactly as
    // before. It gains a recorded baseline at its next real discovery.
    const catalog = createClaudeModelCatalog(plugin);
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe('skipped');

    expect(mockedProbe).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});
