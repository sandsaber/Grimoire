import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type GrimoirePlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { type GrokNativeModelCatalog, parseGrokModelsCliOutput } from './GrokModelsCache';
import { resolveManagedGrokHomePath } from './GrokPaths';
import { buildGrokRuntimeEnv } from './GrokRuntimeEnvironment';

const GROK_MODELS_TIMEOUT_MS = 30_000;
const GROK_MODELS_MAX_BUFFER_BYTES = 64 * 1024;

export type GrokModelsCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string }>;

async function defaultGrokModelsCommandRunner(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
): Promise<{ stdout: string }> {
  // Lazily bind so Jest suites that mock `node:child_process` without execFile
  // can still import the Grok workspace registration.
  return promisify(execFile)(command, [...args], options);
}

export async function discoverGrokModelsFromCli(
  plugin: GrimoirePlugin,
  run: GrokModelsCommandRunner = defaultGrokModelsCommandRunner,
): Promise<GrokNativeModelCatalog> {
  const command = plugin.getResolvedProviderCliPath('grok') ?? 'grok';
  const cwd = plugin.app ? getVaultPath(plugin.app) ?? process.cwd() : process.cwd();
  const runtimeEnv = buildGrokRuntimeEnv(
    plugin.settings,
    command,
    resolveManagedGrokHomePath(cwd),
  );

  plugin.recordDebugLog?.({
    data: {
      command,
      providerId: 'grok',
    },
    event: 'models.spawn',
    level: 'debug',
    scope: 'provider.grok',
  });

  try {
    const { stdout } = await run(command, ['models'], {
      cwd,
      env: runtimeEnv,
      maxBuffer: GROK_MODELS_MAX_BUFFER_BYTES,
      timeout: GROK_MODELS_TIMEOUT_MS,
      windowsHide: true,
    });
    const catalog = parseGrokModelsCliOutput(stdout);
    plugin.recordDebugLog?.({
      data: {
        defaultModelId: catalog.defaultModelId,
        modelCount: catalog.models.length,
        modelIds: catalog.models.map((model) => model.rawId).slice(0, 12),
        providerId: 'grok',
      },
      event: catalog.models.length > 0 ? 'models.parsed' : 'models.empty',
      level: catalog.models.length > 0 ? 'info' : 'warn',
      scope: 'provider.grok',
    });
    return catalog;
  } catch (error) {
    plugin.recordDebugLog?.({
      data: {
        command,
        providerId: 'grok',
      },
      error,
      event: 'models.spawnError',
      level: 'warn',
      scope: 'provider.grok',
    });
    return { defaultModelId: null, models: [] };
  }
}
