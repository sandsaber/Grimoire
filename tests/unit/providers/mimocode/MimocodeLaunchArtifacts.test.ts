import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  MIMOCODE_FULL_ACCESS_MODE_ID,
  MIMOCODE_SAFE_MODE_ID,
} from '../../../../src/providers/mimocode/modes';
import {
  buildMimocodeManagedConfig,
  prepareMimocodeLaunchArtifacts,
} from '../../../../src/providers/mimocode/runtime/MimocodeLaunchArtifacts';

describe('buildMimocodeManagedConfig', () => {
  it('pins MiMoCode build, Auto-approve, safe, and plan prompts to the managed prompt text', () => {
    expect(buildMimocodeManagedConfig({}, 'Managed system prompt.', 'Test User')).toEqual({
      $schema: 'https://mimocode.ai/config.json',
      agent: {
        build: {
          prompt: 'Managed system prompt.',
        },
        [MIMOCODE_FULL_ACCESS_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: 'Managed system prompt.',
        },
        [MIMOCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'allow',
            question: 'allow',
            write: 'ask',
          },
          prompt: 'Managed system prompt.',
        },
        plan: {
          prompt: 'Managed system prompt.',
        },
      },
      username: 'Test User',
    });
  });

  it('can create a dedicated aux agent and default it for the process', () => {
    expect(buildMimocodeManagedConfig(
      {},
      'Aux system prompt.',
      undefined,
      [{
        definition: {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
        },
        id: 'grimoire-aux-readonly',
      }],
      'grimoire-aux-readonly',
    )).toEqual({
      $schema: 'https://mimocode.ai/config.json',
      agent: {
        'grimoire-aux-readonly': {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
          prompt: 'Aux system prompt.',
        },
      },
      default_agent: 'grimoire-aux-readonly',
    });
  });

  it('merges the user config instead of replacing it', () => {
    expect(buildMimocodeManagedConfig({
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    }, 'Managed system prompt.')).toEqual({
      $schema: 'https://mimocode.ai/config.json',
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
          prompt: 'Managed system prompt.',
        },
        [MIMOCODE_FULL_ACCESS_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: 'Managed system prompt.',
        },
        [MIMOCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'allow',
            question: 'allow',
            write: 'ask',
          },
          prompt: 'Managed system prompt.',
        },
        plan: {
          prompt: 'Managed system prompt.',
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    });
  });
});

describe('prepareMimocodeLaunchArtifacts', () => {
  it('layers the managed prompt config on top of MIMOCODE_CONFIG', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-mimocode-artifacts-'));
    const baseConfigPath = path.join(tmpRoot, 'mimocode.base.json');
    await fs.writeFile(baseConfigPath, JSON.stringify({
      agent: {
        build: {
          model: 'openai/gpt-5',
        },
      },
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
    }), 'utf8');

    const result = await prepareMimocodeLaunchArtifacts({
      runtimeEnv: {
        HOME: tmpRoot,
        MIMOCODE_CONFIG: baseConfigPath,
      },
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: 'Test User',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.configPath).toBe(path.join(tmpRoot, '.grimoire', 'mimocode', 'config.json'));
    expect(result.systemPromptPath).toBe(path.join(tmpRoot, '.grimoire', 'mimocode', 'system.md'));
    expect(result.configContent).not.toContain('{file:');
    const generatedConfig = JSON.parse(result.configContent);
    expect(generatedConfig).toMatchObject({
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
      username: 'Test User',
    });
    const systemPromptFile = await fs.readFile(result.systemPromptPath, 'utf8');
    expect(generatedConfig.agent).toMatchObject({
      build: {
        model: 'openai/gpt-5',
        prompt: systemPromptFile,
      },
      [MIMOCODE_FULL_ACCESS_MODE_ID]: {
        mode: 'primary',
        permission: {
          plan_enter: 'allow',
          question: 'allow',
        },
        prompt: systemPromptFile,
      },
      [MIMOCODE_SAFE_MODE_ID]: {
        mode: 'primary',
        permission: {
          bash: 'ask',
          edit: 'ask',
          plan_enter: 'allow',
          question: 'allow',
        },
        prompt: systemPromptFile,
      },
      plan: {
        prompt: systemPromptFile,
      },
    });
  });

  it('keeps the launch key stable when the resolved default database is later passed as MIMOCODE_DB', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-mimocode-artifacts-'));
    const baseParams = {
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };
    const first = await prepareMimocodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
      },
    });

    const second = await prepareMimocodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
        MIMOCODE_DB: first.databasePath ?? undefined,
      },
    });

    expect(first.databasePath).toBe(second.databasePath);
    expect(first.launchKey).toBe(second.launchKey);
  });

  it('creates the resolved MiMoCode database directory before launch', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-mimocode-artifacts-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const databaseDir = path.join(xdgDataHome, 'mimocode');

    const result = await prepareMimocodeLaunchArtifacts({
      runtimeEnv: {
        HOME: path.join(tmpRoot, 'home'),
        XDG_DATA_HOME: xdgDataHome,
      },
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.databasePath).toBe(path.join(databaseDir, 'mimocode.db'));
    await expect(fs.access(databaseDir)).resolves.toBeUndefined();
  });
});
