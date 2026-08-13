import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  ChatTurnRequestInput,
  ChatTurnRequestPreparation,
  ChatTurnRequestPreparer,
} from '../../../core/providers/ChatTurnRequestPreparer';
import type { ProviderId } from '../../../core/providers/types';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../types/models';

/**
 * Codex's turn preparation.
 *
 * Codex needs no startup reference: its app-server launch specification is
 * supplied once at composition time, and a turn only describes which thread to
 * use and what to send. That also means there is no restart fingerprint to
 * compute — the process identity is not per-turn.
 *
 * Every turn starts a new thread for now. Resuming an existing one needs the
 * conversation's stored native thread id, which arrives with provider-native
 * history; that is still orphaned, so inventing a thread id here would be a
 * fabrication the backend could not honour.
 */

interface CodexProviderLaunchSettings {
  readonly permissionMode?: unknown;
  readonly model?: unknown;
  readonly baseInstructions?: unknown;
}

export interface CodexTurnRequestPreparerOptions {
  readonly backendId: ExecutionBackendId;
  readonly requestKind: string;
  readonly requests: {
    register<TPayload>(kind: string, payload: TPayload): string;
  };
}

/**
 * Maps Grimoire's permission mode to the Codex approval policy and sandbox
 * pair. Read-only is the conservative default: an unrecognised mode must not
 * widen the sandbox.
 */
export function resolveCodexSandboxConfig(
  permissionMode: unknown,
): { readonly approvalPolicy: string; readonly sandbox: string } {
  if (permissionMode === 'full_access') {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  }
  if (permissionMode === 'plan') {
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  }
  return { approvalPolicy: 'on-request', sandbox: 'read-only' };
}

export class CodexTurnRequestPreparer implements ChatTurnRequestPreparer {
  readonly providerId = 'codex' as ProviderId;

  constructor(private readonly options: CodexTurnRequestPreparerOptions) {}

  async prepare(input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation> {
    const providerSettings = (input.settings.codex ?? {}) as CodexProviderLaunchSettings;
    const model = typeof providerSettings.model === 'string' && providerSettings.model
      ? providerSettings.model
      : DEFAULT_CODEX_PRIMARY_MODEL;
    const { approvalPolicy, sandbox } = resolveCodexSandboxConfig(providerSettings.permissionMode);

    const requestRef = this.options.requests.register(this.options.requestKind, {
      thread: {
        kind: 'new',
        params: {
          model,
          cwd: input.cwd,
          approvalPolicy,
          sandbox,
          ...(typeof providerSettings.baseInstructions === 'string'
            ? { baseInstructions: providerSettings.baseInstructions }
            : {}),
        },
      },
      turn: {
        kind: 'start',
        params: { input: [{ type: 'text', text: input.prompt }] },
      },
    });

    // Codex has no per-turn process identity, so there is nothing to fence a
    // restart on. An empty value would be rejected, so the fingerprint states
    // what actually determines the thread.
    return {
      backendId: this.options.backendId,
      requestRef,
      restartFingerprint: JSON.stringify({ approvalPolicy, cwd: input.cwd, model, sandbox }),
    };
  }
}
