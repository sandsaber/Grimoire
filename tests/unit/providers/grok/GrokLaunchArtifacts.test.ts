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

  it('copies the vault Grok config into an auxiliary home and keys restarts to it', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-grok-artifacts-'));
    const sourceConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'config.toml');
    await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true });
    await fs.writeFile(sourceConfigPath, '[model.grok-local]\nmodel = "local"\n', 'utf8');

    const baseParams = {
      artifactsSubdir: 'grok/auxiliary/title-gen',
      permissionMode: 'plan' as const,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };
    const first = await prepareGrokLaunchArtifacts(baseParams);
    const copiedConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'auxiliary', 'title-gen', 'config.toml');

    await expect(fs.readFile(copiedConfigPath, 'utf8')).resolves.toContain('[model.grok-local]');
    await fs.writeFile(sourceConfigPath, '[model.grok-local]\nmodel = "changed"\n', 'utf8');
    const second = await prepareGrokLaunchArtifacts(baseParams);

    expect(second.launchKey).not.toBe(first.launchKey);
    await expect(fs.readFile(copiedConfigPath, 'utf8')).resolves.toContain('model = "changed"');
  });

  it('copies a config that decides nothing Grimoire owns byte for byte', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-grok-verbatim-'));
    const sourceConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'config.toml');
    const source = '# my local slot\n[model.grok-local]\nmodel = "local"\n';
    await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true });
    await fs.writeFile(sourceConfigPath, source, 'utf8');

    await prepareGrokLaunchArtifacts({
      artifactsSubdir: 'grok/auxiliary/title-gen',
      permissionMode: 'plan',
      settings: { customPrompt: '', mediaFolder: '', userName: '', vaultPath: tmpRoot },
      workspaceRoot: tmpRoot,
    });

    const copiedConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'auxiliary', 'title-gen', 'config.toml');
    await expect(fs.readFile(copiedConfigPath, 'utf8')).resolves.toBe(source);
  });

  it('drops the permission keys Grimoire decides for the auxiliary launch', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-grok-permission-'));
    const sourceConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'config.toml');
    await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true });
    await fs.writeFile(sourceConfigPath, [
      '[ui]',
      'permission_mode = "always-approve"',
      'yolo = true',
      'max_thoughts_width = 120',
      '',
      '[model.grok-local]',
      'model = "local"',
      '',
    ].join('\n'), 'utf8');

    await prepareGrokLaunchArtifacts({
      artifactsSubdir: 'grok/auxiliary/title-gen',
      permissionMode: 'plan',
      settings: { customPrompt: '', mediaFolder: '', userName: '', vaultPath: tmpRoot },
      workspaceRoot: tmpRoot,
    });

    const copiedConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'auxiliary', 'title-gen', 'config.toml');
    const copied = await fs.readFile(copiedConfigPath, 'utf8');
    // Grok resolves config.toml above managed_config.toml, so these two would decide the
    // auxiliary's permission mode instead of the plan/ask mode it was launched with.
    expect(copied).not.toContain('permission_mode');
    expect(copied).not.toContain('yolo');
    // Everything the copy exists for survives.
    expect(copied).toContain('[model.grok-local]');
    expect(copied).toContain('max_thoughts_width');
  });

  it('skips a config Grok itself could not parse', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-grok-broken-'));
    const sourceConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'config.toml');
    await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true });
    await fs.writeFile(sourceConfigPath, 'this is not = valid toml [[[', 'utf8');

    const result = await prepareGrokLaunchArtifacts({
      artifactsSubdir: 'grok/auxiliary/title-gen',
      permissionMode: 'plan',
      settings: { customPrompt: '', mediaFolder: '', userName: '', vaultPath: tmpRoot },
      workspaceRoot: tmpRoot,
    });

    const copiedConfigPath = path.join(tmpRoot, '.grimoire', 'grok', 'auxiliary', 'title-gen', 'config.toml');
    await expect(fs.readFile(copiedConfigPath, 'utf8')).rejects.toThrow();
    expect(result.launchKey).not.toContain('valid toml');
  });
});
