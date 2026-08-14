import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  ChatTurnRequestInput,
  ChatTurnRequestPreparation,
  ChatTurnRequestPreparer,
} from '../../../core/providers/ChatTurnRequestPreparer';
import type { ProviderId } from '../../../core/providers/types';

/**
 * Antigravity's turn preparation.
 *
 * Antigravity runs one print-mode process per turn, so there is no startup
 * reference and no persistent client: the invocation carries the command,
 * working directory, environment, and prompt directly, and the backend spawns
 * from it. The restart fingerprint is therefore not a reuse fence — a fresh
 * process starts either way — but the contract requires a non-empty value, so
 * it states the launch inputs rather than a placeholder.
 */

interface AntigravityProviderSettings {
  readonly model?: unknown;
  readonly permissionMode?: unknown;
}

export interface AntigravityCliPathResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null;
}

export interface AntigravityTurnRequestPreparerOptions {
  readonly backendId: ExecutionBackendId;
  readonly requestKind: string;
  readonly requests: {
    register<TPayload>(kind: string, payload: TPayload): string;
  };
  readonly cliResolver: AntigravityCliPathResolver;
  buildRuntimeEnv(
    settings: Record<string, unknown>,
    cliPath: string,
  ): NodeJS.ProcessEnv;
}

export class AntigravityCliUnavailableError extends Error {
  constructor() {
    super(
      'The Antigravity CLI could not be found. Set its path in Grimoire settings, '
      + 'or make `antigravity` available on PATH.',
    );
    this.name = 'AntigravityCliUnavailableError';
  }
}

export class AntigravityTurnRequestPreparer implements ChatTurnRequestPreparer {
  readonly providerId = 'antigravity' as ProviderId;

  constructor(private readonly options: AntigravityTurnRequestPreparerOptions) {}

  async prepare(input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation> {
    const command = this.options.cliResolver.resolveFromSettings(input.settings);
    if (!command) {
      throw new AntigravityCliUnavailableError();
    }

    const providerSettings = (input.settings.antigravity ?? {}) as AntigravityProviderSettings;
    const model = typeof providerSettings.model === 'string' && providerSettings.model
      ? providerSettings.model
      : null;
    // The backend reads this to decide whether to pass approval flags, so an
    // unset mode must resolve to the conservative value rather than undefined.
    const permissionMode = typeof providerSettings.permissionMode === 'string'
      ? providerSettings.permissionMode
      : 'default';

    const requestRef = this.options.requests.register(this.options.requestKind, {
      command,
      cwd: input.cwd,
      environment: this.options.buildRuntimeEnv(input.settings, command),
      model,
      permissionMode,
      prompt: input.prompt,
    });

    return {
      backendId: this.options.backendId,
      requestRef,
      restartFingerprint: JSON.stringify({ command, cwd: input.cwd, model, permissionMode }),
    };
  }
}
