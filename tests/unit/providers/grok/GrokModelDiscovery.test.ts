import { discoverGrokModelsFromCli } from '../../../../src/providers/grok/runtime/GrokModelDiscovery';

function createPlugin(): any {
  return {
    app: { vault: { adapter: { basePath: '/tmp/vault' } } },
    getResolvedProviderCliPath: () => '/usr/local/bin/grok',
    recordDebugLog: jest.fn(),
    settings: {},
  };
}

describe('discoverGrokModelsFromCli', () => {
  it('can be imported when child_process.execFile is unavailable', () => {
    expect(typeof discoverGrokModelsFromCli).toBe('function');
  });

  it('parses the live grok models command', async () => {
    const run = jest.fn().mockResolvedValue({
      stdout: 'Default model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n',
    });

    await expect(discoverGrokModelsFromCli(createPlugin(), run)).resolves.toEqual({
      defaultModelId: 'grok-4.6',
      models: [
        { label: 'Grok 4.6', rawId: 'grok-4.6' },
        { label: 'Grok 4.5', rawId: 'grok-4.5' },
      ],
    });
    expect(run).toHaveBeenCalledWith(
      '/usr/local/bin/grok',
      ['models'],
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('returns an empty catalog when the CLI cannot be spawned', async () => {
    const run = jest.fn().mockRejectedValue(new Error('not found'));

    await expect(discoverGrokModelsFromCli(createPlugin(), run)).resolves.toEqual({
      defaultModelId: null,
      models: [],
    });
  });
});
