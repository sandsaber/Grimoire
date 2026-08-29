import * as sdkModule from '@anthropic-ai/claude-agent-sdk';

import type GrimoirePlugin from '@/main';
import { probeRuntimeCommands } from '@/providers/claude/commands/probeRuntimeCommands';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  setMockSupportedCommands: (commands: Array<{ name: string; description: string; argumentHint?: string }>) => void;
  resetMockMessages: () => void;
  getLastOptions: () => sdkModule.Options | undefined;
};

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

jest.mock('@/utils/env', () => ({
  parseEnvironmentVariables: jest.fn().mockReturnValue({ PATH: '/usr/bin' }),
  getEnhancedPath: jest.fn().mockReturnValue('/usr/bin:/mock/bin'),
  findNodeExecutable: jest.fn().mockReturnValue('/usr/bin/node'),
}));

function createMockPlugin(settings: Record<string, unknown> = {}): GrimoirePlugin {
  return {
    app: {},
    settings,
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/mock/claude'),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
  } as unknown as GrimoirePlugin;
}

describe('probeRuntimeCommands', () => {
  beforeEach(() => {
    sdkMock.resetMockMessages();
  });

  it('uses the same settingSources as the Claude runtime when user settings are disabled', async () => {
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'probe-session' },
    ], { appendResult: false });
    sdkMock.setMockSupportedCommands([
      { name: 'commit', description: 'Create a commit', argumentHint: '' },
    ]);

    const commands = await probeRuntimeCommands(createMockPlugin({
      providerConfigs: { claude: { loadUserSettings: false } },
    }));

    expect(commands).toEqual([{
      id: 'sdk:commit',
      name: 'commit',
      description: 'Create a commit',
      argumentHint: '',
      content: '',
      source: 'sdk',
    }]);
    expect(sdkMock.getLastOptions()?.settingSources).toEqual(['project', 'local']);
  });

  it('includes user settings in the probe when the runtime would include them', async () => {
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'probe-session' },
    ], { appendResult: false });
    sdkMock.setMockSupportedCommands([]);

    await probeRuntimeCommands(createMockPlugin({
      providerConfigs: { claude: { loadUserSettings: true, enableChrome: true } },
    }));

    const options = sdkMock.getLastOptions();
    expect(options?.settingSources).toEqual(['user', 'project', 'local']);
    expect(options?.extraArgs).toEqual({ chrome: null });
  });

  it('records why it gave up when no CLI path is resolved', async () => {
    const recordDebugLog = jest.fn();
    const plugin = createMockPlugin();
    (plugin as unknown as { recordDebugLog: jest.Mock }).recordDebugLog = recordDebugLog;
    jest.mocked(plugin.getResolvedProviderCliPath).mockReturnValue(null);

    const commands = await probeRuntimeCommands(plugin);

    expect(commands).toEqual([]);
    expect(recordDebugLog).toHaveBeenCalledWith({
      data: { providerId: 'claude', reason: 'no_cli_path' },
      event: 'commandCatalog.probe.skipped',
      level: 'debug',
      scope: 'provider.claude',
    });
  });
});
