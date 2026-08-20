import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import { interactionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type {
  BackendLifecycleRegistration,
  ExecutionLifecycleRegistry,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { computeSystemPromptKey } from '@/core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type GrimoirePlugin from '@/main';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { ManagedAcpExecutionBackendContext } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import { GrokAcpDynamicConfigApplier } from '@/providers/grok/execution/GrokAcpDynamicConfig';
import { GrokExecutionBackend } from '@/providers/grok/execution/GrokExecutionBackend';
import {
  GrokExecutionRequests,
  type GrokInvocationEnvironment,
} from '@/providers/grok/execution/GrokExecutionRequests';
import { GrokInteractionBridge } from '@/providers/grok/execution/GrokInteractionBridge';
import { GrokProjectionResultSink } from '@/providers/grok/execution/GrokProjectionResultSink';
import { resolveGrokPermissionModeForSettings } from '@/providers/grok/modes';
import { buildGrokAgentProcessArgs } from '@/providers/grok/runtime/GrokLaunchArgs';
import { prepareGrokLaunchArtifacts } from '@/providers/grok/runtime/GrokLaunchArtifacts';
import { buildGrokRuntimeEnv } from '@/providers/grok/runtime/GrokRuntimeEnvironment';
import {
  GROK_SESSION_NOTIFICATION_METHODS,
  parseGrokSessionNotification,
} from '@/providers/grok/runtime/GrokSessionNotifications';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * Grok chat execution, assembled from the running plugin.
 *
 * **Dark.** Nothing constructs this yet: `registration.ts` still points
 * `createRuntime` at `GrokChatRuntime`, and the flip is a later checkpoint.
 *
 * The second provider on the shared managed-ACP backend, and the first to cost
 * only what wave 4 said the remaining waves should. What is here is Grok's and
 * nothing else:
 *
 * - **the launch is a command line, not a directory.** OpenCode is configured
 *   by files; Grok takes its permission policy and its reasoning effort as
 *   process arguments, so both live in the launch key and a change to either
 *   restarts the process rather than reconfiguring an open session;
 * - **a managed home.** The artifacts write a `GROK_HOME` the process reads its
 *   config and system prompt from, and the auxiliary purpose gets its own, which
 *   is what keeps the two from sharing a session store;
 * - **its own envelope.** Grok sends three of its session updates on
 *   `_x.ai/session_notification`, so the client is built knowing how to read
 *   them — without it the turn's usage and its stop reason never arrive;
 * - **its own ordering.** Model and mode have dedicated ACP methods here, and
 *   the mode falls back to a config option on a release that answers "method
 *   not found".
 *
 * One thing is deliberately **not** here, named so a flip cannot land while it
 * is missing: **the runtime half**, which is what constructs the content
 * presenter and the approval presenter and answers their ports. Both are built;
 * nothing yet holds them for a tab.
 */
export class GrokExecution {
  private readonly requests = new GrokExecutionRequests(
    () => opaqueId('grokreq'),
    () => this.environment(),
  );

  /**
   * One bridge for every tab, because the backend is one and it prepares every
   * request through the bridge it was built with.
   */
  private readonly interactions = new GrokInteractionBridge(() => opaqueId('grokix'));

  private backend: GrokExecutionBackend | undefined;

  constructor(
    private readonly plugin: GrimoirePlugin,
    /** Held for the runtime half: a tab dispatches through the same registry. */
    readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /** What every open permission request is asking, for the tab that shows it. */
  get interactionBridge(): GrokInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime will reference its turns through. */
  get turnRequests(): GrokExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `grok agent … stdio` process.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership: a test that has to launch Grok to check how
   * a turn is composed is testing the wrong thing.
   */
  createBackend(
    clientFactory: ManagedAcpClientFactory = this.createClientFactory(),
  ): GrokExecutionBackend {
    const context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'> = {
      clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new GrokAcpDynamicConfigApplier({
        resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef),
      }),
      interactionBridge: this.interactions,
      resultSink: new GrokProjectionResultSink(),
      reconciler: {
        // What is known about a run this process did not see finish: nothing.
        // Grok's own session log could answer it — the legacy runtime reads
        // answers back from it — and until it is read the honest evidence is
        // `unknown` with effects possible, which is what makes the kernel
        // refuse to re-dispatch.
        reconcile: async () => ({ kind: 'unknown', effectsPossible: true }),
      },
      auxiliaryQueries: {
        execute: async () => {
          // Titles, refinement and inline edits still run on
          // `GrokAuxQueryRunner` until M5, and this composition has no
          // reference space of its own for them. Refused rather than answered
          // emptily: an auxiliary turn that silently returns nothing is the
          // failure mode this migration exists to remove.
          throw new Error('Grok auxiliary execution is not wired to the kernel yet.');
        },
      },
      scheduler: {
        setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle: unknown) => window.clearTimeout(
          handle as ReturnType<typeof setTimeout>,
        ),
      },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      interactionIdFactory: () => interactionId(opaqueId('ix')),
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 10 * 60_000,
      maxResultBytes: MAX_RESULT_BYTES,
    };
    this.backend = new GrokExecutionBackend(context);
    return this.backend;
  }

  /**
   * The backend as the kernel registers it, with its two side ports.
   *
   * `interactions` is not optional dressing: the registry refuses to resolve an
   * interaction for a backend that declared no resolution port, so ACP's
   * permission requests would hang the turn that raised them.
   */
  createBackendRegistration(clientFactory?: ManagedAcpClientFactory): BackendLifecycleRegistration {
    const backend = clientFactory ? this.createBackend(clientFactory) : this.createBackend();
    return { backend, interactions: backend, recovery: backend };
  }

  /** Drops every reference held for turns that will never dispatch. */
  dispose(): void {
    this.requests.dispose();
  }

  private createClientFactory(): ManagedAcpClientFactory {
    return new AcpManagedClientAdapterFactory({
      clientInfo: {
        name: 'grimoire',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      // The three updates Grok sends under its own method name, without which
      // a turn's usage and its stop reason never reach the surface.
      vendorSessionNotifications: {
        methods: GROK_SESSION_NOTIFICATION_METHODS,
        parse: (method, params) => parseGrokSessionNotification(method, params),
      },
      processLauncher: new NodeManagedAcpProcessLauncher({
        resolve: startupRef => this.requests.resolveLaunch(startupRef),
      }),
    });
  }

  /**
   * Everything a queued turn is launched under, read now rather than when it
   * was queued.
   *
   * The permission policy and the reasoning effort are read here because they
   * are arguments: a turn queued before either changed must not be dispatched
   * into a process started under the old ones, and the launch key is what makes
   * the backend restart instead.
   */
  private async environment(): Promise<GrokInvocationEnvironment> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'grok',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('grok') ?? 'grok';
    const permissionMode = resolveGrokPermissionModeForSettings(settings.permissionMode);
    const reasoningEffort = typeof settings.effortLevel === 'string' ? settings.effortLevel : null;
    const promptSettings = {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath: cwd,
    };
    const artifacts = await prepareGrokLaunchArtifacts({
      permissionMode,
      settings: promptSettings,
      workspaceRoot: cwd,
    });
    const runtimeEnv = buildGrokRuntimeEnv(this.plugin.settings, executable, artifacts.grokHomePath);
    return {
      executable,
      arguments: buildGrokAgentProcessArgs(reasoningEffort, permissionMode),
      cwd,
      environment: definedEnvironment({
        ...runtimeEnv,
        PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
      }),
      grokHomePath: artifacts.grokHomePath,
      // The legacy runtime's launch key, unchanged: everything a running
      // process cannot be told about after it has started, which for this
      // provider includes both of the flags it was started with.
      launchKey: JSON.stringify({
        artifactKey: artifacts.launchKey,
        command: executable,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'grok'),
        grokHomePath: artifacts.grokHomePath,
        permissionMode,
        promptKey: computeSystemPromptKey(promptSettings),
        reasoningEffort,
      }),
      mcpServers: ProviderWorkspaceRegistry.getMcpServerManager('grok')?.getServers() ?? [],
    };
  }
}

function definedEnvironment(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
