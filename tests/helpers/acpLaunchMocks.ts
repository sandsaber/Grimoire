export const WINDOWS_UNICODE_VAULT = 'C:\\Users\\Name\\OneDrive - 公司\\Vault 中文 (test)';

export interface AcpLaunchMockPluginParams {
  cliPath: string;
  /**
   * The three ACP CLIs this helper launches for.
   *
   * Kimi Code was missing, which is why it had no launch row: the helper it
   * would have used did not admit it.
   */
  providerId: 'opencode' | 'mimocode' | 'kimicode';
  vaultPath?: string;
}

export function createAcpLaunchMockPlugin(params: AcpLaunchMockPluginParams): any {
  return {
    settings: {
      providerConfigs: {
        [params.providerId]: {
          enabled: true,
        },
      },
    },
    manifest: { version: '0.0.0-test' },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue(params.cliPath),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    app: {
      vault: {
        adapter: {
          basePath: params.vaultPath ?? WINDOWS_UNICODE_VAULT,
        },
      },
    },
  };
}
