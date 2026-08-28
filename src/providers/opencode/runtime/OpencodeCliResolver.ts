import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getHostnameKey } from '../../../utils/env';
import { resolveCliExecutable } from '../../../utils/resolveCliExecutable';
import { getOpencodeProviderSettings } from '../settings';

export class OpencodeCliResolver {
  private readonly cachedHostname = getHostnameKey();
  private lastCliPath = '';
  private lastHostnamePath = '';
  private lastEnvText = '';
  private resolvedPath: string | null = null;

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const opencodeSettings = getOpencodeProviderSettings(settings);
    const cliPath = opencodeSettings.cliPath.trim();
    const hostnamePath = (opencodeSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'opencode');

    if (
      this.resolvedPath !== null
      && cliPath === this.lastCliPath
      && hostnamePath === this.lastHostnamePath
      && envText === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastCliPath = cliPath;
    this.lastHostnamePath = hostnamePath;
    this.lastEnvText = envText;
    this.resolvedPath = this.resolve(
      opencodeSettings.cliPathsByHost,
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
    return resolveCliExecutable('opencode', [hostnamePath, legacyPath], envText);
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastHostnamePath = '';
    this.lastEnvText = '';
    this.resolvedPath = null;
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
let sharedResolver: OpencodeCliResolver | null = null;

export function opencodeCliResolver(): OpencodeCliResolver {
  return sharedResolver ??= new OpencodeCliResolver();
}
