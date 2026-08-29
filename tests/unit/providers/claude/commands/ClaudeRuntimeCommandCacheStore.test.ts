import type { SlashCommand } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { createClaudeRuntimeCommandCacheStore } from '@/providers/claude/commands/ClaudeRuntimeCommandCacheStore';
import { getClaudeProviderSettings } from '@/providers/claude/settings';

function createPlugin(overrides: Record<string, unknown> = {}): {
  plugin: GrimoirePlugin;
  saveSettings: jest.Mock;
} {
  const saveSettings = jest.fn(async () => undefined);
  const plugin = {
    getResolvedProviderCliPath: jest.fn(() => '/usr/local/bin/claude'),
    saveSettings,
    settings: {
      providerConfigs: {
        claude: {
          environmentVariables: 'ANTHROPIC_API_KEY=example-key',
          ...overrides,
        },
      },
    },
  } as unknown as GrimoirePlugin;
  return { plugin, saveSettings };
}

const SDK_COMMANDS: SlashCommand[] = [
  { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
];

describe('createClaudeRuntimeCommandCacheStore', () => {
  it('returns null when nothing has been cached yet', () => {
    const { plugin } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);

    expect(store.read()).toBeNull();
  });

  it('round-trips a written record', async () => {
    const { plugin, saveSettings } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);

    await store.write({ commands: SDK_COMMANDS, fingerprint: store.currentFingerprint() });

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(store.read()).toEqual({
      commands: SDK_COMMANDS,
      fingerprint: store.currentFingerprint(),
    });
  });

  it('does not write when the record already on disk is identical', async () => {
    const { plugin, saveSettings } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    const record = { commands: SDK_COMMANDS, fingerprint: store.currentFingerprint() };

    await store.write(record);
    expect(saveSettings).toHaveBeenCalledTimes(1);

    // A live session hands the same list over on every dropdown open, and each
    // write is a file the user's vault sync sees.
    await store.write(record);
    await store.write(record);

    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('writes again once the list actually changes', async () => {
    const { plugin, saveSettings } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    const fingerprint = store.currentFingerprint();

    await store.write({ commands: SDK_COMMANDS, fingerprint });
    await store.write({
      commands: [
        ...SDK_COMMANDS,
        { id: 'sdk:review', name: 'review', content: '', source: 'sdk' },
      ],
      fingerprint,
    });

    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(getClaudeProviderSettings(plugin.settings).discoveredCommands).toHaveLength(2);
  });

  it('changes the fingerprint when the CLI path changes', () => {
    const { plugin } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    const before = store.currentFingerprint();

    jest.mocked(plugin.getResolvedProviderCliPath).mockReturnValue('/opt/other/claude');

    expect(store.currentFingerprint()).not.toBe(before);
  });

  it('changes the fingerprint when the environment changes', () => {
    const { plugin } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    const before = store.currentFingerprint();

    (plugin.settings as unknown as {
      providerConfigs: { claude: Record<string, unknown> };
    }).providerConfigs.claude.environmentVariables = 'ANTHROPIC_API_KEY=other-example-key';

    expect(store.currentFingerprint()).not.toBe(before);
  });

  it('never persists raw environment values, only a digest', async () => {
    const { plugin } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);

    await store.write({ commands: SDK_COMMANDS, fingerprint: store.currentFingerprint() });

    const persisted = getClaudeProviderSettings(plugin.settings);
    expect(persisted.discoveredCommandsFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(persisted.discoveredCommands)).not.toContain('example-key');
    expect(persisted.discoveredCommandsFingerprint).not.toContain('example-key');
  });

  it('rolls back when the settings save is rejected', async () => {
    const { plugin, saveSettings } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    saveSettings.mockRejectedValueOnce(new Error('vault is read-only'));

    await expect(store.write({ commands: SDK_COMMANDS, fingerprint: 'fp' })).rejects.toThrow();

    // Memory must not claim a record that disk never took: the next unrelated
    // save from anywhere in the plugin would quietly persist it.
    expect(getClaudeProviderSettings(plugin.settings).discoveredCommands).toEqual([]);
    expect(store.read()).toBeNull();
  });

  it('keeps the persisted list when clearing cannot be saved', async () => {
    const { plugin, saveSettings } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    await store.write({ commands: SDK_COMMANDS, fingerprint: store.currentFingerprint() });
    saveSettings.mockRejectedValueOnce(new Error('vault is read-only'));

    await expect(store.clear()).rejects.toThrow();

    // Memory cleared while disk kept the list would resurrect it on restart.
    expect(store.read()?.commands).toEqual(SDK_COMMANDS);
  });

  it('clears both the list and the fingerprint', async () => {
    const { plugin } = createPlugin();
    const store = createClaudeRuntimeCommandCacheStore(plugin);
    await store.write({ commands: SDK_COMMANDS, fingerprint: store.currentFingerprint() });

    await store.clear();

    expect(store.read()).toBeNull();
  });

  it('drops a record that carries no fingerprint', () => {
    const { plugin } = createPlugin({
      discoveredCommands: SDK_COMMANDS,
      discoveredCommandsFingerprint: '',
    });
    const store = createClaudeRuntimeCommandCacheStore(plugin);

    expect(store.read()).toBeNull();
  });
});
