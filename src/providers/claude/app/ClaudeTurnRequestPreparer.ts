import type { Options } from '@anthropic-ai/claude-agent-sdk';

import { CLAUDE_STARTUP_OPTIONS_REQUEST_KIND } from '../../../app/execution/claude/ClaudeStartupOptionsResolverAdapter';
import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  ChatTurnRequestInput,
  ChatTurnRequestPreparation,
  ChatTurnRequestPreparer,
} from '../../../core/providers/ChatTurnRequestPreparer';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderId } from '../../../core/providers/types';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { buildClaudeSDKUserMessage } from '../runtime/ClaudeUserMessageFactory';

/**
 * Claude's turn preparation.
 *
 * Claude is not a managed-ACP provider: its startup reference resolves to SDK
 * `Options` rather than a process launch specification, and the turn carries an
 * `SDKUserMessage` rather than ACP content blocks. `ClaudeSdkExecutionAdapter`
 * spreads the resolved options and supplies the rest, so a partial object is
 * the contract, not a shortcut.
 *
 * Deliberately conservative for now. `QueryOptionsBuilder` also composes MCP
 * servers, plugins, hooks, and setting sources from workspace services that the
 * cutover left unreachable; wiring those is Phase 12B contract work. Until then
 * Claude starts with executable, working directory, and environment only —
 * the same limitation the managed-ACP providers currently have with MCP.
 */

export interface ClaudeCliPathResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null;
}

export interface ClaudeTurnRequestPreparerOptions {
  readonly backendId: ExecutionBackendId;
  readonly requestKind: string;
  readonly requests: {
    register<TPayload>(kind: string, payload: TPayload): string;
  };
  readonly cliResolver: ClaudeCliPathResolver;
}

export class ClaudeCliUnavailableError extends Error {
  constructor() {
    super(
      'The Claude Code CLI could not be found. Set its path in Grimoire settings, '
      + 'or make `claude` available on PATH.',
    );
    this.name = 'ClaudeCliUnavailableError';
  }
}

export class ClaudeTurnRequestPreparer implements ChatTurnRequestPreparer {
  readonly providerId = 'claude' as ProviderId;

  constructor(private readonly options: ClaudeTurnRequestPreparerOptions) {}

  async prepare(input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation> {
    const executable = this.options.cliResolver.resolveFromSettings(input.settings);
    if (!executable) {
      throw new ClaudeCliUnavailableError();
    }

    const environmentText = getRuntimeEnvironmentText(input.settings, 'claude');
    const customEnv = parseEnvironmentVariables(environmentText);
    const env: Record<string, string> = {
      ...customEnv,
      PATH: getEnhancedPath(customEnv.PATH, executable),
    };

    const startupOptions: Options = {
      cwd: input.cwd,
      pathToClaudeCodeExecutable: executable,
      env,
    };
    const startupRef = this.options.requests.register(
      CLAUDE_STARTUP_OPTIONS_REQUEST_KIND,
      startupOptions,
    );

    // Startup-only identity. The backend compares it to decide whether the
    // persistent SDK query may be reused; a clock-derived value would restart
    // the query on every message.
    const restartFingerprint = JSON.stringify({
      command: executable,
      cwd: input.cwd,
      envText: environmentText,
    });

    // The backend replaces session_id with the native session once it observes
    // one, so a fresh turn carries an empty placeholder rather than a fake id.
    const requestRef = this.options.requests.register(this.options.requestKind, {
      startupRef,
      restartFingerprint,
      message: buildClaudeSDKUserMessage(input.prompt, ''),
    });

    return { backendId: this.options.backendId, requestRef, restartFingerprint };
  }
}
