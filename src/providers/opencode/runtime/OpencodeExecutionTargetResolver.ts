import { execFileSync } from 'child_process';

import { resolveWslExecutablePath } from '@/utils/env';

import { getOpencodeProviderSettings } from '../settings';
import type {
  OpencodeExecutionPlatformFamily,
  OpencodeExecutionPlatformOs,
  OpencodeExecutionTarget,
  OpencodeWslHostFlavor,
} from './opencodeLaunchTypes';

export interface ResolveOpencodeExecutionTargetOptions {
  settings: Record<string, unknown>;
  hostPlatform?: NodeJS.Platform;
  hostVaultPath?: string | null;
  resolveDefaultWslDistro?: () => string | undefined;
}

function resolveHostPlatformOs(hostPlatform: NodeJS.Platform): OpencodeExecutionPlatformOs {
  if (hostPlatform === 'win32') {
    return 'windows';
  }

  if (hostPlatform === 'darwin') {
    return 'macos';
  }

  return 'linux';
}

function resolveHostPlatformFamily(hostPlatform: NodeJS.Platform): OpencodeExecutionPlatformFamily {
  return hostPlatform === 'win32' ? 'windows' : 'unix';
}

function inferWslHostFlavorFromWindowsPath(
  hostPath: string | null | undefined,
): OpencodeWslHostFlavor | undefined {
  if (!hostPath) {
    return undefined;
  }

  const normalized = hostPath.replace(/\//g, '\\');
  if (/^\\\\wsl\.localhost\\/i.test(normalized)) {
    return 'wsl.localhost';
  }

  if (/^\\\\wsl\$\\/i.test(normalized)) {
    return 'wsl$';
  }

  return undefined;
}

export function inferWslDistroFromWindowsPath(hostPath: string | null | undefined): string | undefined {
  if (!hostPath) {
    return undefined;
  }

  const normalized = hostPath.replace(/\//g, '\\');
  const match = normalized.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(?:\\|$)/i);
  return match?.[1] || undefined;
}

export function parseDefaultWslDistroListOutput(output: string): string | undefined {
  for (const line of output.replace(/\uFEFF/g, '').split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('*')) {
      continue;
    }

    const candidate = trimmed.slice(1).trimStart().split(/\s{2,}/)[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export function decodeWslListOutput(raw: Buffer): string {
  // wsl.exe writes UTF-16LE (with a BOM) when stdout is redirected instead of
  // a console. WSL_UTF8=1 makes newer builds emit UTF-8, but older builds
  // ignore it, so detect the BOM and decode accordingly.
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString('utf16le');
  }

  return raw.toString('utf8');
}

function resolveDefaultWslDistroName(): string | undefined {
  try {
    const output = execFileSync(resolveWslExecutablePath(), ['--list', '--verbose'], {
      env: { ...process.env, WSL_UTF8: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return parseDefaultWslDistroListOutput(decodeWslListOutput(output));
  } catch {
    return undefined;
  }
}

export function resolveOpencodeExecutionTarget(
  options: ResolveOpencodeExecutionTargetOptions,
): OpencodeExecutionTarget {
  const hostPlatform = options.hostPlatform ?? process.platform;
  if (hostPlatform !== 'win32') {
    return {
      method: 'host-native',
      platformFamily: resolveHostPlatformFamily(hostPlatform),
      platformOs: resolveHostPlatformOs(hostPlatform),
    };
  }

  const opencodeSettings = getOpencodeProviderSettings(options.settings);
  if (opencodeSettings.installationMethod === 'wsl') {
    const wslHostFlavor = inferWslHostFlavorFromWindowsPath(options.hostVaultPath);
    const distroName = opencodeSettings.wslDistroOverride
      || inferWslDistroFromWindowsPath(options.hostVaultPath)
      || options.resolveDefaultWslDistro?.()
      || resolveDefaultWslDistroName();

    return {
      method: 'wsl',
      platformFamily: 'unix',
      platformOs: 'linux',
      distroName,
      wslHostFlavor,
    };
  }

  return {
    method: 'native-windows',
    platformFamily: 'windows',
    platformOs: 'windows',
  };
}
