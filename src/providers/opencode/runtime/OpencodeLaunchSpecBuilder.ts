import { resolveWslExecutablePath } from '@/utils/env';

import {
  inferWslDistroFromWindowsPath,
  resolveOpencodeExecutionTarget,
} from './OpencodeExecutionTargetResolver';
import type {
  OpencodeExecutionTarget,
  OpencodeLaunchSpec,
  OpencodePathMapper,
} from './opencodeLaunchTypes';
import { createOpencodePathMapper } from './OpencodePathMapper';

export interface BuildOpencodeLaunchSpecOptions {
  settings: Record<string, unknown>;
  resolvedCliCommand: string | null;
  hostVaultPath: string | null;
  env: NodeJS.ProcessEnv;
  hostPlatform?: NodeJS.Platform;
  resolveDefaultWslDistro?: () => string | undefined;
}

const OPENCODE_ACP_ARGS = Object.freeze(['acp']);

export function buildOpencodeLaunchSpec(
  options: BuildOpencodeLaunchSpecOptions,
): OpencodeLaunchSpec {
  const target = resolveOpencodeExecutionTarget({
    settings: options.settings,
    hostPlatform: options.hostPlatform,
    hostVaultPath: options.hostVaultPath,
    resolveDefaultWslDistro: options.resolveDefaultWslDistro,
  });
  const pathMapper = createOpencodePathMapper(target);
  const spawnCwd = options.hostVaultPath ?? process.cwd();

  const workspaceDistro = inferWslDistroFromWindowsPath(options.hostVaultPath);
  if (
    target.method === 'wsl'
    && target.distroName
    && workspaceDistro
    && target.distroName.toLowerCase() !== workspaceDistro.toLowerCase()
  ) {
    throw new Error(
      `WSL distro override "${target.distroName}" does not match workspace distro "${workspaceDistro}"`,
    );
  }

  if (target.method === 'wsl' && !target.distroName) {
    throw new Error(
      'Unable to determine the WSL distro. Set WSL distro override or configure a default WSL distro.',
    );
  }

  const targetCwd = pathMapper.toTargetPath(spawnCwd);

  if (!targetCwd) {
    throw new Error('WSL mode only supports Windows drive paths and \\\\wsl$ or \\\\wsl.localhost workspace paths');
  }

  const env = mapOpencodePathEnv(options.env, pathMapper, target);

  const resolvedCliCommand = options.resolvedCliCommand?.trim() || 'opencode';
  if (target.method === 'wsl') {
    const args = [
      ...(target.distroName ? ['--distribution', target.distroName] : []),
      '--cd',
      targetCwd,
      resolvedCliCommand,
      ...OPENCODE_ACP_ARGS,
    ];

    return {
      target,
      command: resolveWslExecutablePath(options.env),
      args,
      spawnCwd,
      targetCwd,
      env,
      pathMapper,
      shell: false,
    };
  }

  return {
    target,
    command: resolvedCliCommand,
    args: [...OPENCODE_ACP_ARGS],
    spawnCwd,
    targetCwd,
    env,
    pathMapper,
  };
}

function mapOpencodePathEnv(
  env: NodeJS.ProcessEnv,
  pathMapper: OpencodePathMapper,
  target: OpencodeExecutionTarget,
): NodeJS.ProcessEnv {
  if (target.method !== 'wsl') {
    return env;
  }

  const nextEnv = { ...env };
  delete nextEnv.PATH;

  const databasePath = env.OPENCODE_DB;
  if (typeof databasePath !== 'string' || !databasePath) {
    return nextEnv;
  }

  const targetDatabasePath = pathMapper.toTargetPath(databasePath);
  if (!targetDatabasePath) {
    return nextEnv;
  }

  return { ...nextEnv, OPENCODE_DB: targetDatabasePath };
}
