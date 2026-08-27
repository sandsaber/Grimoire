import { randomUUID } from 'node:crypto';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import {
  type QwenMetadataLaunch,
  QwenMetadataSession,
} from '@/app/execution/qwen/QwenMetadataSession';
import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
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
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import {
  type BoundConversation,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeHostPorts,
  type ExecutionInteractionAnswer,
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
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import type { AcpUsageUpdate } from '@/providers/acp/types';
import { createQwenModuleContext } from '@/providers/qwen/app/QwenModuleContext';
import { qwenPlanUsageStore } from '@/providers/qwen/app/QwenPlanUsageStore';
import type { QwenAcpDynamicConfig } from '@/providers/qwen/execution/QwenAcpDynamicConfig';
import { QwenAcpDynamicConfigApplier } from '@/providers/qwen/execution/QwenAcpDynamicConfig';
import { QwenAcpFileSystem } from '@/providers/qwen/execution/QwenAcpFileSystem';
import {
  getQwenAskUserQuestions,
  type QwenAskUserQuestion,
} from '@/providers/qwen/execution/QwenAskUserQuestion';
import { QwenContentPresenter } from '@/providers/qwen/execution/QwenContentPresenter';
import {
  parseQwenContextUsage,
  QWEN_CONTEXT_USAGE_METHOD,
  QWEN_CONTEXT_USAGE_TIMEOUT_MS,
} from '@/providers/qwen/execution/QwenContextUsage';
import {
  QwenExecutionBackend,
  type QwenExecutionBackendContext,
} from '@/providers/qwen/execution/QwenExecutionBackend';
import {
  QwenExecutionRequests,
  type QwenInvocationEnvironment,
} from '@/providers/qwen/execution/QwenExecutionRequests';
import {
  prepareQwenQuestion,
  QwenInteractionBridge,
  QwenInteractionPresenter,
} from '@/providers/qwen/execution/QwenInteractionBridge';
import { QwenProjectionResultSink } from '@/providers/qwen/execution/QwenProjectionResultSink';
import { QwenSessionConfigState } from '@/providers/qwen/execution/QwenSessionConfigState';
import { qwenProviderModule } from '@/providers/qwen/QwenProviderModule';
import {
  buildQwenPromptBlocks,
  buildQwenPromptText,
} from '@/providers/qwen/runtime/buildQwenPrompt';
import { buildQwenRuntimeEnv } from '@/providers/qwen/runtime/QwenRuntimeEnvironment';
import { getVaultPath } from '@/utils/path';

import { delayThroughWindow } from '../hostTimers';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * Qwen CLI chat execution, assembled from the running plugin.
 *
 * **Flipped.** `registration.ts` points `createRuntime` here, `main.ts`
 * constructs one per load, and `QwenChatRuntime` is gone.
 *
 * The sixth ACP provider on the kernel and the last provider of the migration.
 * It adds nothing to the shared stack either: the client adapter, the transport,
 * the process launcher and the managed backend are the same objects here as in
 * the five before it.
 *
 * Gemini's, minus the same three things and plus three of its own:
 *
 * - **no launch artifacts**, so `environment()` writes nothing and the launch
 *   key is a command line rather than a directory; **no conversation-scoped
 *   launch state**, because a Qwen session id is the whole binding; and **no
 *   session cost fallback**, because the spend indicator is fed from the wire or
 *   not at all;
 * - **the session's own commands**, which this provider surfaces and Gemini
 *   drops — so the tab keeps them and contributes the `runtimeCommands` slot;
 * - **a reasoning effort that costs a turn.** `/effort <level>` is sent as a
 *   `session/prompt` of its own, so `dynamicConfiguration` asks for it only when
 *   the session is not already on it. Every other value here is sent every turn
 *   because the session a turn lands on is decided at dispatch; this one is the
 *   exception, and the reason is that the vendor charges for it;
 * - **ask-user-question, answered by the tab rather than by the kernel.** See
 *   `askQuestion` below for why.
 *
 * It owns three things a tab cannot: the backend every tab dispatches through,
 * the permission bridge every prompt is prepared by, and the isolated metadata
 * session the model catalog and the settings tab ask their questions in.
 * Everything else is built per tab in `createRuntime`, because it is about one
 * conversation's session.
 */
export class QwenExecution {
  private readonly requests = new QwenExecutionRequests(
    () => opaqueId('qwreq'),
    () => this.environment(),
  );

  /**
   * One bridge for every tab, because the backend is one and it prepares every
   * request through the bridge it was built with. A per-tab bridge would leave
   * the presentation for a request in a map the presenter cannot read.
   */
  private readonly interactions = new QwenInteractionBridge(() => opaqueId('qwix'));

  private metadataSession: QwenMetadataSession | undefined;
  private clientFactory: ManagedAcpClientFactory | undefined;

  /**
   * Which tab answers for a write on which ACP session.
   *
   * The filesystem delegate belongs to the process, and the approval belongs to
   * a tab; this is the only thing that knows both.
   */
  private readonly writeApprovers = new Map<string, () => ApprovalCallback | undefined>();

  private readonly presenters = new Set<QwenQuestionPresenter>();

  /**
   * Every open tab, told which session took which reasoning level.
   *
   * Broadcast rather than routed, because the applier reports while the session
   * is still being prepared and no tab has been told its own session id yet.
   * Harmless because the mark **names its session**: a tab only skips its
   * `/effort` when the session that took the level is the one it is on. Told
   * without that, a second tab would skip a prompt its session never received
   * and run at the agent's default for the life of the conversation.
   */
  private readonly effortMarks = new Map<string, (applied: {
    readonly sessionId: string;
    readonly effortLevel: string;
  }) => void>();

  /**
   * What each open question is asking, by the reference its interaction carries.
   *
   * Beside the permission bridge's own presentations and for the same reason:
   * the backend is one for every tab, so what a request said has to be findable
   * from the reference the kernel hands back rather than from a closure.
   */
  private readonly openQuestions = new Map<string, readonly QwenAskUserQuestion[]>();

  private backend: QwenExecutionBackend | undefined;

  /**
   * How many times the vault's workspace resources have changed under a
   * running agent.
   *
   * Part of the launch key, which is the only thing that can carry it: this
   * CLI reads `.qwen/skills`, `.qwen/commands` and `.qwen/agents` when it
   * starts, and a process already running was told them once. The legacy
   * runtime shut the process down; here the fingerprint changes and the next
   * turn spawns one that reads the new files.
   */
  private workspaceGeneration = 0;

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
  get interactionBridge(): QwenInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime references its turns through. */
  get turnRequests(): QwenExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `qwen --acp` process by default.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership: a test that has to launch Qwen to check
   * how a turn is composed is testing the wrong thing.
   */
  createBackend(
    clientFactory: ManagedAcpClientFactory = this.clientFactory ?? this.createClientFactory(),
  ): QwenExecutionBackend {
    this.clientFactory = clientFactory;
    const context: QwenExecutionBackendContext = {
      clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new QwenAcpDynamicConfigApplier(
        { resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef) },
        // A mode the agent would not take leaves the turn running under a
        // different permission than the toolbar shows. Recorded rather than
        // shown, because a turn that dies is worse and there is no surface for
        // this yet — see the live-smoke entry for what a real refusal says.
        ({ modeId, error }) => this.plugin.recordDebugLog({
          error,
          event: 'execution.setMode.refused',
          level: 'warn',
          scope: 'qwen',
          data: { modeId },
        }),
        // What the session actually took, which nothing else can tell the tab:
        // there is no `current_effort` update the way there is a
        // `current_mode_update`, so without this the skip is impossible and
        // every turn pays for a level the session already has.
        applied => this.noteEffortApplied(applied),
      ),
      interactionBridge: {
        /**
         * Every permission, and the one thing that is not a permission.
         *
         * Qwen sends `ask_user_question` down the permission channel, and its
         * reply carries structured answers beside the option id. That is why
         * `InteractionResolution` has a payload: until it did, a response id was
         * the only thing that could come back, and this provider's flip waited
         * on it rather than presenting a question as an approval.
         *
         * Opened as `kind: 'question'` — the first interaction of that kind the
         * product has ever carried, though the kernel has modelled it since M1.
         */
        prepare: async request => {
          const questions = getQwenAskUserQuestions(request);
          return questions
            ? prepareQwenQuestion(
              request,
              questions,
              opaqueId('qwq'),
              (ref, asked) => this.openQuestions.set(ref, asked),
              ref => this.openQuestions.delete(ref),
            )
            : this.interactions.prepare(request);
        },
      },
      resultSink: new QwenProjectionResultSink({
        readContextUsage: (client, sessionId) => readQwenContextUsage(client, sessionId),
      }),
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
          // `QwenNoopServices` is what `registration.ts` names — so there is
          // nothing here to route yet. Refused rather than answered emptily.
          throw new Error('Qwen auxiliary execution is not wired to the kernel yet.');
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
    this.backend = new QwenExecutionBackend(context);
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
   * The Qwen chat runtime, over the kernel.
   *
   * One per tab, matching how `ProviderRegistry` constructs runtimes today.
   * Three things are built per tab rather than shared, each because they are
   * about *this* conversation's session: what it is set to, what it has said,
   * and which prompt is on screen.
   */
  createRuntime(): ChatRuntime {
    let conversation: BoundConversation | null = null;
    let adapter: QwenRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    const ownedSessions = new Set<string>();
    const boundConversation = (): BoundConversation | null => conversation;
    // Minted once, and only used while no conversation is bound: a fallback
    // minted per read would give one tab's session and its runs different
    // owners, which the registry refuses.
    const qwenTab = opaqueId('qwentab');

    const sessionConfig = new QwenSessionConfigState({
      settingsBag: () => this.plugin.settings,
    });
    const effortMarkKey = opaqueId('qweffort');
    this.effortMarks.set(effortMarkKey, applied => {
      sessionConfig.markApplied({
        effortLevel: applied.effortLevel as never,
        effortSessionId: applied.sessionId,
      });
    });

    const content = new QwenContentPresenter({
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
      // The session's own slash commands, which arrive as an update rather than
      // as an answer to anything. Held here so the tab can list them without a
      // second Qwen process being launched to ask.
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
        if (qwenPlanUsageStore.recordCost(cost ?? null)) {
          this.refreshSelectors();
        }
      },
    });

    const presenter = new QwenQuestionPresenter(
      new QwenInteractionPresenter(
        this.interactions,
        () => adapter?.interactionCallbacks() ?? {},
      ),
      ref => this.openQuestions.get(ref),
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
        persistedContent: buildQwenPromptText(request),
        prompt: buildQwenPromptText(request),
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
        const dynamic = this.dynamicConfiguration(
          sessionConfig,
          ports.currentSessionId(),
          options,
        );
        return this.requests.reference({
          prompt: buildQwenPromptBlocks(turn.request, [...bootstrap], {
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
          // previous one was set to says nothing about this one — including the
          // commands it announced.
          content.forgetConversation();
          sessionConfig.forgetSession();
          sessionCommands = [];
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
            return describeAcpSessionOpenFailure('Qwen', refused.message);
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
          return 'Grimoire could not start the Qwen CLI. Set an absolute CLI path in the '
            + 'Qwen settings — desktop apps do not inherit the shell PATH.';
        }
        if (reason === 'pre-dispatch-rejected') {
          return describeAcpSessionOpenFailure('Qwen');
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
          scope: 'qwen',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers about
    // *this tab's* conversation, so the context has to close over the same one
    // the ports above sync.
    const contributions = qwenProviderModule.runtimePorts(
      createQwenModuleContext(boundConversation, { sessionCommands: () => sessionCommands }),
    );

    const runtime = new QwenRuntimeAdapter(
      {
        registry: this.registry,
        backendId: qwenProviderModule.execution.descriptor.backendId,
        capabilities: qwenProviderModule.capabilities,
        // The conversation the tab is showing, read when a session is
        // established: this is what a deleted conversation's control records are
        // found by (D4). The tab's own id stands in only while no conversation
        // is bound, which is a session that belongs to no chat.
        owner: () => (conversation?.id
          ? { kind: 'conversation', ownerId: conversation.id }
          // Named for what it is, so the startup sweep can remove what a closed
          // tab left behind: deleting a chat looks for its own id and would
          // never find one keyed by a tab.
          : { kind: 'internal-service', ownerId: qwenTab }),
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      {
        // The commands the open session announced, which is what the legacy
        // runtime listed and what the vault catalogue cannot know.
        runtimeCommands: { listForSession: async () => sessionCommands },
        // Reloading the vault's servers is what the tab asks for; the restart
        // that makes a running process see them is the launch key's job.
        mcp: {
          loadServers: async () => {
            const manager = ProviderWorkspaceRegistry.getMcpServerManager('qwen');
            await manager?.loadServers();
            return (manager?.getServers() ?? []).map(server => ({
              id: server.name,
              label: server.name,
              enabled: server.enabled,
            }));
          },
          saveServers: () => notWiredHere('saveServers'),
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
        this.effortMarks.delete(effortMarkKey);
      },
    );
    adapter = runtime;
    return runtime;
  }

  /**
   * What Grimoire asks Qwen when nobody is having a conversation.
   *
   * The model catalog and the settings tab need the same answer, and each of
   * them builds a whole chat runtime to get it today. One isolated session
   * serves both instead.
   */
  get metadata(): QwenMetadataSession {
    this.metadataSession ??= new QwenMetadataSession({
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
    // Taken down before the subscriptions are dropped: unsubscribing first
    // empties the set this iterates, and the prompts stay on screen.
    for (const presenter of this.presenters) {
      presenter.dismissAll();
    }
    this.presenters.clear();
    this.openQuestions.clear();
    this.requests.dispose();
  }

  /**
   * What this turn asks the session to be set to.
   *
   * The mode and the model are sent every turn rather than only when they
   * change, because the session a turn lands on is decided at dispatch — it may
   * be one this tab never configured, created by the backend after the old one
   * went missing. The applier skips whatever is empty and translates the mode,
   * which is the one thing that cannot be resolved here: the vault speaks
   * Grimoire's three values and the agent has four of its own.
   *
   * **The effort is the exception, and the reason is money.** Setting it sends a
   * `/effort <level>` prompt, which the vendor charges for like any other turn —
   * so it is asked for only when this tab's session is not already on it. The
   * risk that buys is a turn that lands on a session nobody set the level on;
   * the state forgets the level whenever the session changes, which is what
   * keeps that from lasting longer than one dispatch.
   */
  private dynamicConfiguration(
    sessionConfig: QwenSessionConfigState,
    currentSessionId: string | null,
    options?: ChatRuntimeQueryOptions,
  ): QwenAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const effortLevel = sessionConfig.resolveSelectedEffortLevel();
    const applied = sessionConfig.sessionEffort;
    const dynamic: QwenAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
      // Skipped only when *this tab's* session is the one that took it. A
      // level recorded without its session lets a second tab skip a prompt its
      // own session never received.
      ...(applied?.level === effortLevel && applied.sessionId === currentSessionId
        ? {}
        : { effortLevel }),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /**
   * Tells every open tab which session took which level.
   *
   * The tab decides whether that is its own — see `dynamicConfiguration`. A
   * redundant prompt costs a turn; a wrong skip costs every turn after it.
   */
  private noteEffortApplied(applied: {
    readonly sessionId: string;
    readonly effortLevel: string;
  }): void {
    for (const mark of this.effortMarks.values()) {
      mark(applied);
    }
  }

  /** Keeps what a session reported about itself, and saves it if it was new. */
  private syncDiscovery(
    sessionConfig: QwenSessionConfigState,
    params: Parameters<QwenSessionConfigState['syncSessionDiscovery']>[0],
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
        scope: 'qwen',
      });
    });
  }

  private createClientFactory(): ManagedAcpClientFactory {
    const fileSystem = new QwenAcpFileSystem({
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
      'qwen',
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
      `Qwen wants to write ${input.requestPath}.`,
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
  private async metadataLaunch(): Promise<QwenMetadataLaunch> {
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
   * PATH is already enhanced by `buildQwenRuntimeEnv`, which is why it is not
   * enhanced again here.
   */
  private async environment(): Promise<QwenInvocationEnvironment> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('qwen') ?? 'qwen';
    const runtimeEnv = buildQwenRuntimeEnv(this.plugin.settings, executable);
    const mcpServers = ProviderWorkspaceRegistry.getMcpServerManager('qwen')?.getServers() ?? [];
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
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'qwen'),
        mcpServers,
        // Not the files themselves — a hash of a whole vault directory read on
        // every dispatch would cost more than the restart it is deciding. What
        // the settings surface knows is *that* they changed, which is all the
        // launch key needs.
        workspaceGeneration: this.workspaceGeneration,
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
    `Qwen MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
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
 * The adapter for one Qwen tab, plus the one lifecycle it has no port for.
 *
 * A tab closing is when the prompts it raised and the turns it queued stop being
 * anyone's; waiting for its next turn is waiting for one that never comes.
 */
class QwenRuntimeAdapter extends ExecutionChatRuntimeAdapter {
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

/**
 * The two interactions one Qwen tab can be shown, behind one port.
 *
 * The adapter installs a single interaction presenter, and this provider opens
 * two kinds through it. An approval goes to the shared ACP presenter, which
 * every managed-ACP provider uses; a question goes to the tab's own question
 * callback, which the chat surface already installs and which no other provider
 * on this transport has ever had reason to reach.
 */
class QwenQuestionPresenter {
  private readonly open = new Map<string, AbortController>();

  constructor(
    private readonly approvals: QwenInteractionPresenter,
    private readonly questions: (presentationRef: string)
    => readonly QwenAskUserQuestion[] | undefined,
    private readonly callbacks: () => Readonly<Record<string, unknown>>,
  ) {}

  async present(request: InteractionRequest): Promise<string | ExecutionInteractionAnswer | null> {
    const asked = this.questions(request.presentationRef);
    if (!asked) {
      return this.approvals.present(request);
    }
    const ask = this.callbacks().question as
      | ((input: Record<string, unknown>, signal?: AbortSignal)
      => Promise<Record<string, string | string[]> | null>)
      | undefined;
    if (typeof ask !== 'function') {
      // No surface installed one, so nobody can answer. Cancelled rather than
      // left open: a turn waiting on a prompt nothing will show never ends.
      return 'cancel';
    }
    const abort = new AbortController();
    this.open.set(request.presentationRef, abort);
    try {
      const answers = await ask({ questions: [...asked] }, abort.signal);
      // The answers ride on the resolution and are never written down, which is
      // what D2 requires of anything a person typed.
      return answers === null ? 'cancel' : { responseId: 'answered', payload: { answers } };
    } catch {
      return 'cancel';
    } finally {
      this.open.delete(request.presentationRef);
    }
  }

  dismiss(presentationRef: string): void {
    this.open.get(presentationRef)?.abort();
    this.open.delete(presentationRef);
    this.approvals.dismiss(presentationRef);
  }

  dismissAll(): void {
    for (const abort of this.open.values()) {
      abort.abort();
    }
    this.open.clear();
    this.approvals.dismissAll();
  }
}

/**
 * How full a session's context is, asked of the agent that knows.
 *
 * `qwen/status/session/context_usage` is a method ACP does not define, so it
 * travels on `vendorRequest` — the same escape hatch Grok's billing uses. An
 * agent that does not answer it simply has no window to show, which is a badge
 * without a number rather than a failure, so every path here returns null.
 *
 * A free function on the client the turn was handed, not a method on the
 * composition: one composition serves every tab and a backend holds one client
 * per execution session, so a remembered one would be whichever tab connected
 * last — asking the wrong agent about a session it does not have.
 */
async function readQwenContextUsage(
  client: ManagedAcpClient,
  sessionId: string,
): Promise<AcpUsageUpdate | null> {
  if (!client.vendorRequest) {
    return null;
  }
  const answered = await Promise.race([
    client.vendorRequest(QWEN_CONTEXT_USAGE_METHOD, { detail: false, sessionId }),
    delayThroughWindow(QWEN_CONTEXT_USAGE_TIMEOUT_MS).then(() => null),
  ]).catch(() => null);
  return parseQwenContextUsage(answered);
}
