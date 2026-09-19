import { randomUUID } from 'node:crypto';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import { delayThroughWindow } from '@/app/execution/hostTimers';
import { ProviderWorkspaceHolder } from '@/app/execution/ProviderWorkspaceHolder';
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
import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';
import type {
  ProviderCommandDescriptor,
  ProviderRuntimePorts,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import {
  type BoundConversation,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeHostPorts,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type {
  ApprovalCallback,
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import { resolveRunAbsoluteTimeoutMs } from '@/core/types/settings';
import type GrimoirePlugin from '@/main';
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { AcpWorkspaceFileSystem } from '@/providers/acp/execution/AcpWorkspaceFileSystem';
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import { createReasonixModuleContext } from '@/providers/reasonix/app/ReasonixModuleContext';
import { reasonixPlanUsageStore } from '@/providers/reasonix/app/ReasonixPlanUsageStore';
import { maybeGetReasonixWorkspaceServices } from '@/providers/reasonix/app/ReasonixWorkspaceServices';
import type { ReasonixAcpDynamicConfig } from '@/providers/reasonix/execution/ReasonixAcpDynamicConfig';
import { ReasonixAcpDynamicConfigApplier } from '@/providers/reasonix/execution/ReasonixAcpDynamicConfig';
import { ReasonixContentPresenter } from '@/providers/reasonix/execution/ReasonixContentPresenter';
import {
  ReasonixExecutionBackend,
  type ReasonixExecutionBackendContext,
} from '@/providers/reasonix/execution/ReasonixExecutionBackend';
import {
  REASONIX_ACP_ARGUMENTS,
  ReasonixExecutionRequests,
  type ReasonixInvocationEnvironment,
} from '@/providers/reasonix/execution/ReasonixExecutionRequests';
import {
  ReasonixInteractionBridge,
  ReasonixInteractionPresenter,
} from '@/providers/reasonix/execution/ReasonixInteractionBridge';
import {
  type ReasonixMetadataLaunch,
  ReasonixMetadataSession,
} from '@/providers/reasonix/execution/ReasonixMetadataSession';
import { ReasonixProjectionResultSink } from '@/providers/reasonix/execution/ReasonixProjectionResultSink';
import { ReasonixSessionConfigState } from '@/providers/reasonix/execution/ReasonixSessionConfigState';
import { withReasonixSessionRecovery } from '@/providers/reasonix/execution/ReasonixSessionRecovery';
import { resolveReasonixModelCatalogFingerprint } from '@/providers/reasonix/modelCatalogFingerprint';
import { reasonixProviderModule } from '@/providers/reasonix/ReasonixProviderModule';
import {
  buildReasonixPromptBlocks,
  buildReasonixPromptText,
} from '@/providers/reasonix/runtime/buildReasonixPrompt';
import { buildReasonixRuntimeEnv } from '@/providers/reasonix/runtime/ReasonixRuntimeEnvironment';
import {
  parseReasonixSessionNotification,
  REASONIX_SESSION_NOTIFICATION_METHODS,
} from '@/providers/reasonix/runtime/ReasonixSessionNotifications';
import { getReasonixProviderSettings } from '@/providers/reasonix/settings';
import { getReasonixState } from '@/providers/reasonix/types';
import { getVaultPath } from '@/utils/path';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * Reasonix CLI chat execution, assembled from the running plugin.
 *
 * The eighth ACP provider on the kernel: Devin's composition, minus the
 * tool-call memory that provider needs and this one does not. A Reasonix
 * permission request arrives with its title, kind, input and locations already
 * on it, so nothing has to be remembered to describe it. What it does not send
 * is the usage update — `ReasonixSessionNotifications` makes one out of the
 * vendor status notification, which is the only place the tokens are.
 *
 * It owns three things a tab cannot: the backend every tab dispatches through,
 * the permission bridge every prompt is prepared by, and the isolated metadata
 * session the model catalog and the settings tab ask their questions in.
 * Everything else is built per tab in `createRuntime`.
 */
export class ReasonixExecution {
  private readonly requests = new ReasonixExecutionRequests(
    () => opaqueId('rxreq'),
    () => this.environment(),
  );

  /** One bridge for every tab, because the backend is one. */
  private readonly interactions = new ReasonixInteractionBridge(() => opaqueId('rxix'));

  private metadataSession: ReasonixMetadataSession | undefined;
  private clientFactory: ManagedAcpClientFactory | undefined;

  /** Which tab answers for a write on which ACP session. */
  private readonly writeApprovers = new Map<string, () => ApprovalCallback | undefined>();

  private readonly presenters = new Set<ReasonixInteractionPresenter>();

  /**
   * How many times the vault's workspace resources have changed under a
   * running agent. Part of the launch key: this CLI reads `.reasonix/skills` and
   * `.agents/skills` when it starts, and a process already running was told
   * them once.
   */
  private workspaceGeneration = 0;

  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    reasonixProviderModule.workspace,
    () => createReasonixModuleContext(this.plugin, () => null,
      {
        sessionCommands: () => runtimeOnly('sessionCommands'),
        sessionDropped: () => runtimeOnly('sessionDropped'),
      }),
  );

  constructor(
    private readonly plugin: GrimoirePlugin,
    readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /** What every open permission request is asking, for the tab that shows it. */
  get interactionBridge(): ReasonixInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime references its turns through. */
  get turnRequests(): ReasonixExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `reasonix acp` process by default.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership.
   */
  createBackend(
    clientFactory: ManagedAcpClientFactory = this.clientFactory ?? this.createClientFactory(),
  ): ReasonixExecutionBackend {
    this.clientFactory = clientFactory;
    const context: ReasonixExecutionBackendContext = {
      clientFactory: withReasonixSessionRecovery(clientFactory, this.requests),
      requestResolver: this.requests,
      dynamicApplier: new ReasonixAcpDynamicConfigApplier(
        { resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef) },
        ({ method, modeId, error }) => this.plugin.recordDebugLog({
          error,
          event: 'execution.setMode.refused',
          level: 'warn',
          scope: 'reasonix',
          // Both, because one Grimoire mode is two calls: the mode says what
          // the person asked for and the method says which half refused it.
          data: { method, modeId },
        }),
      ),
      interactionBridge: this.interactions,
      resultSink: new ReasonixProjectionResultSink(),
      reconciler: {
        // A turn that answered the cancel it was sent is a turn known to have
        // stopped — recorded: `session/cancel` answers `stopReason: cancelled`.
        // For anything else what is known is nothing, and this provider has no
        // session log to ask.
        reconcile: async query => acpCancellationEvidence(query)
          ?? { kind: 'unknown', effectsPossible: true },
      },
      auxiliaryQueries: {
        execute: async () => {
          throw new Error('Reasonix auxiliary execution is not wired to the kernel yet.');
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
      runAbsoluteTimeoutMs: () => resolveRunAbsoluteTimeoutMs(this.plugin.settings),
      maxResultBytes: MAX_RESULT_BYTES,
    };
    return new ReasonixExecutionBackend(context);
  }

  /** The backend as the kernel registers it, with its two side ports. */
  createBackendRegistration(clientFactory?: ManagedAcpClientFactory): BackendLifecycleRegistration {
    const backend = clientFactory ? this.createBackend(clientFactory) : this.createBackend();
    return { backend, interactions: backend, recovery: backend };
  }

  /** This provider's workspace slots, built on the first question. */
  workspace(): Promise<ProviderWorkspaceSlots> {
    return this.workspaceHolder.resolve();
  }

  /** The workspace if it has already been built, and nothing if it has not. */
  builtWorkspace(): ProviderWorkspaceSlots | null {
    return this.workspaceHolder.peek() ?? null;
  }

  /** The Reasonix chat runtime, over the kernel. One per tab. */
  createRuntime(): ExecutionChatRuntimeAdapter {
    let conversation: BoundConversation | null = null;
    let adapter: ReasonixRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    let sessionDropped = false;
    const ownedSessions = new Set<string>();
    const boundConversation = (): BoundConversation | null => conversation;
    const reasonixTab = opaqueId('reasonixtab');

    const sessionConfig = new ReasonixSessionConfigState({
      settingsBag: () => this.plugin.settings,
      catalogFingerprint: () => resolveReasonixModelCatalogFingerprint(
        this.plugin,
        getReasonixProviderSettings(this.plugin.settings),
      ),
    });

    const content = new ReasonixContentPresenter({
      displayModel: () => sessionConfig.getActiveDisplayModel(),
      onCurrentMode: currentModeId => {
        const permissionMode = sessionConfig.adoptCurrentMode(currentModeId);
        this.settle(this.plugin.saveSettings());
        const sync = adapter?.interactionCallbacks().permissionModeSync;
        if (typeof sync === 'function') {
          (sync as (mode: string) => void)(permissionMode);
        }
      },
      onSessionResume: outcome => { sessionDropped = outcome === 'replaced'; },
      onCommands: commands => {
        sessionCommands = commands.map(command => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
          source: 'session' as const,
        }));
      },
      onConfigOptions: configOptions => this.syncDiscovery(
        sessionConfig,
        { configOptions: [...configOptions] },
      ),
      onSessionOpened: opening => {
        // **One live session per tab, so the previous ones go.** A tab's
        // entries were only ever removed when it closed, while a new session id
        // is minted on every restart — and the launch key carries a workspace
        // generation that any vault change bumps. Left in, a dead id keeps a
        // closure over the tab for the life of the plugin, and a later tab that
        // resumed the same id would have its writes denied when the first tab
        // closed and deleted the entry it was still using.
        for (const previous of ownedSessions) {
          if (previous !== opening.sessionId) {
            this.writeApprovers.delete(previous);
          }
        }
        ownedSessions.clear();
        ownedSessions.add(opening.sessionId);
        this.writeApprovers.set(
          opening.sessionId,
          () => adapter?.interactionCallbacks().approval as ApprovalCallback | undefined,
        );
        this.syncDiscovery(sessionConfig, {
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          models: opening.models ?? null,
          modes: opening.modes ?? null,
        });
      },
      onCost: cost => {
        if (reasonixPlanUsageStore.recordCost(cost ?? null)) {
          this.refreshSelectors();
        }
      },
    });

    const presenter = new ReasonixInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    const releaseSettled = this.interactions.onSettled(ref => presenter.dismiss(ref));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => {
        // Built once: it is eight context appends over every attached note, and
        // the two fields want the same string.
        const prompt = buildReasonixPromptText(request);
        return {
          isCompact: false,
          mcpMentions: request.enabledMcpServers ?? new Set<string>(),
          persistedContent: prompt,
          prompt,
          request,
        };
      },
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => {
        content.beginTurn();
        const bootstrap = ports.currentSessionId() ? [] : history ?? [];
        const dynamic = this.dynamicConfiguration(sessionConfig, options);
        return this.requests.reference({
          prompt: buildReasonixPromptBlocks(turn.request, [...bootstrap], {
            ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
          }),
          ...(ports.currentSessionId() && history?.length ? {
            recoveryPrompt: () => buildReasonixPromptBlocks(turn.request, history, {
              ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
            }),
          } : {}),
          ...(dynamic ? { dynamic } : {}),
        });
      },
      currentSessionId: () => content.lastSessionId() ?? conversation?.sessionId ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          content.forgetConversation();
          sessionConfig.forgetSession();
          sessionCommands = [];
          sessionDropped = getReasonixState(next?.providerState).sessionDropped === true;
        }
        conversation = next;
      },
      sessionDropped: () => sessionDropped,
      describeFailure: reason => {
        if (reason === 'provider-failure' || reason === 'pre-dispatch-rejected') {
          const refused = content.consumeTurnRefusal();
          if (refused?.origin) {
            return describeAcpSessionOpenFailure('Reasonix', refused.message, refused.origin);
          }
          if (refused) {
            return refused.message;
          }
        }
        if (reason === 'provider-failure') {
          return undefined;
        }
        if (reason === 'spawn-failed') {
          return 'Grimoire could not start the Reasonix CLI. Set an absolute CLI path in the '
            + 'Reasonix settings — desktop apps do not inherit the shell PATH.';
        }
        if (reason === 'pre-dispatch-rejected') {
          return describeAcpSessionOpenFailure('Reasonix');
        }
        return undefined;
      },
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter,
      delay: delayThroughWindow,
      reloadWorkspaceResources: async () => {
        this.workspaceGeneration += 1;
      },
      reportCleanupFailure: error => {
        this.plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'reasonix',
        });
      },
    };

    const contributions = reasonixProviderModule.runtimePorts(
      createReasonixModuleContext(this.plugin, boundConversation, {
        sessionCommands: () => sessionCommands,
        sessionDropped: () => sessionDropped,
      }),
    );

    const runtime = new ReasonixRuntimeAdapter(
      {
        registry: this.registry,
        backendId: reasonixProviderModule.execution.descriptor.backendId,
        capabilities: reasonixProviderModule.capabilities,
        owner: () => (conversation?.id
          ? { kind: 'conversation', ownerId: conversation.id }
          : { kind: 'internal-service', ownerId: reasonixTab }),
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      {
        runtimeCommands: { listForSession: async () => sessionCommands },
        mcp: {
          load: async () => {
            const manager = maybeGetReasonixWorkspaceServices(this.plugin)?.mcpServerManager;
            await manager?.loadServers();
            return manager?.getServers() ?? [];
          },
          save: () => notWiredHere('save'),
        },
      },
      () => {
        presenter.dismissAll();
        releaseSettled();
        this.presenters.delete(presenter);
        for (const sessionId of ownedSessions) {
          this.writeApprovers.delete(sessionId);
        }
        ownedSessions.clear();
      },
    );
    adapter = runtime;
    return runtime;
  }

  /** What Grimoire asks Reasonix when nobody is having a conversation. */
  get metadata(): ReasonixMetadataSession {
    this.metadataSession ??= new ReasonixMetadataSession({
      clientFactory: this.clientFactory ??= this.createClientFactory(),
      launch: () => this.metadataLaunch(),
      settingsBag: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      refreshSelectors: () => this.refreshSelectors(),
    });
    return this.metadataSession;
  }

  /** Drops every reference held, and takes down whatever is on screen. */
  dispose(): void {
    void this.workspaceHolder.dispose().catch(() => undefined);
    for (const presenter of this.presenters) {
      presenter.dismissAll();
    }
    this.presenters.clear();
    this.requests.dispose();
  }

  /**
   * What this turn asks the session to be set to: the mode and the model,
   * resolved every turn because the session is decided at dispatch. The applier
   * skips a model the session already reports as current.
   */
  private dynamicConfiguration(
    sessionConfig: ReasonixSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): ReasonixAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const effortLevel = sessionConfig.resolveSelectedEffort();
    const dynamic: ReasonixAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(effortLevel ? { effortLevel } : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /** Keeps what a session reported about itself, and saves it if it was new. */
  private syncDiscovery(
    sessionConfig: ReasonixSessionConfigState,
    params: Parameters<ReasonixSessionConfigState['syncSessionDiscovery']>[0],
  ): void {
    if (!sessionConfig.syncSessionDiscovery(params)) {
      return;
    }
    this.settle(this.plugin.saveSettings());
    this.refreshSelectors();
  }

  /** Redraws the model and mode selectors of every open view. */
  private refreshSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  /** Runs a settings write the content channel started, and reports what failed. */
  private settle(task: Promise<void>): void {
    void task.catch(error => {
      this.plugin.recordDebugLog({
        error,
        event: 'execution.sessionConfig.failed',
        level: 'warn',
        scope: 'reasonix',
      });
    });
  }

  private createClientFactory(): ManagedAcpClientFactory {
    const fileSystem = new AcpWorkspaceFileSystem({
      providerLabel: 'Reasonix',
      resolveSession: () => ({
        cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
        allowOutsideWorkspace: this.fullAccess(),
      }),
      approveWrite: input => this.approveWrite(input),
    });
    return new AcpManagedClientAdapterFactory({
      clientInfo: {
        name: 'grimoire',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      // Declared, and therefore used: Reasonix writes through
      // `fs/write_text_file` (probed), and the write approval below is what
      // makes Safe mode safe whatever the agent's own gate decided.
      delegate: {
        fileSystem: {
          readTextFile: request => fileSystem.readTextFile(request),
          writeTextFile: request => fileSystem.writeTextFile(request),
        },
      },
      processLauncher: new NodeManagedAcpProcessLauncher({
        resolve: startupRef => this.requests.resolveLaunch(startupRef),
      }),
      // The turn's tokens and its cost ride on Reasonix's own notification and
      // nowhere else; without this the usage badge has nothing to draw.
      vendorSessionNotifications: {
        methods: [...REASONIX_SESSION_NOTIFICATION_METHODS],
        parse: parseReasonixSessionNotification,
      },
    });
  }

  private fullAccess(): boolean {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'reasonix',
    );
    return settings.permissionMode === 'full_access';
  }

  /**
   * Whether an ACP-delegated write may happen, asked of the tab that owns the
   * session it came in on. A write whose session belongs to no open tab is
   * refused rather than allowed by default.
   */
  private async approveWrite(input: {
    readonly sessionId: string;
    readonly requestPath: string;
    readonly resolvedPath: string;
  }): Promise<boolean> {
    if (this.fullAccess()) {
      return true;
    }
    const approval = this.writeApprovers.get(input.sessionId)?.();
    if (!approval) {
      return false;
    }
    const decision = await approval(
      'write',
      { path: input.resolvedPath, relativePath: input.requestPath },
      `Reasonix wants to write ${input.requestPath}.`,
      { decisionReason: 'File write permission required' },
    );
    return decision === 'allow' || decision === 'allow-always';
  }

  /** The process a question is asked in, which is nobody's conversation. */
  private async metadataLaunch(): Promise<ReasonixMetadataLaunch> {
    const environment = await this.environment();
    return {
      startupRef: this.requests.referenceLaunch({
        executable: environment.executable,
        arguments: [...REASONIX_ACP_ARGUMENTS],
        cwd: environment.cwd,
        environment: { ...environment.environment },
      }),
      cwd: environment.cwd,
      mcpServers: toAcpMcpServers([...environment.mcpServers]),
    };
  }

  /** Everything a queued turn is launched under, read now rather than when it was queued. */
  private async environment(): Promise<ReasonixInvocationEnvironment> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('reasonix') ?? 'reasonix';
    const runtimeEnv = buildReasonixRuntimeEnv(this.plugin.settings, executable);
    const mcpServers = maybeGetReasonixWorkspaceServices(this.plugin)?.mcpServerManager?.getServers() ?? [];
    return {
      executable,
      cwd,
      environment: definedEnvironment(runtimeEnv),
      // A change to any of these restarts the process, so the next turn's
      // session is created with the servers and skills the vault now has.
      launchKey: JSON.stringify({
        command: executable,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'reasonix'),
        mcpServers,
        workspaceGeneration: this.workspaceGeneration,
      }),
      mcpServers,
    };
  }
}

function notWiredHere(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `Reasonix MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
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

/** The adapter for one Reasonix tab, plus the one lifecycle it has no port for. */
class ReasonixRuntimeAdapter extends ExecutionChatRuntimeAdapter {
  constructor(
    context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[1],
    features: ProviderRuntimePorts,
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

/** A runtime port reached from a workspace context, refused rather than answered. */
function runtimeOnly(port: string): never {
  throw new Error(`Runtime port "${port}" is not available from a workspace context.`);
}
