import {
  getClaudeProviderSettings,
  snapshotClaudeCodeSettings,
  updateClaudeProviderSettings,
} from '@/providers/claude/settings';

describe('Claude provider settings', () => {
  describe('snapshotClaudeCodeSettings', () => {
    it('merges user settings with project settings and lets project values win', () => {
      const snapshot = snapshotClaudeCodeSettings({
        includeUserSettings: true,
        user: {
          model: 'user-model',
          env: {
            ANTHROPIC_MODEL: 'user-env-model',
            ANTHROPIC_BASE_URL: 'https://user.example.com',
          },
        },
        project: {
          model: 'project-model',
          env: {
            ANTHROPIC_MODEL: 'project-env-model',
          },
        },
      });

      expect(snapshot.model).toBe('project-model');
      expect(snapshot.env).toEqual({
        ANTHROPIC_MODEL: 'project-env-model',
        ANTHROPIC_BASE_URL: 'https://user.example.com',
      });
    });

    it('ignores user settings when user settings are disabled', () => {
      const snapshot = snapshotClaudeCodeSettings({
        includeUserSettings: false,
        user: {
          model: 'user-model',
          env: {
            ANTHROPIC_MODEL: 'user-env-model',
          },
        },
        project: {
          model: '',
          env: {},
        },
      });

      expect(snapshot.model).toBe('');
      expect(snapshot.env).toEqual({});
    });
  });
  describe('discoveredCommands', () => {
    it('defaults to an empty list and an empty fingerprint', () => {
      const settings: Record<string, unknown> = {};

      expect(getClaudeProviderSettings(settings).discoveredCommands).toEqual([]);
      expect(getClaudeProviderSettings(settings).discoveredCommandsFingerprint).toBe('');
    });

    it('round-trips commands and the fingerprint they came from', () => {
      const settings: Record<string, unknown> = {};

      updateClaudeProviderSettings(settings, {
        discoveredCommands: [
          { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
        ],
        discoveredCommandsFingerprint: 'a1b2c3d4',
      });

      expect(getClaudeProviderSettings(settings).discoveredCommands).toEqual([
        { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
      ]);
      expect(getClaudeProviderSettings(settings).discoveredCommandsFingerprint).toBe('a1b2c3d4');
    });

    it('drops malformed persisted entries instead of trusting them', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          claude: {
            discoveredCommands: [
              { id: 'sdk:ok', name: 'ok', content: '' },
              { id: 'sdk:no-name', content: '' },
              'not-an-object',
              null,
            ],
            discoveredCommandsFingerprint: 42,
          },
        },
      };

      expect(getClaudeProviderSettings(settings).discoveredCommands).toEqual([
        { id: 'sdk:ok', name: 'ok', content: '', source: 'sdk' },
      ]);
      expect(getClaudeProviderSettings(settings).discoveredCommandsFingerprint).toBe('');
    });
  });

  describe('discovered command normalization', () => {
    it('trims names and drops a repeated id', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          claude: {
            discoveredCommands: [
              { id: ' sdk:commit ', name: ' commit ', content: '' },
              { id: 'sdk:commit', name: 'commit-again', content: '' },
            ],
            discoveredCommandsFingerprint: 'fp',
          },
        },
      };

      // An untrimmed name inserts as `/ commit `, and a repeated id shows as
      // two identical dropdown rows.
      expect(getClaudeProviderSettings(settings).discoveredCommands).toEqual([
        { id: 'sdk:commit', name: 'commit', content: '', source: 'sdk' },
      ]);
    });
  });

  describe('discovered models fingerprint', () => {
    it('defaults to an empty string and keeps a persisted one', () => {
      const settings: Record<string, unknown> = {};

      expect(getClaudeProviderSettings(settings).discoveredModelsFingerprint).toBe('');

      updateClaudeProviderSettings(settings, { discoveredModelsFingerprint: 'a1b2c3d4' });

      expect(getClaudeProviderSettings(settings).discoveredModelsFingerprint).toBe('a1b2c3d4');
    });

    it('ignores a non-string persisted fingerprint', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: { claude: { discoveredModelsFingerprint: 42 } },
      };

      expect(getClaudeProviderSettings(settings).discoveredModelsFingerprint).toBe('');
    });
  });
});
