import * as path from 'node:path';

import { MANAGED_ACP_LAUNCH_REQUEST_KIND } from '../../../app/execution/acp/ManagedAcpLaunchResolverAdapter';
import type { ManagedAcpLaunchInvocation } from '../../../app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type {
  ChatTurnRequestInput,
  ChatTurnRequestPreparation,
  ChatTurnRequestPreparer,
} from '../../../core/providers/ChatTurnRequestPreparer';
import type { ProviderId } from '../../../core/providers/types';
import { getEnhancedPath } from '../../../utils/env';
import type { AcpContentBlock, AcpNewSessionRequest } from '../types';

/**
 * Builds the two request references a managed-ACP turn needs.
 *
 * `NodeManagedAcpProcessLauncher` resolves `startupRef` under
 * `managed-acp-launch` to get the executable, arguments, cwd, and environment.
 * The provider backend resolves the turn reference under its own request kind
 * to get the prompt and session inputs. Neither is a free-form string, and
 * nothing registered them after the Phase 9 cutover, so no managed-ACP provider
 * could start a process.
 *
 * OpenCode, MiMoCode, and Kimi Code compose this rather than inheriting a
 * lifecycle: every provider-specific decision — CLI resolution, launch
 * artifacts, runtime environment, config variable, request kind — arrives as an
 * option. The shared part is only the registration mechanics.
 */

export interface ManagedAcpLaunchArtifacts {
  readonly configPath: string;
  /**
   * Digest of the provider's launch inputs. Used as the restart fingerprint so
   * a managed client is reused across turns and relaunched only when a launch
   * input actually changed.
   */
  readonly launchKey: string;
}

export interface ManagedAcpCliPathResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null;
}

export interface ManagedAcpTurnRequestPreparerOptions {
  readonly providerId: ProviderId;
  /** Display name used in the CLI-missing message. */
  readonly displayName: string;
  readonly backendId: ExecutionBackendId;
  /** Request kind the provider's backend resolves its invocation under. */
  readonly requestKind: string;
  /**
   * Environment variable pointing the CLI at the generated config. Omitted by
   * providers that take no generated configuration file.
   */
  readonly configEnvVar?: string;
  /** CLI arguments that start the ACP server. Providers differ here. */
  readonly launchArguments: readonly string[];
  readonly executableName: string;
  readonly requests: {
    register<TPayload>(kind: string, payload: TPayload): string;
  };
  readonly cliResolver: ManagedAcpCliPathResolver;
  /**
   * Optional: only providers that generate a configuration file have artifacts.
   * Without them the restart fingerprint is derived from the launch inputs.
   */
  prepareLaunchArtifacts?(params: {
    readonly runtimeEnv: NodeJS.ProcessEnv;
    readonly settings: { vaultPath: string; userName?: string };
    readonly workspaceRoot: string;
  }): Promise<ManagedAcpLaunchArtifacts>;
  buildRuntimeEnv(
    settings: Record<string, unknown>,
    cliPath: string,
    databasePathOverride?: string | null,
  ): NodeJS.ProcessEnv;
  /**
   * Grimoire-owned MCP servers for the session. Resolved per turn because a
   * server can be added or disabled between messages.
   */
  loadMcpServers?(): Promise<AcpNewSessionRequest['mcpServers']>;
  readonly userName?: string;
}

export class ManagedAcpCliUnavailableError extends Error {
  constructor(displayName: string, executableName: string) {
    super(
      `The ${displayName} CLI could not be found. Set its path in Grimoire settings, `
      + `or make \`${executableName}\` available on PATH.`,
    );
    this.name = 'ManagedAcpCliUnavailableError';
  }
}

interface ManagedAcpExecutionInvocation {
  readonly startupRef: string;
  readonly restartFingerprint: string;
  readonly cwd: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export class ManagedAcpTurnRequestPreparer implements ChatTurnRequestPreparer {
  constructor(private readonly options: ManagedAcpTurnRequestPreparerOptions) {}

  get providerId(): ProviderId {
    return this.options.providerId;
  }

  async prepare(input: ChatTurnRequestInput): Promise<ChatTurnRequestPreparation> {
    const executable = this.options.cliResolver.resolveFromSettings(input.settings);
    if (!executable) {
      // Fail closed with an actionable message. Continuing would register a
      // launch spec that spawns nothing and surface as an opaque process error.
      throw new ManagedAcpCliUnavailableError(
        this.options.displayName,
        this.options.executableName,
      );
    }

    const runtimeEnv = this.options.buildRuntimeEnv(input.settings, executable);
    const artifacts = await this.options.prepareLaunchArtifacts?.({
      runtimeEnv,
      settings: {
        vaultPath: input.cwd,
        ...(this.options.userName ? { userName: this.options.userName } : {}),
      },
      workspaceRoot: input.cwd,
    });

    const environment = toStringEnvironment({
      ...runtimeEnv,
      ...(this.options.configEnvVar && artifacts
        ? { [this.options.configEnvVar]: artifacts.configPath }
        : {}),
      PATH: getEnhancedPath(
        runtimeEnv.PATH,
        path.isAbsolute(executable) ? executable : undefined,
      ),
    });
    const launch: ManagedAcpLaunchInvocation = {
      executable,
      arguments: this.options.launchArguments,
      cwd: input.cwd,
      environment,
    };
    const restartFingerprint = artifacts?.launchKey
      ?? deriveLaunchFingerprint(launch);
    const startupRef = this.options.requests.register(MANAGED_ACP_LAUNCH_REQUEST_KIND, launch);

    const invocation: ManagedAcpExecutionInvocation = {
      startupRef,
      restartFingerprint,
      cwd: input.cwd,
      prompt: [{ type: 'text', text: input.prompt }],
      mcpServers: await this.options.loadMcpServers?.() ?? [],
    };
    const requestRef = this.options.requests.register(this.options.requestKind, invocation);

    return {
      backendId: this.options.backendId,
      requestRef,
      restartFingerprint,
    };
  }
}

/**
 * Change detector for providers without generated launch artifacts. It digests
 * exactly what would make the running process wrong — executable, arguments,
 * working directory, and environment — so an unchanged configuration reuses the
 * managed client instead of relaunching it every turn.
 */
function deriveLaunchFingerprint(launch: ManagedAcpLaunchInvocation): string {
  const environment = Object.keys(launch.environment)
    .sort()
    .map(key => `${key}=${launch.environment[key] ?? ''}`)
    .join('\u0000');
  return [
    launch.executable,
    launch.arguments.join(' '),
    launch.cwd,
    environment,
  ].join('\u0001');
}

/**
 * `NodeJS.ProcessEnv` values are optional; the launch contract requires
 * concrete strings. Undefined entries are dropped rather than coerced, so an
 * unset variable stays unset in the child process.
 */
export function toStringEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}
