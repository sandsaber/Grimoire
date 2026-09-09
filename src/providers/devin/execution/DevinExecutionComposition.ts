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
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import { createDevinModuleContext } from '@/providers/devin/app/DevinModuleContext';
import { devinPlanUsageStore } from '@/providers/devin/app/DevinPlanUsageStore';
import { maybeGetDevinWorkspaceServices } from '@/providers/devin/app/DevinWorkspaceServices';
import { devinProviderModule } from '@/providers/devin/DevinProviderModule';
import type { DevinAcpDynamicConfig } from '@/providers/devin/execution/DevinAcpDynamicConfig';
import { DevinAcpDynamicConfigApplier } from '@/providers/devin/execution/DevinAcpDynamicConfig';
import { DevinAcpFileSystem } from '@/providers/devin/execution/DevinAcpFileSystem';
import { DevinContentPresenter } from '@/providers/devin/execution/DevinContentPresenter';
import {
  DevinExecutionBackend,
  type DevinExecutionBackendContext,
} from '@/providers/devin/execution/DevinExecutionBackend';
import {
  DEVIN_ACP_ARGUMENTS,
  DevinExecutionRequests,
  type DevinInvocationEnvironment,
} from '@/providers/devin/execution/DevinExecutionRequests';
import {
  DevinInteractionBridge,
  DevinInteractionPresenter,
} from '@/providers/devin/execution/DevinInteractionBridge';
import {
  type DevinMetadataLaunch,
  DevinMetadataSession,
} from '@/providers/devin/execution/DevinMetadataSession';
import type { DevinToolCallRecord } from '@/providers/devin/execution/DevinPermissionPresentation';
import { DevinProjectionResultSink } from '@/providers/devin/execution/DevinProjectionResultSink';
import { DevinSessionConfigState } from '@/providers/devin/execution/DevinSessionConfigState';
import {
  buildDevinPromptBlocks,
  buildDevinPromptText,
} from '@/providers/devin/runtime/buildDevinPrompt';
import { buildDevinRuntimeEnv } from '@/providers/devin/runtime/DevinRuntimeEnvironment';
import { getDevinState } from '@/providers/devin/types';
import { getVaultPath } from '@/utils/path';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;
/** How many announced tool calls are kept for the permission requests that follow them. */
const TOOL_CALL_MEMORY = 64;

/**
 * Devin CLI chat execution, assembled from the running plugin.
 *
 * The seventh ACP provider on the kernel, and the first added after the
 * migration: it is Qwen's composition with the three Qwen-only pieces taken
 * out — the `/effort` prompt, the `context_usage` vendor request and the
 * ask-user-question bridge — because Devin has none of them (recorded in
 * `devin-wire.json`: the window rides on `usage_update`, and no question has
 * been seen on the permission channel).
 *
 * It owns three things a tab cannot: the backend every tab dispatches through,
 * the permission bridge every prompt is prepared by, and the isolated metadata
 * session the model catalog and the settings tab ask their questions in.
 * Everything else is built per tab in `createRuntime`.
 */
export class DevinExecution {
  private readonly requests = new DevinExecutionRequests(
    () => opaqueId('dvreq'),
    () => this.environment(),
  );

  /**
   * The tool calls every tab's session announced, by id.
   *
   * A permission request names its call by id and says nothing else about it;
   * the `tool_call` update that preceded it said everything. Held here because
   * the bridge is one for every tab and the updates arrive per tab.
   */
  private readonly toolCalls = new Map<string, DevinToolCallRecord>();

  /** One bridge for every tab, because the backend is one. */
  private readonly interactions = new DevinInteractionBridge(
    () => opaqueId('dvix'),
    toolCallId => this.toolCalls.get(toolCallId),
  );

  private metadataSession: DevinMetadataSession | undefined;
  private clientFactory: ManagedAcpClientFactory | undefined;

  /** Which tab answers for a write on which ACP session. */
  private readonly writeApprovers = new Map<string, () => ApprovalCallback | undefined>();

  private readonly presenters = new Set<DevinInteractionPresenter>();

  private backend: DevinExecutionBackend | undefined;

  /**
   * How many times the vault's workspace resources have changed under a
   * running agent. Part of the launch key: this CLI reads `.devin/skills` and
   * `.agents/skills` when it starts, and a process already running was told
   * them once.
   */
  private workspaceGeneration = 0;

  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    devinProviderModule.workspace,
    () => createDevinModuleContext(this.plugin, () => null,
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
  get interactionBridge(): DevinInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime references its turns through. */
  get turnRequests(): DevinExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `devin acp` process by default.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership.
   */
  createBackend(
    clientFactory: ManagedAcpClientFactory = this.clientFactory ?? this.createClientFactory(),
  ): DevinExecutionBackend {
    this.clientFactory = clientFactory;
    const context: DevinExecutionBackendContext = {
      clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new DevinAcpDynamicConfigApplier(
        { resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef) },
        ({ modeId, error }) => this.plugin.recordDebugLog({
          error,
          event: 'execution.setMode.refused',
          level: 'warn',
          scope: 'devin',
          data: { modeId },
        }),
      ),
      interactionBridge: this.interactions,
      resultSink: new DevinProjectionResultSink(),
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
          throw new Error('Devin auxiliary execution is not wired to the kernel yet.');
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
    this.backend = new DevinExecutionBackend(context);
    return this.backend;
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

  /** The Devin chat runtime, over the kernel. One per tab. */
  createRuntime(): ExecutionChatRuntimeAdapter {
    let conversation: BoundConversation | null = null;
    let adapter: DevinRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    let sessionDropped = false;
    const ownedSessions = new Set<string>();
    const boundConversation = (): BoundConversation | null => conversation;
    const devinTab = opaqueId('devintab');

    const sessionConfig = new DevinSessionConfigState({
      settingsBag: () => this.plugin.settings,
    });

    const content = new DevinContentPresenter({
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
        if (devinPlanUsageStore.recordCost(cost ?? null)) {
          this.refreshSelectors();
        }
      },
      onToolCall: call => this.rememberToolCall(call),
    });

    const presenter = new DevinInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    const releaseSettled = this.interactions.onSettled(ref => presenter.dismiss(ref));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => ({
        isCompact: false,
        mcpMentions: request.enabledMcpServers ?? new Set<string>(),
        persistedContent: buildDevinPromptText(request),
        prompt: buildDevinPromptText(request),
        request,
      }),
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => {
        content.beginTurn();
        const bootstrap = ports.currentSessionId() ? [] : history ?? [];
        const dynamic = this.dynamicConfiguration(sessionConfig, options);
        return this.requests.reference({
          prompt: buildDevinPromptBlocks(turn.request, [...bootstrap], {
            ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
          }),
          ...(dynamic ? { dynamic } : {}),
        });
      },
      currentSessionId: () => content.lastSessionId() ?? conversation?.sessionId ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          content.forgetConversation();
          sessionConfig.forgetSession();
          sessionCommands = [];
          sessionDropped = getDevinState(next?.providerState).sessionDropped === true;
        }
        conversation = next;
      },
      sessionDropped: () => sessionDropped,
      describeFailure: reason => {
        if (reason === 'provider-failure' || reason === 'pre-dispatch-rejected') {
          const refused = content.consumeTurnRefusal();
          if (refused?.origin) {
            return describeAcpSessionOpenFailure('Devin', refused.message, refused.origin);
          }
          if (refused) {
            return refused.message;
          }
        }
        if (reason === 'provider-failure') {
          return undefined;
        }
        if (reason === 'spawn-failed') {
          return 'Grimoire could not start the Devin CLI. Set an absolute CLI path in the '
            + 'Devin settings — desktop apps do not inherit the shell PATH.';
        }
        if (reason === 'pre-dispatch-rejected') {
          return describeAcpSessionOpenFailure('Devin');
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
          scope: 'devin',
        });
      },
    };

    const contributions = devinProviderModule.runtimePorts(
      createDevinModuleContext(this.plugin, boundConversation, {
        sessionCommands: () => sessionCommands,
        sessionDropped: () => sessionDropped,
      }),
    );

    const runtime = new DevinRuntimeAdapter(
      {
        registry: this.registry,
        backendId: devinProviderModule.execution.descriptor.backendId,
        capabilities: devinProviderModule.capabilities,
        owner: () => (conversation?.id
          ? { kind: 'conversation', ownerId: conversation.id }
          : { kind: 'internal-service', ownerId: devinTab }),
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      {
        runtimeCommands: { listForSession: async () => sessionCommands },
        mcp: {
          load: async () => {
            const manager = maybeGetDevinWorkspaceServices(this.plugin)?.mcpServerManager;
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

  /** What Grimoire asks Devin when nobody is having a conversation. */
  get metadata(): DevinMetadataSession {
    this.metadataSession ??= new DevinMetadataSession({
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
    this.toolCalls.clear();
    this.requests.dispose();
  }

  /**
   * What this turn asks the session to be set to: the mode and the model,
   * sent every turn because the session a turn lands on is decided at dispatch.
   */
  private dynamicConfiguration(
    sessionConfig: DevinSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): DevinAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const dynamic: DevinAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /** Keeps what a session reported about itself, and saves it if it was new. */
  private syncDiscovery(
    sessionConfig: DevinSessionConfigState,
    params: Parameters<DevinSessionConfigState['syncSessionDiscovery']>[0],
  ): void {
    if (!sessionConfig.syncSessionDiscovery(params)) {
      return;
    }
    this.settle(this.plugin.saveSettings());
    this.refreshSelectors();
  }

  /** Keeps a tool call for the request that may follow it, and no more than a few. */
  private rememberToolCall(call: DevinToolCallRecord): void {
    if (!call.toolCallId) {
      return;
    }
    this.toolCalls.delete(call.toolCallId);
    this.toolCalls.set(call.toolCallId, call);
    while (this.toolCalls.size > TOOL_CALL_MEMORY) {
      const oldest = this.toolCalls.keys().next();
      if (oldest.done) break;
      this.toolCalls.delete(oldest.value);
    }
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
        scope: 'devin',
      });
    });
  }

  private createClientFactory(): ManagedAcpClientFactory {
    const fileSystem = new DevinAcpFileSystem({
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
      // Declared, and therefore used: Devin writes through
      // `fs/write_text_file` (recorded), and the write approval below is the
      // whole of what makes `accept-edits` a Safe mode.
      delegate: {
        fileSystem: {
          readTextFile: request => fileSystem.readTextFile(request),
          writeTextFile: request => fileSystem.writeTextFile(request),
        },
      },
      processLauncher: new NodeManagedAcpProcessLauncher({
        resolve: startupRef => this.requests.resolveLaunch(startupRef),
      }),
    });
  }

  private fullAccess(): boolean {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'devin',
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
      `Devin wants to write ${input.requestPath}.`,
      { decisionReason: 'File write permission required' },
    );
    return decision === 'allow' || decision === 'allow-always';
  }

  /** The process a question is asked in, which is nobody's conversation. */
  private async metadataLaunch(): Promise<DevinMetadataLaunch> {
    const environment = await this.environment();
    return {
      startupRef: this.requests.referenceLaunch({
        executable: environment.executable,
        arguments: [...DEVIN_ACP_ARGUMENTS],
        cwd: environment.cwd,
        environment: { ...environment.environment },
      }),
      cwd: environment.cwd,
      mcpServers: toAcpMcpServers([...environment.mcpServers]),
    };
  }

  /** Everything a queued turn is launched under, read now rather than when it was queued. */
  private async environment(): Promise<DevinInvocationEnvironment> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('devin') ?? 'devin';
    const runtimeEnv = buildDevinRuntimeEnv(this.plugin.settings, executable);
    const mcpServers = maybeGetDevinWorkspaceServices(this.plugin)?.mcpServerManager?.getServers() ?? [];
    return {
      executable,
      cwd,
      environment: definedEnvironment(runtimeEnv),
      // A change to any of these restarts the process, so the next turn's
      // session is created with the servers and skills the vault now has.
      launchKey: JSON.stringify({
        command: executable,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'devin'),
        mcpServers,
        workspaceGeneration: this.workspaceGeneration,
      }),
      mcpServers,
    };
  }
}

function notWiredHere(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `Devin MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
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

/** The adapter for one Devin tab, plus the one lifecycle it has no port for. */
class DevinRuntimeAdapter extends ExecutionChatRuntimeAdapter {
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
