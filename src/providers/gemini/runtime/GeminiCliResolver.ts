import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getHostnameKey } from '../../../utils/env';
import { resolveCliExecutable } from '../../../utils/resolveCliExecutable';
import { getGeminiProviderSettings } from '../settings';

export class GeminiCliResolver {
  private readonly cachedHostname = getHostnameKey();
  private lastCliPath = '';
  private lastEnvText = '';
  private lastHostnamePath = '';
  private resolvedPath: string | null = null;

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const geminiSettings = getGeminiProviderSettings(settings);
    const cliPath = geminiSettings.cliPath.trim();
    const hostnamePath = (geminiSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'gemini');

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
      geminiSettings.cliPathsByHost,
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
    return resolveCliExecutable('gemini', [hostnamePath, legacyPath], envText);
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastEnvText = '';
    this.lastHostnamePath = '';
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
let sharedResolver: GeminiCliResolver | null = null;

export function geminiCliResolver(): GeminiCliResolver {
  return sharedResolver ??= new GeminiCliResolver();
}
