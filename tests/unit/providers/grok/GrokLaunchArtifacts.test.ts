import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildGrokManagedConfigToml,
  prepareGrokLaunchArtifacts,
} from '../../../../src/providers/grok/runtime/GrokLaunchArtifacts';

describe('buildGrokManagedConfigToml', () => {
  it('writes the Grok Build ui permission_mode setting', () => {
    expect(buildGrokManagedConfigToml({
      permissionMode: 'always-approve',
    })).toContain('[ui]');
    expect(buildGrokManagedConfigToml({
      permissionMode: 'always-approve',
    })).toContain('permission_mode = "always-approve"');
    expect(buildGrokManagedConfigToml({
      permissionMode: 'ask',
    })).toContain('permission_mode = "ask"');
    expect(buildGrokManagedConfigToml({
      permissionMode: 'plan',
    })).toContain('permission_mode = "plan"');
  });

  it('defaults to ask when no permission mode is provided', () => {
    expect(buildGrokManagedConfigToml()).toContain('permission_mode = "ask"');
  });

  it('writes the selected Grok default model into managed config', () => {
    const config = buildGrokManagedConfigToml({
      defaultModel: 'grok-4.6',
      permissionMode: 'ask',
    });
    expect(config).toContain('[models]');
    expect(config).toContain('default = "grok-4.6"');
  });
});

describe('prepareGrokLaunchArtifacts', () => {
  it('writes managed_config.toml and system.md under .grimoire/grok', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-grok-artifacts-'));

    const result = await prepareGrokLaunchArtifacts({
      permissionMode: 'always-approve',
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: 'Test User',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.grokHomePath).toBe(path.join(tmpRoot, '.grimoire', 'grok'));
    expect(result.managedConfigPath).toBe(path.join(tmpRoot, '.grimoire', 'grok', 'managed_config.toml'));
    expect(result.systemPromptPath).toBe(path.join(tmpRoot, '.grimoire', 'grok', 'system.md'));
    expect(result.configContent).toContain('permission_mode = "always-approve"');
    await expect(fs.readFile(result.managedConfigPath, 'utf8')).resolves.toContain('[ui]');
    await expect(fs.readFile(result.systemPromptPath, 'utf8')).resolves.toContain('Grimoire');
  });

  it('keeps the launch key stable across repeated preparation', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-grok-artifacts-'));
    const baseParams = {
      permissionMode: 'ask' as const,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };
    const first = await prepareGrokLaunchArtifacts(baseParams);
    const second = await prepareGrokLaunchArtifacts(baseParams);

    expect(first.grokHomePath).toBe(second.grokHomePath);
    expect(first.launchKey).toBe(second.launchKey);
  });
});