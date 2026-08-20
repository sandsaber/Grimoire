import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import {
  executionSessionId,
  interactionId,
  runId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type {
  BackendLifecycleRegistration,
  ExecutionLifecycleRegistry,
} from '@/core/execution/ExecutionLifecycleRegistry';
import { computeSystemPromptKey } from '@/core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import type {
  ProviderCommandDescriptor,
  ProviderFeatureContributions,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import {
  type BoundConversation,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeHostPorts,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type {
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import { createOpencodeModuleContext } from '@/providers/opencode/app/OpencodeModuleContext';
import { opencodePlanUsageStore } from '@/providers/opencode/app/OpencodePlanUsageStore';
import { OPENCODE_PROVIDER_CAPABILITIES } from '@/providers/opencode/capabilities';
import type { OpencodeAcpDynamicConfig } from '@/providers/opencode/execution/OpencodeAcpDynamicConfig';
import { OpencodeAcpDynamicConfigApplier } from '@/providers/opencode/execution/OpencodeAcpDynamicConfig';
import { OpencodeContentPresenter } from '@/providers/opencode/execution/OpencodeContentPresenter';
import {
  OpencodeExecutionBackend,
  type OpencodeExecutionBackendContext,
} from '@/providers/opencode/execution/OpencodeExecutionBackend';
import {
  OpencodeExecutionRequests,
  type OpencodeInvocationEnvironment,
} from '@/providers/opencode/execution/OpencodeExecutionRequests';
import { OpencodeInteractionBridge } from '@/providers/opencode/execution/OpencodeInteractionBridge';
import { OpencodeInteractionPresenter } from '@/providers/opencode/execution/OpencodeInteractionPresenter';
import { OpencodeProjectionResultSink } from '@/providers/opencode/execution/OpencodeProjectionResultSink';
import { OpencodeSessionConfigState } from '@/providers/opencode/execution/OpencodeSessionConfigState';
import { opencodeProviderModule } from '@/providers/opencode/OpencodeProviderModule';
import {
  buildOpencodePromptBlocks,
  buildOpencodePromptText,
} from '@/providers/opencode/runtime/buildOpencodePrompt';
import { prepareOpencodeLaunchArtifacts } from '@/providers/opencode/runtime/OpencodeLaunchArtifacts';
import { buildOpencodeRuntimeEnv } from '@/providers/opencode/runtime/OpencodeRuntimeEnvironment';
import type { OpencodeProviderSettings } from '@/providers/opencode/settings';
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

  private readonly presenters = new Set<OpencodeInteractionPresenter>();
  private readonly disposers: Array<() => void> = [];

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

  /**
   * The OpenCode chat runtime, over the kernel.
   *
   * One per tab, matching how `ProviderRegistry` constructs runtimes today.
   * Four things are built per tab rather than shared, each for the same reason
   * — they are about *this* conversation's session: what it is set to, what it
   * has said, what commands it offers, and which prompt is on screen.
   */
  createRuntime(): ChatRuntime {
    let conversation: BoundConversation | null = null;
    let adapter: OpencodeRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    const boundConversation = (): BoundConversation | null => conversation;

    const sessionConfig = new OpencodeSessionConfigState({
      settingsBag: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      refreshSelectors: () => this.refreshSelectors(),
      // Read late: the surface installs its callbacks on the runtime after this
      // constructs, so a captured callback would be the one that was not there.
      syncPermissionMode: permissionMode => {
        const sync = adapter?.interactionCallbacks().permissionModeSync;
        if (typeof sync === 'function') {
          (sync as (mode: string) => void)(permissionMode);
        }
      },
    });

    const content = new OpencodeContentPresenter({
      displayModel: () => sessionConfig.getActiveDisplayModel(),
      // The session's own slash commands, which arrive as an update rather than
      // as an answer to anything. Held here so the tab can list them without a
      // second OpenCode process being launched to ask.
      onCommands: commands => {
        sessionCommands = commands.map(command => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
          source: 'session' as const,
        }));
      },
      onConfigOptions: configOptions => this.settle(
        sessionConfig.syncSessionModelState({ configOptions: [...configOptions] }),
      ),
      onCurrentMode: currentModeId => this.settle(
        sessionConfig.syncSessionModeState({ currentModeId }),
      ),
      onSessionOpened: opening => this.settle((async () => {
        await sessionConfig.syncSessionModelState({
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          models: opening.models ?? null,
        });
        await sessionConfig.syncSessionModeState({
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          // OpenCode reports its own default agent here, not the user's pick.
          emitPermissionSync: false,
          modes: opening.modes ?? null,
        });
      })()),
      onCost: cost => {
        if (opencodePlanUsageStore.recordCost(cost ?? null)) {
          this.refreshSelectors();
        }
      },
    });

    const presenter = new OpencodeInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    this.disposers.push(this.interactions.onSettled(ref => presenter.dismiss(ref)));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => ({
        isCompact: false,
        mcpMentions: request.enabledMcpServers ?? new Set<string>(),
        persistedContent: '',
        prompt: buildOpencodePromptText(request),
        request,
      }),
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => {
        // Carried into the prompt only when no session can carry it itself: a
        // bound session already holds the conversation, and sending the history
        // again would say everything twice.
        const bootstrap = ports.currentSessionId() ? [] : history ?? [];
        const dynamic = this.dynamicConfiguration(sessionConfig, options);
        return this.requests.reference({
          prompt: buildOpencodePromptBlocks(turn.request, [...bootstrap], {
            ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
          }),
          ...(dynamic ? { dynamic } : {}),
        });
      },
      reasoningControl: OPENCODE_PROVIDER_CAPABILITIES.reasoningControl,
      // The ACP session this conversation is on. The presenter's copy comes
      // second because a new conversation learns its session mid-turn, and the
      // record is written only after that turn ends.
      currentSessionId: () => conversation?.sessionId ?? content.lastSessionId() ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          // A different conversation is a different ACP session, and what the
          // previous one was set to says nothing about this one.
          content.forgetConversation();
          sessionConfig.forgetSession();
          sessionCommands = [];
        }
        conversation = next;
      },
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter,
      reportCleanupFailure: error => {
        this.plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'opencode',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers
    // about *this tab's* conversation, so the context has to close over the
    // same one the ports above sync.
    const contributions = opencodeProviderModule.features(
      createOpencodeModuleContext(this.plugin, boundConversation),
    );

    const runtime = new OpencodeRuntimeAdapter(
      {
        registry: this.registry,
        backendId: opencodeProviderModule.execution.descriptor.backendId,
        capabilities: opencodeProviderModule.capabilities,
        // Minted per runtime because the construction call site has no
        // conversation to bind one to; it moves to the catalog at M3.
        owner: { kind: 'conversation', ownerId: opaqueId('opencodetab') },
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      {
        // The commands the open session announced, which is what the legacy
        // runtime listed and what the catalog cannot know.
        runtimeCommands: { listForSession: async () => sessionCommands },
        // Reloading the vault's servers is what the tab asks for; the restart
        // that makes a running process see them is the launch key's job.
        mcp: {
          loadServers: async () => {
            const manager = ProviderWorkspaceRegistry.getMcpServerManager('opencode');
            await manager?.loadServers();
            return (manager?.getServers() ?? []).map(server => ({
              id: server.name,
              label: server.name,
              enabled: server.enabled,
            }));
          },
          saveServers: () => notWiredHere('saveServers'),
          start: () => notWiredHere('start'),
          stop: () => notWiredHere('stop'),
        },
      },
      () => {
        // The tab closing is when the prompts it raised stop being anyone's.
        presenter.dismissAll();
        this.presenters.delete(presenter);
      },
    );
    adapter = runtime;
    return runtime;
  }

  /** Drops every reference held, and takes down whatever is on screen. */
  dispose(): void {
    // Taken down before the subscriptions are dropped: unsubscribing first
    // empties the set this iterates, and the prompts stay on screen.
    for (const presenter of this.presenters) {
      presenter.dismissAll();
    }
    for (const disposer of this.disposers.splice(0)) {
      disposer();
    }
    this.presenters.clear();
    this.requests.dispose();
  }

  /**
   * What this turn asks the session to be set to.
   *
   * Sent every turn rather than only when it changes, because the session a
   * turn lands on is decided at dispatch — it may be one this tab never
   * configured, created by the backend after the old one went missing. The
   * applier skips whatever is empty.
   */
  private dynamicConfiguration(
    sessionConfig: OpencodeSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): OpencodeAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const effortValue = sessionConfig.resolveSelectedEffortValue();
    const effortConfigId = sessionConfig.effortConfigId;
    const dynamic: OpencodeAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(effortConfigId && effortValue
        ? { effort: { configId: effortConfigId, value: effortValue } }
        : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /** Redraws the model and mode selectors of every open view. */
  private refreshSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  /**
   * Runs a settings sync the content channel started, and reports what failed.
   *
   * The presenter's ports are synchronous because presenting a chunk is; what
   * they start is a write to the vault's settings. A rejection here would
   * otherwise be an unhandled one, and the tab would show no sign that its
   * model list did not update.
   */
  private settle(task: Promise<void>): void {
    void task.catch(error => {
      this.plugin.recordDebugLog({
        error,
        event: 'execution.sessionConfig.failed',
        level: 'warn',
        scope: 'opencode',
      });
    });
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
    const mcpServers = ProviderWorkspaceRegistry.getMcpServerManager('opencode')?.getServers() ?? [];
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
        // Added to the legacy key rather than inherited from it: the legacy
        // runtime shut the process down on an MCP reload, and a session that
        // is already loaded is never told about a server list that changed
        // under it. Here the fingerprint is what restarts the process, so the
        // next turn's session is created with the servers the vault now has.
        mcpServers,
      }),
      mcpServers,
    };
  }
}

/**
 * The three MCP members a chat tab never calls.
 *
 * Editing the server list is a settings surface, served by the workspace
 * registration; refusing by name keeps a wrong call visible instead of making
 * it look like it worked.
 */
function notWiredHere(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `OpenCode MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
  ));
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


/**
 * The adapter for one OpenCode tab, plus the one lifecycle it has no port for.
 *
 * A tab closing is when the prompts it raised and the turns it queued stop
 * being anyone's; waiting for its next turn is waiting for one that never
 * comes.
 */
class OpencodeRuntimeAdapter extends ExecutionChatRuntimeAdapter<OpencodeProviderSettings> {
  constructor(
    context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[1],
    features: ProviderFeatureContributions<OpencodeProviderSettings>,
    workspace: ProviderWorkspaceSlots,
    private readonly releaseTab: () => void,
  ) {
    super(context, ports, features, workspace);
  }

  override async cleanup(): Promise<void> {
    try {
      await super.cleanup();
    } finally {
      this.releaseTab();
    }
  }
}
