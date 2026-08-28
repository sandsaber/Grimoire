import { randomUUID } from 'node:crypto';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import {
  type GeminiMetadataLaunch,
  GeminiMetadataSession,
} from '@/app/execution/gemini/GeminiMetadataSession';
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
  ProviderRuntimePorts,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
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
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import { createGeminiModuleContext } from '@/providers/gemini/app/GeminiModuleContext';
import { geminiPlanUsageStore } from '@/providers/gemini/app/GeminiPlanUsageStore';
import type { GeminiAcpDynamicConfig } from '@/providers/gemini/execution/GeminiAcpDynamicConfig';
import { GeminiAcpDynamicConfigApplier } from '@/providers/gemini/execution/GeminiAcpDynamicConfig';
import { GeminiAcpFileSystem } from '@/providers/gemini/execution/GeminiAcpFileSystem';
import { GeminiContentPresenter } from '@/providers/gemini/execution/GeminiContentPresenter';
import {
  GeminiExecutionBackend,
  type GeminiExecutionBackendContext,
} from '@/providers/gemini/execution/GeminiExecutionBackend';
import {
  GeminiExecutionRequests,
  type GeminiInvocationEnvironment,
} from '@/providers/gemini/execution/GeminiExecutionRequests';
import {
  GeminiInteractionBridge,
  GeminiInteractionPresenter,
} from '@/providers/gemini/execution/GeminiInteractionBridge';
import { GeminiProjectionResultSink } from '@/providers/gemini/execution/GeminiProjectionResultSink';
import { GeminiSessionConfigState } from '@/providers/gemini/execution/GeminiSessionConfigState';
import { geminiProviderModule } from '@/providers/gemini/GeminiProviderModule';
import {
  buildGeminiPromptBlocks,
  buildGeminiPromptText,
} from '@/providers/gemini/runtime/buildGeminiPrompt';
import { buildGeminiRuntimeEnv } from '@/providers/gemini/runtime/GeminiRuntimeEnvironment';
import { getVaultPath } from '@/utils/path';

import { delayThroughWindow } from '../hostTimers';
import { ProviderWorkspaceHolder } from '../ProviderWorkspaceHolder';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * Gemini CLI chat execution, assembled from the running plugin.
 *
 * **Flipped.** `registration.ts` points `createRuntime` here, `main.ts`
 * constructs one per load, and `GeminiChatRuntime` is gone.
 *
 * The fifth ACP provider on the kernel and the fourth in a row to add nothing
 * to the shared stack: the client adapter, the transport, the process launcher
 * and the managed backend are the same objects here as in OpenCode's, Grok's,
 * MiMoCode's and Kimi Code's.
 *
 * What a fifth composition contributes is mostly subtraction, and each absence
 * is a fact about this CLI rather than an unfinished slot:
 *
 * - **no launch artifacts.** There is no managed home, no config file and no
 *   system prompt on disk, so `environment()` writes nothing and the launch key
 *   is a command line rather than a directory;
 * - **no conversation-scoped launch state.** The OpenCode family carries a
 *   database path per turn because a session created against one cannot be
 *   loaded from another. A Gemini session id is the whole binding;
 * - **no session cost fallback.** The plan indicator is spend, and this
 *   provider reports it on the wire or not at all — there is no session log to
 *   read a missing one out of;
 * - **no session commands.** The recorded session announces twenty and the
 *   presenter drops every one, so the tab contributes no `runtimeCommands`
 *   slot rather than one that answers with an empty list.
 *
 * It owns three things a tab cannot: the backend every tab dispatches through,
 * the permission bridge every prompt is prepared by, and the isolated metadata
 * session the model catalog and the settings tab ask their questions in.
 * Everything else is built per tab in `createRuntime`, because it is about one
 * conversation's session.
 */
export class GeminiExecution {
  private readonly requests = new GeminiExecutionRequests(
    () => opaqueId('gmreq'),
    () => this.environment(),
  );

  /**
   * One bridge for every tab, because the backend is one and it prepares every
   * request through the bridge it was built with. A per-tab bridge would leave
   * the presentation for a request in a map the presenter cannot read.
   */
  private readonly interactions = new GeminiInteractionBridge(() => opaqueId('gmix'));

  private metadataSession: GeminiMetadataSession | undefined;
  private clientFactory: ManagedAcpClientFactory | undefined;

  /**
   * Which tab answers for a write on which ACP session.
   *
   * The filesystem delegate belongs to the process, and the approval belongs to
   * a tab; this is the only thing that knows both.
   */
  private readonly writeApprovers = new Map<string, () => ApprovalCallback | undefined>();

  private readonly presenters = new Set<GeminiInteractionPresenter>();

  private backend: GeminiExecutionBackend | undefined;

  /**
   * This provider's workspace slots, built on the first question.
   *
   * The context is built with no conversation and with every runtime port
   * refusing: a workspace slot answers about the plugin, never about a tab, and
   * one that reached for a tab's session would be answering from whichever tab
   * happened to build the workspace first. Refusing says so where it happens.
   */
  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    geminiProviderModule.workspace,
    () => createGeminiModuleContext(this.plugin, () => null),
  );

  constructor(
    private readonly plugin: GrimoirePlugin,
    /**
     * A tab's adapter dispatches through the same registry the backend is
     * registered with; taking it later would mean two objects disagreeing about
     * which.
     */
    readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /** What every open permission request is asking, for the tab that shows it. */
  get interactionBridge(): GeminiInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime references its turns through. */
  get turnRequests(): GeminiExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `gemini --acp` process by default.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership: a test that has to launch Gemini to check
   * how a turn is composed is testing the wrong thing.
   */
  createBackend(
    clientFactory: ManagedAcpClientFactory = this.clientFactory ?? this.createClientFactory(),
  ): GeminiExecutionBackend {
    this.clientFactory = clientFactory;
    const context: GeminiExecutionBackendContext = {
      clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new GeminiAcpDynamicConfigApplier(
        { resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef) },
        // A mode the agent would not take leaves the turn running under a
        // different permission than the toolbar shows. Recorded rather than
        // shown, because a turn that dies is worse and there is no surface for
        // this yet — see the live-smoke entry for what a real refusal says.
        ({ modeId, error }) => this.plugin.recordDebugLog({
          error,
          event: 'execution.setMode.refused',
          level: 'warn',
          scope: 'gemini',
          data: { modeId },
        }),
      ),
      interactionBridge: this.interactions,
      resultSink: new GeminiProjectionResultSink(),
      reconciler: {
        // A turn that answered the cancel it was sent is a turn known to have
        // stopped, and ACP delivers that answer on the prompt itself. For
        // anything else — a run this process did not see finish — what is known
        // is nothing, and this provider has no session log to ask. `unknown`
        // with effects possible is what makes the kernel refuse to re-dispatch.
        reconcile: async query => acpCancellationEvidence(query)
          ?? { kind: 'unknown', effectsPossible: true },
      },
      auxiliaryQueries: {
        execute: async () => {
          // Titles, refinement and inline edits are no-ops for this provider —
          // `GeminiNoopServices` is what `registration.ts` names — so there is
          // nothing here to route yet. Refused rather than answered emptily.
          throw new Error('Gemini auxiliary execution is not wired to the kernel yet.');
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
    this.backend = new GeminiExecutionBackend(context);
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
   * The Gemini chat runtime, over the kernel.
   *
   * One per tab, not one per provider.
   * Three things are built per tab rather than shared, each because they are
   * about *this* conversation's session: what it is set to, what it has said,
   * and which prompt is on screen.
   */

  /** This provider's workspace slots, built on the first question. */
  workspace(): Promise<ProviderWorkspaceSlots> {
    return this.workspaceHolder.resolve();
  }

  /**
   * The workspace if it has already been built, and nothing if it has not.
   *
   * For the callers that cannot wait: a plan indicator reads what it holds
   * while a tab paints, and a promise on that path is a paint that waits.
   */
  builtWorkspace(): ProviderWorkspaceSlots | null {
    return this.workspaceHolder.peek() ?? null;
  }

  createRuntime(): ExecutionChatRuntimeAdapter {
    let conversation: BoundConversation | null = null;
    let adapter: GeminiRuntimeAdapter | undefined;
    const ownedSessions = new Set<string>();
    const boundConversation = (): BoundConversation | null => conversation;
    // Minted once, and only used while no conversation is bound: a fallback
    // minted per read would give one tab's session and its runs different
    // owners, which the registry refuses.
    const geminiTab = opaqueId('geminitab');

    const sessionConfig = new GeminiSessionConfigState({
      settingsBag: () => this.plugin.settings,
    });

    const content = new GeminiContentPresenter({
      displayModel: () => sessionConfig.getActiveDisplayModel(),
      onCurrentMode: currentModeId => {
        // A switch somebody asked for — `/mode` typed into the composer, or the
        // set this turn just applied — which is the one thing that may move the
        // toolbar. Read late: the surface installs its callbacks on the runtime
        // after this constructs, so a captured callback would be the one that
        // was not there.
        const permissionMode = sessionConfig.adoptCurrentMode(currentModeId);
        this.settle(this.plugin.saveSettings());
        const sync = adapter?.interactionCallbacks().permissionModeSync;
        if (typeof sync === 'function') {
          (sync as (mode: string) => void)(permissionMode);
        }
      },
      onConfigOptions: configOptions => this.syncDiscovery(
        sessionConfig,
        { configOptions: [...configOptions] },
      ),
      onSessionOpened: opening => {
        // This tab is the one that answers for a write on this session.
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
        if (geminiPlanUsageStore.recordCost(cost ?? null)) {
          this.refreshSelectors();
        }
      },
    });

    const presenter = new GeminiInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    // Held by the tab, not by the composition: a subscription pushed onto a
    // shared list would outlive every tab that ever opened and be called for
    // every interaction after it closed.
    const releaseSettled = this.interactions.onSettled(ref => presenter.dismiss(ref));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => ({
        isCompact: false,
        mcpMentions: request.enabledMcpServers ?? new Set<string>(),
        // What the conversation is saved as, which for this provider is the
        // whole composed prompt — the legacy `prepareTurn` persisted the same
        // string it sent.
        persistedContent: buildGeminiPromptText(request),
        prompt: buildGeminiPromptText(request),
        request,
      }),
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => {
        // The turn boundary: what the normalizer carries is this turn's, and the
        // tokens the last prompt cost are not this prompt's. Here rather than at
        // dispatch because this is the one place a turn is known to be starting.
        content.beginTurn();
        // Carried into the prompt only when no session can carry it itself: a
        // bound session already holds the conversation, and sending the history
        // again would say everything twice.
        const bootstrap = ports.currentSessionId() ? [] : history ?? [];
        const dynamic = this.dynamicConfiguration(sessionConfig, options);
        return this.requests.reference({
          prompt: buildGeminiPromptBlocks(turn.request, [...bootstrap], {
            ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
          }),
          ...(dynamic ? { dynamic } : {}),
        });
      },
      /**
       * The ACP session this conversation is actually on.
       *
       * The presenter's copy comes **first**: it is read from the reply to
       * `session/new` or `session/load`, so it is the session the last turn
       * really ran in. The conversation's saved id is only what it was before.
       * When the agent no longer has that session the backend replaces it, and
       * a tab that kept reporting the old id would save the conversation
       * pointing at a session that does not exist — every later turn starting
       * over, forever.
       */
      currentSessionId: () => content.lastSessionId() ?? conversation?.sessionId ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          // A different conversation is a different ACP session, and what the
          // previous one was set to says nothing about this one.
          content.forgetConversation();
          sessionConfig.forgetSession();
        }
        conversation = next;
      },
      /**
       * The provider's words for a turn that never started.
       *
       * A translation of the classification rather than the agent's own text:
       * this CLI answers an unknown session with a generic failure that names
       * nothing about the session, and the resume policy keeps the binding
       * rather than replacing it on an error that vague.
       */
      describeFailure: reason => {
        // The agent's own words, where it gave any — for a refused prompt and
        // for a session it would not open, which is the same refusal one step
        // earlier and the one a first-run user meets. `undefined` falls through
        // to the sentences below, which are what a provider that refused
        // without saying anything deserves.
        if (reason === 'provider-failure' || reason === 'pre-dispatch-rejected') {
          const refused = content.consumeTurnRefusal();
          // A refused *load* is the one refusal whose words are not the whole
          // answer: the session may be fine and the CLI unusable, so the
          // sentence about starting a new chat has to say what it depends on.
          if (refused?.origin === 'session-load') {
            return describeAcpSessionOpenFailure('Gemini', refused.message);
          }
          if (refused) {
            return refused.message;
          }
        }
        if (reason === 'provider-failure') {
          return undefined;
        }
        if (reason === 'spawn-failed') {
          // A desktop app does not inherit the shell PATH, which is the
          // actionable half the neutral sentence never says.
          return 'Grimoire could not start the Gemini CLI. Set an absolute CLI path in the '
            + 'Gemini settings — desktop apps do not inherit the shell PATH.';
        }
        if (reason === 'pre-dispatch-rejected') {
          return describeAcpSessionOpenFailure('Gemini');
        }
        return undefined;
      },
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter,
      delay: delayThroughWindow,
      reportCleanupFailure: error => {
        this.plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'gemini',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers about
    // *this tab's* conversation, so the context has to close over the same one
    // the ports above sync.
    const contributions = geminiProviderModule.runtimePorts(
      createGeminiModuleContext(this.plugin, boundConversation),
    );

    const runtime = new GeminiRuntimeAdapter(
      {
        registry: this.registry,
        backendId: geminiProviderModule.execution.descriptor.backendId,
        capabilities: geminiProviderModule.capabilities,
        // The conversation the tab is showing, read when a session is
        // established: this is what a deleted conversation's control records are
        // found by (D4). The tab's own id stands in only while no conversation
        // is bound, which is a session that belongs to no chat.
        owner: () => (conversation?.id
          ? { kind: 'conversation', ownerId: conversation.id }
          // Named for what it is, so the startup sweep can remove what a closed
          // tab left behind: deleting a chat looks for its own id and would
          // never find one keyed by a tab.
          : { kind: 'internal-service', ownerId: geminiTab }),
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      {
        // No `runtimeCommands`: this provider's commands are the vault's, and
        // the ones its session announces are dropped.
        //
        // Reloading the vault's servers is what the tab asks for; the restart
        // that makes a running process see them is the launch key's job.
        mcp: {
          load: async () => {
            const manager = ProviderWorkspaceRegistry.getMcpServerManager('gemini');
            await manager?.loadServers();
            return manager?.getServers() ?? [];
          },
          save: () => notWiredHere('save'),
        },
      },
      () => {
        // The tab closing is when the prompts it raised stop being anyone's, and
        // when a write on its sessions has nobody left to ask.
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

  /**
   * What Grimoire asks Gemini when nobody is having a conversation.
   *
   * The model catalog and the settings tab need the same answer, and each of
   * them builds a whole chat runtime to get it today. One isolated session
   * serves both instead.
   */
  get metadata(): GeminiMetadataSession {
    this.metadataSession ??= new GeminiMetadataSession({
      // The same factory the backend runs on, so a test that hands the backend a
      // fake agent is not answered by a real process launched behind it.
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
    // The half the contract makes mandatory: a workspace built lazily is still
    // a workspace, and an unload that never released it leaves whatever it
    // opened behind the plugin that opened it.
    void this.workspaceHolder.dispose().catch(() => undefined);

    // Taken down before the subscriptions are dropped: unsubscribing first
    // empties the set this iterates, and the prompts stay on screen.
    for (const presenter of this.presenters) {
      presenter.dismissAll();
    }
    this.presenters.clear();
    this.requests.dispose();
  }

  /**
   * What this turn asks the session to be set to.
   *
   * Sent every turn rather than only when it changes, because the session a turn
   * lands on is decided at dispatch — it may be one this tab never configured,
   * created by the backend after the old one went missing. The applier skips
   * whatever is empty and translates the mode, which is the one thing that
   * cannot be resolved here: the vault speaks Grimoire's three values and the
   * agent has four of its own.
   *
   * No reasoning effort, and not because it is unfinished:
   * `reasoningControl: 'none'` and the session carries no config option one
   * could be set through.
   */
  private dynamicConfiguration(
    sessionConfig: GeminiSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): GeminiAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const dynamic: GeminiAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /** Keeps what a session reported about itself, and saves it if it was new. */
  private syncDiscovery(
    sessionConfig: GeminiSessionConfigState,
    params: Parameters<GeminiSessionConfigState['syncSessionDiscovery']>[0],
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

  /**
   * Runs a settings write the content channel started, and reports what failed.
   *
   * The presenter's ports are synchronous because presenting a chunk is; what
   * they start is a write to the vault's settings. A rejection here would
   * otherwise be an unhandled one, and the tab would show no sign that its model
   * list did not update.
   */
  private settle(task: Promise<void>): void {
    void task.catch(error => {
      this.plugin.recordDebugLog({
        error,
        event: 'execution.sessionConfig.failed',
        level: 'warn',
        scope: 'gemini',
      });
    });
  }

  private createClientFactory(): ManagedAcpClientFactory {
    const fileSystem = new GeminiAcpFileSystem({
      // Full access opts into unrestricted file access; safe and plan modes
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

  private fullAccess(): boolean {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'gemini',
    );
    return settings.permissionMode === 'full_access';
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
      `Gemini wants to write ${input.requestPath}.`,
      { decisionReason: 'File write permission required' },
    );
    return decision === 'allow' || decision === 'allow-always';
  }

  /**
   * The process a question is asked in, which is nobody's conversation.
   *
   * The same command line a turn runs under, which is the whole of it: with no
   * managed home and no config file, there is nothing to point somewhere else
   * to keep a question from touching the vault's provider state.
   */
  private async metadataLaunch(): Promise<GeminiMetadataLaunch> {
    const environment = await this.environment();
    return {
      startupRef: this.requests.referenceLaunch({
        executable: environment.executable,
        arguments: ['--acp'],
        cwd: environment.cwd,
        environment: { ...environment.environment },
      }),
      cwd: environment.cwd,
      mcpServers: toAcpMcpServers([...environment.mcpServers]),
    };
  }

  /**
   * Everything a queued turn is launched under, read now rather than when it was
   * queued.
   *
   * Shorter than every sibling's because there is nothing to prepare: no
   * artifacts to write, no database to resolve, no managed home to point at. The
   * PATH is already enhanced by `buildGeminiRuntimeEnv`, which is why it is not
   * enhanced again here.
   */
  private async environment(): Promise<GeminiInvocationEnvironment> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('gemini') ?? 'gemini';
    const runtimeEnv = buildGeminiRuntimeEnv(this.plugin.settings, executable);
    const mcpServers = ProviderWorkspaceRegistry.getMcpServerManager('gemini')?.getServers() ?? [];
    return {
      executable,
      cwd,
      environment: definedEnvironment(runtimeEnv),
      // The legacy runtime's launch key, plus the servers. It restarted on a
      // change to the command or the environment text and on nothing else, and
      // shut the process down separately when the MCP list was reloaded — but a
      // session that is already open is never told about a list that changed
      // under it. Here the fingerprint is what restarts the process, so the next
      // turn's session is created with the servers the vault now has.
      launchKey: JSON.stringify({
        command: executable,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'gemini'),
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
 * registration; refusing by name keeps a wrong call visible instead of making it
 * look like it worked.
 */
function notWiredHere(slot: string): Promise<never> {
  return Promise.reject(new Error(
    `Gemini MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
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
 * The adapter for one Gemini tab, plus the one lifecycle it has no port for.
 *
 * A tab closing is when the prompts it raised and the turns it queued stop being
 * anyone's; waiting for its next turn is waiting for one that never comes.
 */
class GeminiRuntimeAdapter extends ExecutionChatRuntimeAdapter {
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
