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
  ApprovalCallback,
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { AcpWorkspaceFileSystem } from '@/providers/acp/execution/AcpWorkspaceFileSystem';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { ManagedAcpExecutionBackendContext } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import { createGrokModuleContext } from '@/providers/grok/app/GrokModuleContext';
import { grokPlanUsageStore } from '@/providers/grok/app/GrokPlanUsageStore';
import { GROK_PROVIDER_CAPABILITIES } from '@/providers/grok/capabilities';
import {
  type GrokAcpDynamicConfig,
  GrokAcpDynamicConfigApplier,
} from '@/providers/grok/execution/GrokAcpDynamicConfig';
import { GrokContentPresenter } from '@/providers/grok/execution/GrokContentPresenter';
import { GrokExecutionBackend } from '@/providers/grok/execution/GrokExecutionBackend';
import {
  GrokExecutionRequests,
  type GrokInvocationEnvironment,
} from '@/providers/grok/execution/GrokExecutionRequests';
import {
  GrokInteractionBridge,
  GrokInteractionPresenter,
} from '@/providers/grok/execution/GrokInteractionBridge';
import { GrokProjectionResultSink } from '@/providers/grok/execution/GrokProjectionResultSink';
import { GrokSessionConfigState } from '@/providers/grok/execution/GrokSessionConfigState';
import { grokProviderModule } from '@/providers/grok/GrokProviderModule';
import {
  loadGrokSessionContextUsage,
  loadGrokSessionCost,
} from '@/providers/grok/history/GrokUsageMetadataStore';
import { resolveGrokPermissionModeForSettings } from '@/providers/grok/modes';
import { buildGrokPromptBlocks, buildGrokPromptText } from '@/providers/grok/runtime/buildGrokPrompt';
import { buildGrokAgentProcessArgs } from '@/providers/grok/runtime/GrokLaunchArgs';
import { prepareGrokLaunchArtifacts } from '@/providers/grok/runtime/GrokLaunchArtifacts';
import { applyGrokNativeModelCatalog, readGrokNativeModelCatalog } from '@/providers/grok/runtime/GrokModelsCache';
import {
  buildManagedGrokProcessEnv,
  resolveGrokSessionDirectory,
  resolveManagedGrokHomePath,
} from '@/providers/grok/runtime/GrokPaths';
import { buildGrokRuntimeEnv } from '@/providers/grok/runtime/GrokRuntimeEnvironment';
import {
  GROK_SESSION_NOTIFICATION_METHODS,
  parseGrokSessionNotification,
} from '@/providers/grok/runtime/GrokSessionNotifications';
import type { GrokProviderSettings } from '@/providers/grok/settings';
import type { GrokProviderState } from '@/providers/grok/types';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * What the account has spent, in Grok's own method name.
 *
 * No ACP method answers it, and the legacy runtime asks the live transport the
 * same question — the plan indicator is otherwise empty for this provider.
 */
const GROK_BILLING_METHOD = 'x.ai/billing';

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
 * It owns four things a tab cannot: the backend every tab dispatches through,
 * the permission bridge every prompt is prepared by, the vault's model catalog —
 * which Grok writes to the managed home rather than answering over ACP — and the
 * billing reader, which is account-wide and asks the live process directly.
 * Everything else is built per tab in `createRuntime`, because it is about one
 * conversation's session.
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

  /**
   * Which tab answers for a write, and which tab fills the badge, on which ACP
   * session.
   *
   * The filesystem delegate and the result sink both belong to the process; the
   * approval and the session log belong to a tab. These two maps are the only
   * things that know both.
   */
  private readonly writeApprovers = new Map<string, () => ApprovalCallback | undefined>();
  private readonly surfaceReaders = new Map<
    string,
    (present: (payload: unknown) => void) => Promise<void>
  >();

  private readonly presenters = new Set<GrokInteractionPresenter>();

  /** This composition's identity in the plan-usage store's reader table. */
  private readonly billingReaderOwner = {};

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
      resultSink: new GrokProjectionResultSink({
        fillSurface: input => this.fillSurface(input),
      }),
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
      clientObserver: {
        // A running process is when the vault can learn two things it cannot
        // learn otherwise: what models this Grok has, which it writes to the
        // managed home, and what the account has spent, which only the live
        // transport answers. The legacy runtime did both at the same two
        // moments.
        onClientReady: client => {
          this.hydrateNativeModelCatalog();
          grokPlanUsageStore.setBillingReader(
            async () => (await client.vendorRequest?.(GROK_BILLING_METHOD, {})) ?? null,
            this.billingReaderOwner,
          );
          void grokPlanUsageStore.refreshUsage({
            plugin: this.plugin,
            providerId: 'grok',
            settings: this.plugin.settings,
          }).then(usage => {
            if (usage) this.refreshSelectors();
          }).catch(() => undefined);
        },
        onClientLost: () => {
          grokPlanUsageStore.setBillingReader(null, this.billingReaderOwner);
        },
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

  /**
   * One tab's Grok runtime, over the kernel.
   *
   * One per tab, matching how `ProviderRegistry` constructs runtimes today.
   * Four things are built per tab rather than shared, each because it is about
   * *this* conversation's session: what it is set to, what it has said, what
   * commands it offers, and which prompt is on screen.
   */
  createRuntime(): ChatRuntime {
    let conversation: BoundConversation | null = null;
    let adapter: GrokRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    // Where this tab's session writes its transcript. Grok's history, its
    // context reading and its cost all come out of that directory, and the
    // conversation is saved pointing at it.
    let sessionDirPath: string | null = null;
    let workspacePath: string | null = null;
    const ownedSessions = new Set<string>();
    let sawTurnCost = false;
    const boundConversation = (): BoundConversation | null => conversation;

    const sessionConfig = new GrokSessionConfigState({
      settingsBag: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      refreshSelectors: () => this.refreshSelectors(),
      workspaceRoot: () => getVaultPath(this.plugin.app) ?? process.cwd(),
      cliPath: () => this.plugin.getResolvedProviderCliPath('grok') ?? 'grok',
      recordDebug: (event, data) => this.plugin.recordDebugLog({
        data,
        event,
        level: 'debug',
        scope: 'grok',
      }),
    });

    const content = new GrokContentPresenter({
      displayModel: () => sessionConfig.getActiveDisplayModel(),
      // The session's own slash commands, which arrive as an update rather than
      // as an answer to anything. Held here so the tab can list them without a
      // second Grok process being launched to ask.
      onCommands: commands => {
        sessionCommands = commands.map(command => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
          source: 'session' as const,
        }));
      },
      onCost: cost => {
        // What the vendor said this turn cost, in the unit it bills in. A turn
        // that reports one needs no session-log read; one that does not is what
        // `fillSurface` goes and reads.
        if (grokPlanUsageStore.recordCost(cost)) {
          sawTurnCost = true;
          this.refreshSelectors();
        }
      },
      // A `/model` typed into the composer changes the session under the tab,
      // and the toolbar is otherwise the last thing to know.
      onModelChanged: change => this.settle(sessionConfig.syncSessionModelState({}, {
        currentRawModelId: change.modelId,
      })),
      onSessionOpened: opening => this.settle((async () => {
        ownedSessions.add(opening.sessionId);
        this.writeApprovers.set(
          opening.sessionId,
          () => adapter?.interactionCallbacks().approval as ApprovalCallback | undefined,
        );
        const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
        workspacePath = cwd;
        sessionDirPath = resolveGrokSessionDirectory(
          opening.sessionId,
          cwd,
          sessionDirPath,
          buildManagedGrokProcessEnv(cwd),
        );
        this.surfaceReaders.set(
          opening.sessionId,
          present => this.readSessionSurface(opening.sessionId, present, {
            // A turn that reported its own cost needs no second opinion; the
            // context reading is asked for every turn, because no Grok turn
            // reports one.
            costWanted: () => !sawTurnCost,
            paths: () => ({
              ...(sessionDirPath ? { sessionDirPath } : {}),
              ...(workspacePath ? { workspacePath } : {}),
            }),
          }),
        );
        await sessionConfig.syncSessionModelState({
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          models: opening.models ?? null,
        });
        await sessionConfig.syncSessionModeState({
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          modes: opening.modes ?? null,
        });
      })()),
    });

    const presenter = new GrokInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    // Held by the tab, not by the composition: a subscription pushed onto a
    // shared list would outlive every tab that ever opened it.
    const releaseSettled = this.interactions.onSettled(ref => presenter.dismiss(ref));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => ({
        isCompact: false,
        mcpMentions: request.enabledMcpServers ?? new Set<string>(),
        persistedContent: request.text,
        prompt: buildGrokPromptText(request),
        request,
      }),
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => {
        // The turn boundary: what the normalizer and the tool stream carry is
        // this turn's, and the tokens the last prompt cost are not this
        // prompt's. Here rather than at dispatch because this is the one place
        // a turn is known to be starting.
        content.beginTurn();
        sawTurnCost = false;
        // Carried into the prompt only when no session can carry it itself: a
        // bound session already holds the conversation, and sending the history
        // again would say everything twice.
        const bootstrap = ports.currentSessionId() ? [] : history ?? [];
        const dynamic = this.dynamicConfiguration(sessionConfig, options);
        return this.requests.reference({
          prompt: buildGrokPromptBlocks(turn.request, [...bootstrap], {
            ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
          }),
          ...(dynamic ? { dynamic } : {}),
        });
      },
      reasoningControl: GROK_PROVIDER_CAPABILITIES.reasoningControl,
      /**
       * The ACP session this conversation is actually on.
       *
       * The presenter's copy comes first, for the reason OpenCode's live run
       * settled: it is read from the reply to `session/new` or `session/load`,
       * so it is the session the last turn really ran in. The conversation's
       * saved id is only what it was before, and a tab that kept reporting the
       * old one would save the conversation pointing at a session the agent no
       * longer has.
       */
      currentSessionId: () => content.lastSessionId() ?? conversation?.sessionId ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          // A different conversation is a different ACP session, and what the
          // previous one was set to says nothing about this one.
          content.forgetConversation();
          sessionConfig.forgetSession();
          sessionCommands = [];
          sessionDirPath = null;
          workspacePath = null;
        }
        conversation = next;
      },
      /**
       * The provider's words for a turn that never started.
       *
       * For this provider a pre-dispatch rejection is almost always the session
       * bind, and Grok answers an unknown session with a generic service
       * failure that names nothing — the same shape OpenCode has, and the same
       * dead end for a person reading it.
       */
      describeFailure: reason => (reason === 'pre-dispatch-rejected'
        ? 'Grok Build could not start this turn. If this conversation was resumed from a saved '
          + 'session, that session may no longer exist — starting a new chat will create one.'
        : undefined),
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter,
      reportCleanupFailure: error => {
        this.plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'grok',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers
    // about *this tab's* conversation, so the context has to close over the
    // same one the ports above sync.
    const contributions = grokProviderModule.features(
      createGrokModuleContext(this.plugin, boundConversation, {
        sessionPaths: () => ({
          ...(sessionDirPath ? { sessionDirPath } : {}),
          ...(workspacePath ? { workspacePath } : {}),
        }),
      }),
    );

    const runtime = new GrokRuntimeAdapter(
      {
        registry: this.registry,
        backendId: grokProviderModule.execution.descriptor.backendId,
        capabilities: grokProviderModule.capabilities,
        // Minted per runtime because the construction call site has no
        // conversation to bind one to; it moves to the catalog at M3.
        owner: { kind: 'conversation', ownerId: opaqueId('groktab') },
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
            const manager = ProviderWorkspaceRegistry.getMcpServerManager('grok');
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
        // The tab closing is when the prompts it raised stop being anyone's,
        // and when a write on its sessions has nobody left to ask.
        presenter.dismissAll();
        releaseSettled();
        this.presenters.delete(presenter);
        for (const sessionId of ownedSessions) {
          this.writeApprovers.delete(sessionId);
          this.surfaceReaders.delete(sessionId);
        }
        ownedSessions.clear();
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
    this.presenters.clear();
    grokPlanUsageStore.setBillingReader(null, this.billingReaderOwner);
    this.requests.dispose();
  }

  /**
   * What this turn asks the session to be set to.
   *
   * Sent every turn rather than only when it changes, because the session a
   * turn lands on is decided at dispatch — it may be one this tab never
   * configured, created by the backend after the old one went missing. The
   * applier skips whatever is empty. The reasoning effort is absent on purpose:
   * Grok takes it on the command line, so it belongs to the launch key.
   */
  private dynamicConfiguration(
    sessionConfig: GrokSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): GrokAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const dynamic: GrokAcpDynamicConfig = {
      // Only a session that reported a native mode is sent one: a release that
      // carries its policy on the command line has none, and Grimoire's own
      // toolbar ids mean nothing to it.
      ...(modeId && sessionConfig.sessionModeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /** The tab that owns this session, asked to fill what the wire did not. */
  private async fillSurface(input: {
    readonly nativeSessionRef: string;
    readonly presentContent: (payload: unknown) => void;
  }): Promise<void> {
    await this.surfaceReaders.get(input.nativeSessionRef)?.(input.presentContent);
  }

  /**
   * What Grok's own session log says about a turn that just ended.
   *
   * Two readings, for two different absences: the context window, which this
   * provider never reports over ACP at all, and the cost, which it reports on
   * `turn_completed` for some turns and not others. The store records the
   * difference from the session total, so reading it twice counts nothing twice.
   */
  private async readSessionSurface(
    sessionId: string,
    present: (payload: unknown) => void,
    ports: {
      readonly costWanted: () => boolean;
      readonly paths: () => GrokProviderState;
    },
  ): Promise<void> {
    const paths = ports.paths();
    const usage = await loadGrokSessionContextUsage(sessionId, paths);
    if (usage) {
      present({ kind: 'session-usage', usage });
    }
    if (!ports.costWanted()) {
      return;
    }
    const cost = await loadGrokSessionCost(sessionId, paths);
    if (grokPlanUsageStore.recordSessionTotalCost(sessionId, cost)) {
      this.refreshSelectors();
    }
  }

  /**
   * The models this Grok has, which it writes to the managed home.
   *
   * Not answered over ACP: `session/new` reports the session's own model and
   * the catalog is a file the CLI maintains. Read when a process comes up,
   * which is what the legacy runtime did and the only moment the file is known
   * to be current.
   */
  private hydrateNativeModelCatalog(): void {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const runtimeEnv = buildGrokRuntimeEnv(
      this.plugin.settings,
      this.plugin.getResolvedProviderCliPath('grok') ?? 'grok',
      resolveManagedGrokHomePath(cwd),
    );
    const catalog = readGrokNativeModelCatalog({
      env: runtimeEnv,
      managedGrokHomePath: runtimeEnv.GROK_HOME ?? null,
    });
    if (!applyGrokNativeModelCatalog(this.plugin.settings, catalog)) {
      return;
    }
    void this.plugin.saveSettings();
    this.refreshSelectors();
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
        scope: 'grok',
      });
    });
  }

  private fullAccess(): boolean {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'grok',
    );
    // Grok's own name for it: the launch flag is `--always-approve`, and the
    // permission mode the settings carry is Grimoire's word for the same thing.
    return resolveGrokPermissionModeForSettings(settings.permissionMode) === 'always-approve';
  }

  /**
   * Whether an ACP-delegated write may happen, asked of the tab that owns the
   * session it came in on.
   *
   * The legacy runtime asked its own approval callback, because a runtime was
   * one tab. The client factory is one process for every tab, so the tab is
   * found by the session the write arrived on — and a write whose session
   * belongs to no open tab is refused rather than allowed by default.
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
      `Grok Build wants to write ${input.requestPath}.`,
      { decisionReason: 'File write permission required' },
    );
    return decision === 'allow' || decision === 'allow-always';
  }

  private createClientFactory(): ManagedAcpClientFactory {
    const fileSystem = new AcpWorkspaceFileSystem({
      providerLabel: 'Grok Build',
      // Auto-approve opts into unrestricted file access; safe and plan modes
      // confine an ACP-delegated read or write to the session workspace.
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
      // The three updates Grok sends under its own method name, without which
      // a turn's usage and its stop reason never reach the surface.
      vendorSessionNotifications: {
        methods: GROK_SESSION_NOTIFICATION_METHODS,
        parse: (method, params) => parseGrokSessionNotification(method, params),
      },
      // Declared, and therefore used: an ACP client that advertises no
      // filesystem is one the agent writes around, and the containment and the
      // write approval below are the two things it would be writing around.
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

/**
 * The three MCP members a chat tab never calls.
 *
 * Editing the server list is a settings surface, served by the workspace
 * registration; refusing by name keeps a wrong call visible instead of making
 * it look like it worked.
 */
function notWiredHere(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `Grok MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
  ));
}

/**
 * The adapter for one Grok tab, plus the one lifecycle it has no port for.
 *
 * A tab closing is when the prompts it raised and the turns it queued stop
 * being anyone's; waiting for its next turn is waiting for one that never comes.
 */
class GrokRuntimeAdapter extends ExecutionChatRuntimeAdapter<GrokProviderSettings> {
  constructor(
    context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[1],
    features: ProviderFeatureContributions<GrokProviderSettings>,
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
