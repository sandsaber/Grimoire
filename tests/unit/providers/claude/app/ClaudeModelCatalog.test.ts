import { getCliBinaryFingerprint } from '@/core/providers/cliBinaryFingerprint';
import { createClaudeModelCatalog } from '@/providers/claude/app/ClaudeModelCatalog';
import { probeRuntimeModels } from '@/providers/claude/commands/probeRuntimeModels';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '@/providers/claude/settings';

jest.mock('@/providers/claude/commands/probeRuntimeModels', () => ({ probeRuntimeModels: jest.fn() }));
jest.mock('@/core/providers/cliBinaryFingerprint', () => ({
  getCliBinaryFingerprint: jest.fn().mockReturnValue(''),
}));

const mockedProbe = jest.mocked(probeRuntimeModels);
const mockedBinaryFingerprint = jest.mocked(getCliBinaryFingerprint);

function createPlugin(settings: Record<string, unknown>, saveSettings = jest.fn().mockResolvedValue(undefined)) {
  return {
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/claude'),
    recordDebugLog: jest.fn(),
    saveSettings,
    settings,
  } as any;
}

describe('ClaudeModelCatalog', () => {
  beforeEach(() => {
    mockedProbe.mockReset();
    mockedBinaryFingerprint.mockReset().mockReturnValue('');
  });

  afterEach(() => jest.useRealTimers());

  it('does not commit a completed probe after its cache key becomes stale', async () => {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true, environmentVariables: 'A=1' });
    let resolveProbe!: (models: any[]) => void;
    mockedProbe.mockReturnValue(new Promise(resolve => { resolveProbe = resolve; }));
    const plugin = createPlugin(settings);
    const catalog = createClaudeModelCatalog(plugin);

    const refresh = catalog.refreshModels({ plugin, settings });
    updateClaudeProviderSettings(settings, { environmentVariables: 'A=2' });
    resolveProbe([{ id: 'default', displayName: 'Default', source: 'sdk' }]);

    await expect(refresh).resolves.toBe(false);
    expect(getClaudeProviderSettings(settings).discoveredModels).toEqual([]);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
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

    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe(false);
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
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe(false);

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

    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe(false);

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

    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe(false);
    expect(mockedProbe).not.toHaveBeenCalled();

    await expect(catalog.refreshModels({ force: true, plugin, settings })).resolves.toBe(true);
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
    await expect(catalog.refreshModels({ plugin, settings })).resolves.toBe(false);

    expect(mockedProbe).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});
