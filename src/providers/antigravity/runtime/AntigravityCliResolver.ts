import * as fs from 'node:fs';
import * as path from 'node:path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getAntigravityProviderSettings } from '../settings';

export class AntigravityCliResolver {
  private readonly cachedHostname = getHostnameKey();
  private lastCliPath = '';
  private lastEnvText = '';
  private lastHostnamePath = '';
  private resolvedPath: string | null = null;

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const antigravitySettings = getAntigravityProviderSettings(settings);
    const cliPath = antigravitySettings.cliPath.trim();
    const hostnamePath = (antigravitySettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'antigravity');

    if (
      this.resolvedPath !== null
      && cliPath === this.lastCliPath
      && envText === this.lastEnvText
      && hostnamePath === this.lastHostnamePath
    ) {
      return this.resolvedPath;
    }

    this.lastCliPath = cliPath;
    this.lastEnvText = envText;
    this.lastHostnamePath = hostnamePath;
    this.resolvedPath = this.resolve(
      antigravitySettings.cliPathsByHost,
      cliPath,
      envText,
    );
    return this.resolvedPath;
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText: string,
    pathText: string | undefined = process.env.PATH,
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    // Resolved once. The configured path was computed, then computed again as
    // the first two arms of the chain below — the same two calls, in the same
    // order, deciding the same thing twice.
    const configuredPath = resolveConfiguredCliPath(hostnamePath)
      ?? resolveConfiguredCliPath(legacyPath.trim());
    const envVars = parseEnvironmentVariables(envText);
    const enhancedPath = getEnhancedPath(envVars.PATH, configuredPath ?? (legacyPath.trim() || undefined));
    return configuredPath
      ?? resolveExecutableFromPath('agy', pathText)
      ?? resolveExecutableFromPath('agy', enhancedPath)
      ?? resolveCommonAgyPath();
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastEnvText = '';
    this.lastHostnamePath = '';
    this.resolvedPath = null;
  }
}

function resolveCommonAgyPath(): string | null {
  const home = process.env.HOME;
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    localAppData ? path.join(localAppData, 'agy', 'bin', 'agy.exe') : '',
    home ? path.join(home, '.local/bin/agy') : '',
    home ? path.join(home, '.antigravity/antigravity/bin/agy') : '',
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ];

  for (const candidate of candidates) {
    const resolved = resolveConfiguredCliPath(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveConfiguredCliPath(cliPath: string): string | null {
  if (!cliPath) {
    return null;
  }

  try {
    const expanded = expandHomePath(cliPath);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveExecutableFromPath(command: string, pathText: string | undefined): string | null {
  for (const directory of (pathText ?? '').split(path.delimiter)) {
    if (!directory.trim()) {
      continue;
    }

    for (const executableName of getExecutableNames(command)) {
      const candidate = path.join(directory, executableName);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function getExecutableNames(command: string): string[] {
  if (process.platform !== 'win32' || path.extname(command)) {
    return [command];
  }

  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return [
    command,
    ...extensions.map((extension) => `${command}${extension}`),
  ];
}
