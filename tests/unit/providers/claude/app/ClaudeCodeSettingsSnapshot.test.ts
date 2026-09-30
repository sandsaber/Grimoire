import { HomeFileAdapter } from '@/core/storage/HomeFileAdapter';
import { readClaudeCodeSettingsSnapshot } from '@/providers/claude/app/ClaudeCodeSettingsSnapshot';
import { updateClaudeProviderSettings } from '@/providers/claude/settings';

const mockHomeFiles = new Map<string, string>();
jest.mock('@/core/storage/HomeFileAdapter', () => ({
  HomeFileAdapter: jest.fn().mockImplementation(() => ({
    exists: async (path: string) => mockHomeFiles.has(path),
    read: async (path: string) => mockHomeFiles.get(path),
  })),
}));

describe('readClaudeCodeSettingsSnapshot', () => {
  beforeEach(() => { mockHomeFiles.clear(); jest.clearAllMocks(); });

  function setup() {
    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { loadUserSettings: true });
    const files = new Map<string, string>();
    const adapter = {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => files.get(path)!,
    };
    return { settings, files, read: () => readClaudeCodeSettingsSnapshot(settings, adapter, '/vault') };
  }

  it('reads user, project and local settings in CLI precedence order', async () => {
    const { files, read } = setup();
    mockHomeFiles.set('settings.json', JSON.stringify({ model: 'user', env: { A: 'user', B: 'user' } }));
    files.set('.claude/settings.json', JSON.stringify({ model: 'project', env: { A: 'project', C: 'project' } }));
    files.set('.claude/settings.local.json', JSON.stringify({ model: 'local', env: { A: 'local' } }));
    expect(await read()).toEqual(expect.objectContaining({ model: 'local', env: { A: 'local', B: 'user', C: 'project' } }));
  });

  it('drops removed values on the next read instead of merging with a previous snapshot', async () => {
    const { read } = setup();
    mockHomeFiles.set('settings.json', JSON.stringify({ model: 'old', env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'old' } }));
    expect((await read()).model).toBe('old');
    mockHomeFiles.set('settings.json', JSON.stringify({ env: { ANTHROPIC_MODEL: 'new/vendor-model' } }));
    expect(await read()).toEqual(expect.objectContaining({ model: '', env: { ANTHROPIC_MODEL: 'new/vendor-model' } }));
  });

  it('honors the user-settings opt-out', async () => {
    const { settings, read } = setup();
    updateClaudeProviderSettings(settings, { loadUserSettings: false });
    mockHomeFiles.set('settings.json', JSON.stringify({ model: 'ignored' }));
    expect((await read()).model).toBe('');
    expect(HomeFileAdapter).not.toHaveBeenCalled();
  });

  it('resolves the configured Claude profile directory', async () => {
    const { settings, read } = setup();
    updateClaudeProviderSettings(settings, { environmentVariables: 'CLAUDE_CONFIG_DIR=profiles/team' });
    await read();
    expect(HomeFileAdapter).toHaveBeenCalledWith('/vault/profiles/team');
  });

  it('rejects malformed settings without returning a partial snapshot', async () => {
    const { files, read } = setup();
    files.set('.claude/settings.json', '{broken');
    await expect(read()).rejects.toThrow();
  });
});
