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
import { OpencodeAcpDynamicConfigApplier } from '@/providers/opencode/execution/OpencodeAcpDynamicConfig';
import {
  OpencodeExecutionBackend,
  type OpencodeExecutionBackendContext,
} from '@/providers/opencode/execution/OpencodeExecutionBackend';
import {
  OpencodeExecutionRequests,
  type OpencodeInvocationEnvironment,
} from '@/providers/opencode/execution/OpencodeExecutionRequests';
import { OpencodeInteractionBridge } from '@/providers/opencode/execution/OpencodeInteractionBridge';
import { OpencodeProjectionResultSink } from '@/providers/opencode/execution/OpencodeProjectionResultSink';
import { prepareOpencodeLaunchArtifacts } from '@/providers/opencode/runtime/OpencodeLaunchArtifacts';
import { buildOpencodeRuntimeEnv } from '@/providers/opencode/runtime/OpencodeRuntimeEnvironment';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * OpenCode chat execution, assembled from the running plugin.
 *
 * **Dark.** Nothing constructs this yet: `registration.ts` still points
 * `createRuntime` at `OpencodeChatRuntime`, and the flip is a later checkpoint.
 *
 * The first ACP provider to reach the kernel, and the shape shows it. Where
 * Codex resolves a daemon and Claude an SDK query, this resolves **three**
 * reference spaces — the turn, the process to spawn, and the session config to
 * apply — because an ACP session is configured after it exists rather than when
 * it is created. The protocol half is already generic: the client adapter, the
 * transport and the process launcher are shared with every ACP provider that
 * follows, so what this composition adds is the OpenCode-specific launch and
 * nothing else.
 *
 * Two things are deliberately **not** here, each its own increment and each
 * named so a flip cannot land while it is missing:
 *
 * - **the content surface is built but unwired.** The backend forwards every
 *   session update and the prompt's own answer, and `OpencodeContentPresenter`
 *   turns them into chunks — but nothing constructs it here, because what
 *   consumes a presenter is the tab runtime, which is the increment after this
 *   one. Its four ports — commands, config options, mode, cost — are what the
 *   runtime half must answer for, or a flipped tab loses its model selector,
 *   its slash commands and its plan indicator;
 * - **the surface an interaction is shown on.** `OpencodeInteractionBridge` is
 *   wired below and carries every permission request the agent raises, but
 *   what puts one on screen and answers it is the tab's presenter — and a
 *   presenter reads callbacks the tab installs, which is the runtime half.
 */
export class OpencodeExecution {
  private readonly requests = new OpencodeExecutionRequests(
    () => opaqueId('ocreq'),
    () => this.environment(),
  );

  /**
   * One bridge for every tab, because the backend is one and it prepares every
   * request through the bridge it was built with. A per-tab bridge would leave
   * the presentation for a request in a map the presenter cannot read.
   */
  private readonly interactions = new OpencodeInteractionBridge(() => opaqueId('ocix'));

  private backend: OpencodeExecutionBackend | undefined;

  constructor(
    private readonly plugin: GrimoirePlugin,
    /**
     * Held for the runtime half, which is the increment after this one: a tab's
     * adapter dispatches through the same registry the backend is registered
     * with, and taking it later would mean two objects disagreeing about which.
     */
    readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /** What every open permission request is asking, for the tab that shows it. */
  get interactionBridge(): OpencodeInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime will reference its turns through. */
  get turnRequests(): OpencodeExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `opencode acp` process by default.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership: a test that has to launch OpenCode to check
   * how a turn is composed is testing the wrong thing.
   */
  createBackend(
    clientFactory: ManagedAcpClientFactory = this.createClientFactory(),
  ): OpencodeExecutionBackend {
    const context: OpencodeExecutionBackendContext = {
      clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new OpencodeAcpDynamicConfigApplier({
        resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef),
      }),
      interactionBridge: this.interactions,
      resultSink: new OpencodeProjectionResultSink(),
      reconciler: {
        // What is known about a run this process did not see finish: nothing.
        // OpenCode's own session database could answer it, and until it is read
        // the honest evidence is `unknown` with effects possible — which is
        // what makes the kernel refuse to re-dispatch.
        reconcile: async () => ({ kind: 'unknown', effectsPossible: true }),
      },
      auxiliaryQueries: {
        execute: async () => {
          // Titles, refinement and inline edits still run on
          // `OpencodeAuxQueryRunner` until M5, and this composition has no
          // reference space of its own for them. Refused rather than answered
          // emptily: an auxiliary turn that silently returns nothing is the
          // failure mode this migration exists to remove.
          throw new Error('OpenCode auxiliary execution is not wired to the kernel yet.');
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
    this.backend = new OpencodeExecutionBackend(context);
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
      processLauncher: new NodeManagedAcpProcessLauncher({
        resolve: startupRef => this.requests.resolveLaunch(startupRef),
      }),
    });
  }

  /**
   * Everything a queued turn is launched under, read now rather than when it
   * was queued.
   *
   * The artifacts are written here, before the reference is minted, because
   * they are what the launch *is*: OpenCode reads its config and system prompt
   * from files, so a process spawned before they exist runs under the previous
   * turn's configuration.
   */
  private async environment(): Promise<OpencodeInvocationEnvironment> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'opencode',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('opencode') ?? 'opencode';
    const runtimeEnv = buildOpencodeRuntimeEnv(settings, executable);
    const promptSettings = {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath: cwd,
    };
    const artifacts = await prepareOpencodeLaunchArtifacts({
      runtimeEnv,
      settings: promptSettings,
      workspaceRoot: cwd,
    });
    return {
      executable,
      cwd,
      environment: definedEnvironment({
        ...runtimeEnv,
        OPENCODE_CONFIG: artifacts.configPath,
        PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
      }),
      // The legacy runtime's launch key, unchanged: what a running process
      // cannot be told about after it has started.
      launchKey: JSON.stringify({
        command: executable,
        configPath: artifacts.configPath,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'opencode'),
        promptKey: computeSystemPromptKey(promptSettings),
        artifactKey: artifacts.launchKey,
      }),
      mcpServers: ProviderWorkspaceRegistry.getMcpServerManager('opencode')?.getServers() ?? [],
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
