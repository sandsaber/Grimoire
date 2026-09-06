import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../../core/types/settings';
import { getHostnameKey } from '../../../utils/env';
import type { CodexInstallationMethod } from '../settings';
import { getCodexProviderSettings } from '../settings';
import { resolveCodexCliPath } from './CodexBinaryLocator';

export class CodexCliResolver {
  private resolvedPath: string | null = null;
  private lastHostnamePath = '';
  private lastLegacyPath = '';
  private lastEnvText = '';
  private lastInstallationMethod = '';
  private readonly cachedHostname = getHostnameKey();

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const codexSettings = getCodexProviderSettings(settings);
    const hostnamePath = (codexSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const legacyPath = codexSettings.cliPath.trim();
    const envText = getRuntimeEnvironmentText(settings, 'codex');
    const installationMethod = codexSettings.installationMethod;

    if (
      this.resolvedPath &&
      hostnamePath === this.lastHostnamePath &&
      legacyPath === this.lastLegacyPath &&
      envText === this.lastEnvText &&
      installationMethod === this.lastInstallationMethod
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastLegacyPath = legacyPath;
    this.lastEnvText = envText;
    this.lastInstallationMethod = installationMethod;

    this.resolvedPath = resolveCodexCliPath(hostnamePath, legacyPath, envText, {
      installationMethod,
    });
    return this.resolvedPath;
  }

  resolve(
    hostnamePaths: HostnameCliPaths | undefined,
    legacyPath: string | undefined,
    envText: string,
    options: {
      installationMethod?: CodexInstallationMethod;
      hostPlatform?: NodeJS.Platform;
    } = {},
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    const normalizedLegacyPath = (legacyPath ?? '').trim();
    return resolveCodexCliPath(hostnamePath, normalizedLegacyPath, envText, options);
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastHostnamePath = '';
    this.lastLegacyPath = '';
    this.lastEnvText = '';
    this.lastInstallationMethod = '';
  }
}

/**
 * The one instance, shared by the module declaration and the workspace.
 *
 * A CLI path is needed to *create* a workspace — the process the workspace
 * wraps is launched with it — so the module declares its resolution, and the
 * workspace borrows the same object rather than building a second one. Two
 * instances would mean the settings tab's `reset()` clearing a cache nothing
 * reads, and a stale path surviving the user fixing it.
 *
 * Built on first use rather than at import: a module is constructed when its
 * file is loaded, and this constructor reads the machine's hostname — work no
 * provider the user has switched off should be doing, and work a test that
 * mocks `getHostnameKey` cannot have happening before its own mock exists.
 */
let sharedResolver: CodexCliResolver | null = null;

export function codexCliResolver(): CodexCliResolver {
  return sharedResolver ??= new CodexCliResolver();
}
