import * as fs from 'node:fs';
import * as path from 'node:path';

import { getEnhancedPath, parseEnvironmentVariables } from './env';
import { expandHomePath } from './path';

interface ResolveCliExecutableOptions {
  fallbackPaths?: string[];
  pathText?: string;
}

/** Resolve a provider CLI from valid configured files, PATH, then known install locations. */
export function resolveCliExecutable(
  command: string,
  configuredPaths: Array<string | undefined>,
  environmentText: string,
  options: ResolveCliExecutableOptions = {},
): string | null {
  for (const configuredPath of configuredPaths) {
    const resolved = resolveCliFile(configuredPath);
    if (resolved) return resolved;
  }

  const providerPath = parseEnvironmentVariables(environmentText).PATH;
  const preferredPath = [providerPath, options.pathText ?? process.env.PATH].filter(Boolean).join(path.delimiter);
  const searchPath = options.pathText === undefined
    ? getEnhancedPath(preferredPath)
    : preferredPath;
  const detected = resolveExecutableFromPath(command, searchPath);
  if (detected) return detected;

  for (const fallbackPath of options.fallbackPaths ?? []) {
    const resolved = resolveCliFile(fallbackPath);
    if (resolved) return resolved;
  }

  return null;
}

export function resolveCliFile(cliPath: string | undefined): string | null {
  const trimmed = cliPath?.trim();
  if (!trimmed) return null;

  try {
    const expanded = expandHomePath(trimmed);
    return fs.existsSync(expanded) && fs.statSync(expanded).isFile()
      ? expanded
      : null;
  } catch {
    return null;
  }
}

export function resolveExecutableFromPath(command: string, pathText: string | undefined): string | null {
  for (const rawDirectory of (pathText ?? '').split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^['"]|['"]$/g, '');
    if (!directory) continue;

    for (const executableName of getExecutableNames(command)) {
      const candidate = path.join(directory, executableName);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Continue searching other PATH entries.
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
    .map(extension => extension.trim().toLowerCase())
    .filter(Boolean);
  // Prefer PATHEXT launchers on Windows. npm also installs an extensionless
  // POSIX shim beside its .cmd file, but that shim is not directly spawnable.
  return [...extensions.map(extension => `${command}${extension}`), command];
}
