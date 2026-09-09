import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getHostnameKey } from '../../../utils/env';
import { resolveCliExecutable } from '../../../utils/resolveCliExecutable';
import { getDevinProviderSettings } from '../settings';

/**
 * Where the installers put the binary: the shell script in `~/.local/bin`, and
 * the Homebrew cask beside every other cask. Looked in only after PATH, which
 * a desktop app does not inherit from the shell.
 */
const DEVIN_FALLBACK_PATHS = [
  '~/.local/bin/devin',
  '/opt/homebrew/bin/devin',
  '/usr/local/bin/devin',
];

export class DevinCliResolver {
  private readonly cachedHostname = getHostnameKey();
  private lastCliPath = '';
  private lastEnvText = '';
  private lastHostnamePath = '';
  private resolvedPath: string | null = null;

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const devinSettings = getDevinProviderSettings(settings);
    const cliPath = devinSettings.cliPath.trim();
    const hostnamePath = (devinSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'devin');

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
      devinSettings.cliPathsByHost,
      cliPath,
      envText,
    );
    return this.resolvedPath;
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText: string,
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    return resolveCliExecutable('devin', [hostnamePath, legacyPath], envText, {
      fallbackPaths: DEVIN_FALLBACK_PATHS,
    });
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastEnvText = '';
    this.lastHostnamePath = '';
    this.resolvedPath = null;
  }
}

/**
 * The one instance, shared by the module declaration and the workspace, built
 * on first use because the constructor reads the machine's hostname.
 */
let sharedResolver: DevinCliResolver | null = null;

export function devinCliResolver(): DevinCliResolver {
  return sharedResolver ??= new DevinCliResolver();
}
