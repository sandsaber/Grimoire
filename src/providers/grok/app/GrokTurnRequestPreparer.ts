import * as path from 'node:path';

import { MANAGED_ACP_LAUNCH_REQUEST_KIND } from '../../../app/execution/acp/ManagedAcpLaunchResolverAdapter';
import type { ManagedAcpLaunchInvocation } from '../../../app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import { computeSystemPromptKey } from '../../../core/prompt/mainAgent';
import type {
  ChatTurnRequestInput,
  ChatTurnRequestPreparation,
  ChatTurnRequestPreparer,
} from '../../../core/providers/ChatTurnRequestPreparer';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderId } from '../../../core/providers/types';
import { getEnhancedPath } from '../../../utils/env';
import { toStringEnvironment } from '../../acp/app/ManagedAcpTurnRequestPreparer';
import { ManagedAcpCliUnavailableError } from '../../acp/app/ManagedAcpTurnRequestPreparer';
import type { AcpNewSessionRequest } from '../../acp/types';
import type { GrokPermissionMode } from '../modes';
import { resolveGrokPermissionModeForSettings } from '../modes';
import type { GrokLaunchArtifacts } from '../runtime/GrokLaunchArtifacts';

/**
 * Grok's turn preparation, kept provider-owned rather than folded into the
 * shared managed-ACP preparer.
 *
 * Three things differ from the OpenCode family and none of them are cosmetic:
 * launch artifacts are prepared before the runtime environment because the
 * environment needs the generated Grok home directory; the CLI arguments are
 * derived from the configured permission mode and reasoning effort rather than
 * being constant; and the restart fingerprint must cover those settings, since
 * changing either one requires a new process.
 */

export interface GrokCliPathResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null;
}

export interface GrokLaunchArtifactsPreparer {
  (params: {
    readonly permissionMode: GrokPermissionMode;
    readonly settings: { vaultPath: string; userName?: string };
    readonly workspaceRoot: string;
  }): Promise<GrokLaunchArtifacts>;
}

export interface GrokTurnRequestPreparerOptions {
  readonly backendId: ExecutionBackendId;
  readonly requestKind: string;
  readonly requests: {
    register<TPayload>(kind: string, payload: TPayload): string;
  };
  readonly cliResolver: GrokCliPathResolver;
  readonly prepareLaunchArtifacts: GrokLaunchArtifactsPreparer;
  buildRuntimeEnv(
    settings: Record<string, unknown>,
    cliPath: string,
    grokHomePath?: string | null,
  ): NodeJS.ProcessEnv;
  buildProcessArguments(
    reasoningEffort?: string | null,
    permissionMode?: GrokPermissionMode,
  ): string[];
  readonly mcpServers?: AcpNewSessionRequest['mcpServers'];
  readonly userName?: string;
}

interface GrokProviderLaunchSettings {
  readonly permissionMode: unknown;
  readonly effortLevel?: unknown;
}

export class GrokTurnRequestPreparer implements ChatTurnRequestPreparer {
  readonly providerId = 'grok' as ProviderId;

  constructor(private readonly options: GrokTurnRequestPreparerOptions) {}

  async prepare(input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation> {
    const executable = this.options.cliResolver.resolveFromSettings(input.settings);
    if (!executable) {
      throw new ManagedAcpCliUnavailableError('Grok Build', 'grok');
    }

    const providerSettings = (input.settings.grok ?? {}) as GrokProviderLaunchSettings;
    const permissionMode = resolveGrokPermissionModeForSettings(providerSettings.permissionMode);
    const reasoningEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel
      : null;

    const promptSettings = { vaultPath: input.cwd, ...(this.options.userName ? { userName: this.options.userName } : {}) };
    // Artifacts first: the runtime environment is built against the generated
    // Grok home directory, so the order cannot be swapped.
    const artifacts = await this.options.prepareLaunchArtifacts({
      permissionMode,
      settings: promptSettings,
      workspaceRoot: input.cwd,
    });
    const runtimeEnv = this.options.buildRuntimeEnv(
      input.settings,
      executable,
      artifacts.grokHomePath,
    );

    const launch: ManagedAcpLaunchInvocation = {
      executable,
      arguments: this.options.buildProcessArguments(reasoningEffort, permissionMode),
      cwd: input.cwd,
      environment: toStringEnvironment({
        ...runtimeEnv,
        PATH: getEnhancedPath(
          runtimeEnv.PATH,
          path.isAbsolute(executable) ? executable : undefined,
        ),
      }),
    };

    // Mirrors the pre-migration launch key: anything here changing means the
    // running process is wrong and must be replaced.
    const restartFingerprint = JSON.stringify({
      artifactKey: artifacts.launchKey,
      command: executable,
      envText: getRuntimeEnvironmentText(input.settings, 'grok'),
      grokHomePath: artifacts.grokHomePath,
      permissionMode,
      promptKey: computeSystemPromptKey(promptSettings),
      reasoningEffort,
    });

    const startupRef = this.options.requests.register(MANAGED_ACP_LAUNCH_REQUEST_KIND, launch);
    const requestRef = this.options.requests.register(this.options.requestKind, {
      startupRef,
      restartFingerprint,
      cwd: input.cwd,
      prompt: [{ type: 'text', text: input.prompt }],
      mcpServers: this.options.mcpServers ?? [],
    });

    return { backendId: this.options.backendId, requestRef, restartFingerprint };
  }
}
