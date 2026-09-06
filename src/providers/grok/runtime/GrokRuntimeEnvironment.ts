import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { resolveGrokAuthPath } from './GrokPaths';

export function buildGrokRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
  grokHomePath?: string | null,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'grok');
  const envVars = parseEnvironmentVariables(envText);
  const usesManagedGrokHome = Boolean(grokHomePath?.trim());
  const hasExplicitGrokAuth = Boolean(
    envVars.GROK_AUTH?.trim()
    || envVars.GROK_AUTH_PATH?.trim(),
  );
  const authResolutionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...envVars,
  };
  const managedGrokAuthPath = usesManagedGrokHome && !hasExplicitGrokAuth
    ? resolveGrokAuthPath(authResolutionEnv)
    : null;

  return {
    ...process.env,
    ...envVars,
    ...(usesManagedGrokHome ? { GROK_HOME: grokHomePath!.trim() } : {}),
    ...(managedGrokAuthPath ? { GROK_AUTH_PATH: managedGrokAuthPath } : {}),
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}