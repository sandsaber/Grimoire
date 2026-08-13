import type { ExecutionBackendId } from '../execution/ExecutionBackendDescriptor';
import type { ProviderId } from './types';

/**
 * Provider-neutral seam for turning a user prompt into a dispatchable execution
 * request.
 *
 * A backend does not receive a prompt directly: it receives an opaque request
 * reference and resolves the real invocation through the execution request
 * broker. Building that invocation needs provider-owned knowledge — CLI
 * resolution, launch artifacts, runtime environment, MCP servers — none of
 * which may leak into feature code. This port is where that work is delegated.
 *
 * Views submit turns through the application runtime and never construct a
 * launch specification themselves.
 */

export interface ChatTurnRequestInput {
  readonly conversationId: string;
  /** The user's message, already trimmed. */
  readonly prompt: string;
  /** Workspace root the provider process runs in. */
  readonly cwd: string;
  /** Full application settings document; the preparer decodes its own slice. */
  readonly settings: Record<string, unknown>;
}

export interface ChatTurnRequestPreparation {
  readonly backendId: ExecutionBackendId;
  /** Opaque reference the backend resolves through the request broker. */
  readonly requestRef: string;
  /**
   * Stable across turns while the provider's launch inputs are unchanged, so a
   * managed client is reused instead of being relaunched for every message.
   */
  readonly restartFingerprint: string;
}

export interface ChatTurnRequestPreparer {
  readonly providerId: ProviderId;
  prepare(input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation>;
}

/**
 * Thrown when a provider has no preparer yet. Fail closed and name the
 * provider: an unsupported path must be visible rather than surface later as an
 * unresolvable request reference inside the backend.
 */
export class ChatTurnPreparationUnsupportedError extends Error {
  constructor(readonly providerId: string) {
    super(
      `Provider "${providerId}" cannot start a turn yet: its launch pipeline is not wired. `
      + 'See Phase 12B in docs/provider-execution-migration-plan.md.',
    );
    this.name = 'ChatTurnPreparationUnsupportedError';
  }
}

/** Resolves the preparer that owns a provider. */
export class ChatTurnRequestPreparerRegistry {
  private readonly preparers = new Map<string, ChatTurnRequestPreparer>();

  constructor(preparers: readonly ChatTurnRequestPreparer[] = []) {
    for (const preparer of preparers) {
      this.register(preparer);
    }
  }

  register(preparer: ChatTurnRequestPreparer): void {
    if (this.preparers.has(preparer.providerId)) {
      throw new Error(`Duplicate chat turn preparer for provider "${preparer.providerId}".`);
    }
    this.preparers.set(preparer.providerId, preparer);
  }

  has(providerId: string): boolean {
    return this.preparers.has(providerId);
  }

  prepare(providerId: string, input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation> {
    const preparer = this.preparers.get(providerId);
    if (!preparer) {
      return Promise.reject(new ChatTurnPreparationUnsupportedError(providerId));
    }
    return preparer.prepare(input);
  }
}
