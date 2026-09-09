import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

/**
 * `devin acp` writes tracing at INFO level to stderr — every dispatch, every
 * database call — and a session reads as megabytes of it. `warn` keeps what a
 * person would want in the debug log and nothing else; a `RUST_LOG` the user
 * set themselves wins.
 */
const DEFAULT_LOG_LEVEL = 'warn';

export function buildDevinRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'devin');
  const envVars = parseEnvironmentVariables(envText);
  return {
    RUST_LOG: DEFAULT_LOG_LEVEL,
    ...process.env,
    ...envVars,
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
