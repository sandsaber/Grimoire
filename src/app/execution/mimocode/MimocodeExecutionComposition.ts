import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import {
  type MimocodeMetadataLaunch,
  MimocodeMetadataSession,
} from '@/app/execution/mimocode/MimocodeMetadataSession';
import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import type { ProviderAuxiliarySource } from '@/core/auxiliary/ProviderAuxiliarySource';
import { resolveConfiguredTitleModel } from '@/core/auxiliary/titleModel';
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
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type {
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { ApprovalCallback } from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import { ManagedAcpAuxiliaryQuery } from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import { createMimocodeModuleContext } from '@/providers/mimocode/app/MimocodeModuleContext';
import { mimocodePlanUsageStore } from '@/providers/mimocode/app/MimocodePlanUsageStore';
import type { MimocodeAcpDynamicConfig } from '@/providers/mimocode/execution/MimocodeAcpDynamicConfig';
import { MimocodeAcpDynamicConfigApplier } from '@/providers/mimocode/execution/MimocodeAcpDynamicConfig';
import { MimocodeAcpFileSystem } from '@/providers/mimocode/execution/MimocodeAcpFileSystem';
import { createMimocodeAuxiliaryFileSystem } from '@/providers/mimocode/execution/MimocodeAuxiliaryFileSystem';
import { MimocodeContentPresenter } from '@/providers/mimocode/execution/MimocodeContentPresenter';
import {
  MimocodeExecutionBackend,
  type MimocodeExecutionBackendContext,
} from '@/providers/mimocode/execution/MimocodeExecutionBackend';
import {
  auxiliaryRetentionKey,
  type MimocodeAuxiliaryEnvironment,
  type MimocodeAuxiliaryPurpose,
  type MimocodeAuxiliaryRequest,
  MimocodeExecutionRequests,
  type MimocodeInvocationEnvironment,
} from '@/providers/mimocode/execution/MimocodeExecutionRequests';
import { MimocodeInteractionBridge } from '@/providers/mimocode/execution/MimocodeInteractionBridge';
import { MimocodeInteractionPresenter } from '@/providers/mimocode/execution/MimocodeInteractionPresenter';
import { MimocodeProjectionResultSink } from '@/providers/mimocode/execution/MimocodeProjectionResultSink';
import { MimocodeSessionConfigState } from '@/providers/mimocode/execution/MimocodeSessionConfigState';
import { loadMimocodeSessionCost } from '@/providers/mimocode/history/MimocodeUsageMetadataStore';
import { mimocodeProviderModule } from '@/providers/mimocode/MimocodeProviderModule';
import {
  decodeMimocodeModelId,
  isMimocodeModelSelectionId,
} from '@/providers/mimocode/models';
import {
  buildMimocodePromptBlocks,
  buildMimocodePromptText,
} from '@/providers/mimocode/runtime/buildMimocodePrompt';
import {
  buildMimocodeAuxAgentConfig,
  MIMOCODE_AUX_AGENT_IDS,
  type MimocodeAuxAgentProfile,
} from '@/providers/mimocode/runtime/MimocodeAuxiliaryAgents';
import { prepareMimocodeLaunchArtifacts } from '@/providers/mimocode/runtime/MimocodeLaunchArtifacts';
import { buildMimocodeRuntimeEnv } from '@/providers/mimocode/runtime/MimocodeRuntimeEnvironment';
import { getMimocodeState } from '@/providers/mimocode/types';
import { mimocodeChatUIConfig } from '@/providers/mimocode/ui/MimocodeChatUIConfig';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

import { auxiliaryPurposeKey } from '../auxiliaryPurpose';
import { delayThroughWindow } from '../hostTimers';
import { KernelAuxQueryRunner } from '../KernelAuxQueryRunner';

/** What a turn may answer with, before it is refused as too large. */
const MAX_RESULT_BYTES = 256_000;

/**
 * What an auxiliary turn may answer with, which is much less.
 *
 * A title is a line and a refinement is a paragraph. The chat limit is for a
 * turn that may legitimately produce a file's worth of text; an auxiliary answer
 * that size is a model that misread its instructions, and reading 256 KB of it
 * into a title field helps nobody.
 */
const AUXILIARY_RESULT_BYTE_LIMIT = 64_000;

/**
 * How long an auxiliary turn may run before it is abandoned.
 *
 * Shorter than a chat turn by an order of magnitude, and it has to be: nobody is
 * watching it, and the thing waiting is a title that will not appear or a modal
 * that will not answer.
 */
const AUXILIARY_TIMEOUT_MS = 60_000;

/** Where a session opened only to answer a question keeps its state. */
const METADATA_DATABASE = ':memory:';

/**
 * MiMoCode chat execution, assembled from the running plugin.
 *
 * **Flipped.** `registration.ts` points `createRuntime` here, `main.ts`
 * constructs one per load, and `MimocodeChatRuntime` is gone.
 *
 * The third ACP provider on the kernel, and it adds nothing to the shared
 * stack. What OpenCode's flip proved and Grok's confirmed is that the protocol
 * half is generic — the client adapter, the transport, the process launcher
 * and the managed backend are the same objects here — so what a third
 * composition contributes is the MiMoCode-specific launch and nothing else.
 * The three reference spaces remain: the turn, the process to spawn and the
 * session config to apply, because an ACP session is configured after it
 * exists rather than when it is created.
 *
 * It owns three things a tab cannot: the backend every tab dispatches through,
 * the permission bridge every prompt is prepared by, and the isolated metadata
 * session the model catalog, the settings tab and the toolbar ask their
 * questions in. Everything else is built per tab in `createRuntime`, because it
 * is about one conversation's session.
 */
export class MimocodeExecution {
  private readonly requests = new MimocodeExecutionRequests(
    () => opaqueId('mcreq'),
    // Forwarded, not swallowed: a zero-arity lambda type-checks here and drops
    // the conversation's database, which is the whole reason a turn carries
    // one. Every resume then launches against the default database and the
    // session it was told to load is not in it.
    databasePath => this.environment(databasePath),
    undefined,
    request => this.auxiliaryEnvironment(request),
  );

  /**
   * The auxiliary processes, one per runner that asked for one.
   *
   * Built here rather than per tab because auxiliary work belongs to no tab: a
   * title is generated for a conversation nobody may be looking at, and an
   * inline edit runs from a modal over a note. Disposed with the backend, which
   * is what closes the processes it kept.
   */
  private readonly auxiliaryQueries = new ManagedAcpAuxiliaryQuery(
    { resolve: requestRef => this.requests.resolveAuxiliary(requestRef) },
    // Resolved per launch rather than captured: `createBackend` may be handed a
    // fake factory by a test, and an auxiliary process launched behind it would
    // be a real CLI nobody asked for.
    { create: input => this.auxiliaryFactory().create(input) },
    { setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>) },
    AUXILIARY_RESULT_BYTE_LIMIT,
    AUXILIARY_TIMEOUT_MS,
  );

  /**
   * One bridge for every tab, because the backend is one and it prepares every
   * request through the bridge it was built with. A per-tab bridge would leave
   * the presentation for a request in a map the presenter cannot read.
   */
  private readonly interactions = new MimocodeInteractionBridge(() => opaqueId('mcix'));

  private metadataSession: MimocodeMetadataSession | undefined;
  private clientFactory: ManagedAcpClientFactory | undefined;
  private auxiliaryClientFactory: ManagedAcpClientFactory | undefined;
  private injectedClientFactory: ManagedAcpClientFactory | undefined;

  /**
   * Which tab answers for a write on which ACP session.
   *
   * The filesystem delegate belongs to the process, and the approval belongs to
   * a tab; this is the only thing that knows both.
   */
  private readonly writeApprovers = new Map<string, () => ApprovalCallback | undefined>();

  private readonly presenters = new Set<MimocodeInteractionPresenter>();
  private readonly disposers: Array<() => void> = [];

  private backend: MimocodeExecutionBackend | undefined;

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
  get interactionBridge(): MimocodeInteractionBridge {
    return this.interactions;
  }

  /** The store every tab runtime will reference its turns through. */
  get turnRequests(): MimocodeExecutionRequests {
    return this.requests;
  }

  /**
   * The backend, over an application-owned `mimocode acp` process by default.
   *
   * The client factory is a parameter because it is the seam between provider
   * protocol and process ownership: a test that has to launch MiMoCode to check
   * how a turn is composed is testing the wrong thing.
   */
  createBackend(clientFactory?: ManagedAcpClientFactory): MimocodeExecutionBackend {
    // Injected once, and for both: a test that hands the backend a fake agent
    // must not have an auxiliary turn launch a real one behind it.
    if (clientFactory) {
      this.injectedClientFactory = clientFactory;
      this.auxiliaryClientFactory = clientFactory;
    }
    this.clientFactory = clientFactory ?? this.clientFactory ?? this.createClientFactory();

    const context: MimocodeExecutionBackendContext = {
      clientFactory: this.clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new MimocodeAcpDynamicConfigApplier({
        resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef),
      }),
      interactionBridge: this.interactions,
      resultSink: new MimocodeProjectionResultSink(),
      reconciler: {
        // A turn that answered the cancel it was sent is a turn known to
        // have stopped, and ACP delivers that answer on the prompt itself.
        // For anything else — a run this process did not see finish — what
        // is known is nothing. MiMoCode's own session database could answer
        // that, and until it is read the honest evidence is `unknown` with
        // effects possible, which makes the kernel refuse to re-dispatch.
        reconcile: async query => acpCancellationEvidence(query)
          ?? { kind: 'unknown', effectsPossible: true },
      },
      auxiliaryQueries: this.auxiliaryQueries,
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
    this.backend = new MimocodeExecutionBackend(context);
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
   * The MiMoCode chat runtime, over the kernel.
   *
   * One per tab, matching how `ProviderRegistry` constructs runtimes today.
   * Four things are built per tab rather than shared, each for the same reason
   * — they are about *this* conversation's session: what it is set to, what it
   * has said, what commands it offers, and which prompt is on screen.
   */
  createRuntime(): ChatRuntime {
    let conversation: BoundConversation | null = null;
    let adapter: MimocodeRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    // What the last launch resolved for this tab, which is what the
    // conversation is saved pointing at.
    let databasePath: string | null = null;
    const ownedSessions = new Set<string>();
    let sawTurnCost = false;
    const boundConversation = (): BoundConversation | null => conversation;
    // Minted once, and only used while no conversation is bound: a fallback
    // minted per read would give one tab's session and its runs different
    // owners, which the registry refuses.
    const mimocodeTab = opaqueId('mimocodetab');


    const sessionConfig = new MimocodeSessionConfigState({
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

    const content = new MimocodeContentPresenter({
      displayModel: () => sessionConfig.getActiveDisplayModel(),
      // The session's own slash commands, which arrive as an update rather than
      // as an answer to anything. Held here so the tab can list them without a
      // second MiMoCode process being launched to ask.
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
        // This tab is the one that answers for a write on this session.
        ownedSessions.add(opening.sessionId);
        this.writeApprovers.set(
          opening.sessionId,
          () => adapter?.interactionCallbacks().approval as ApprovalCallback | undefined,
        );
        await sessionConfig.syncSessionModelState({
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          models: opening.models ?? null,
        });
        await sessionConfig.syncSessionModeState({
          configOptions: opening.configOptions ? [...opening.configOptions] : null,
          // MiMoCode reports its own default agent here, not the user's pick.
          emitPermissionSync: false,
          modes: opening.modes ?? null,
        });
      })()),
      onCost: cost => {
        // Only a cost that was actually recorded counts as one: MiMoCode sends
        // a usage update every turn for the context badge, usually with no cost
        // in it, and a flag set on the update rather than on the record would
        // disable the fallback that reads the session's own database.
        if (mimocodePlanUsageStore.recordCost(cost ?? null)) {
          sawTurnCost = true;
          this.refreshSelectors();
        }
      },
    });

    const presenter = new MimocodeInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    // Held by the tab, not by the composition: a subscription pushed onto the
    // shared list would outlive every tab that ever opened and be called for
    // every interaction after it closed.
    const releaseSettled = this.interactions.onSettled(ref => presenter.dismiss(ref));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => ({
        isCompact: false,
        mcpMentions: request.enabledMcpServers ?? new Set<string>(),
        persistedContent: '',
        prompt: buildMimocodePromptText(request),
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
        // The turn boundary: what the normalizer and the tool stream carry is
        // this turn's, and the tokens the last prompt cost are not this
        // prompt's. Here rather than at dispatch because this is the one place
        // a turn is known to be starting.
        content.beginTurn();
        const bootstrap = ports.currentSessionId() ? [] : history ?? [];
        const dynamic = this.dynamicConfiguration(sessionConfig, options);
        const conversationDatabase = databasePath
          ?? getMimocodeState(conversation?.providerState).databasePath
          ?? undefined;
        return this.requests.reference({
          prompt: buildMimocodePromptBlocks(turn.request, [...bootstrap], {
            ...(options?.orchestratorMode ? { orchestratorMode: true } : {}),
          }),
          ...(dynamic ? { dynamic } : {}),
          ...(conversationDatabase ? { databasePath: conversationDatabase } : {}),
          onLaunchResolved: resolved => { databasePath = resolved; },
        });
      },
      /**
       * The ACP session this conversation is actually on.
       *
       * The presenter's copy comes **first**, and a live run is what settled
       * the order: it is read from the reply to `session/new` or
       * `session/load`, so it is the session the last turn really ran in. The
       * conversation's saved id is only what it was before. When the agent no
       * longer has that session the backend replaces it, and a tab that kept
       * reporting the old id would save the conversation pointing at a session
       * that does not exist — every later turn starting over, forever.
       *
       * The conversation's own id is the fallback, which is what a tab that has
       * not run a turn yet resumes from.
       */
      currentSessionId: () => content.lastSessionId() ?? conversation?.sessionId ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          // A different conversation is a different ACP session, and what the
          // previous one was set to says nothing about this one.
          content.forgetConversation();
          sessionConfig.forgetSession();
          sessionCommands = [];
          // Another conversation is another database as often as not, and the
          // last one's would send this turn to a session that is not in it.
          databasePath = null;
        }
        conversation = next;
      },
      /**
       * The provider's words for a turn that never started.
       *
       * A translation of the classification, not the agent's error text: for
       * this provider a pre-dispatch rejection is almost always the session
       * bind, and MiMoCode answers an unknown session with a generic service
       * failure that says nothing about the session. The resume policy keeps
       * the binding rather than replacing it on an error that vague, so the
       * conversation would otherwise repeat the neutral sentence forever with
       * nothing to act on.
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
            return describeAcpSessionOpenFailure('MiMoCode', refused.message);
          }
          if (refused) {
            return refused.message;
          }
        }
        if (reason === 'provider-failure') {
          return undefined;
        }
        // Two different failures that used to read as one. A CLI that is not
        // installed is `spawn-failed`, and the neutral sentence for it —
        // "Grimoire could not start the provider process" — names no action;
        // the actionable half is that a desktop app does not inherit the shell
        // PATH, so an absolute path in settings is what fixes it.
        if (reason === 'spawn-failed') {
          return 'Grimoire could not start the MiMoCode CLI. Set an absolute CLI path in the '
            + 'MiMoCode settings — desktop apps do not inherit the shell PATH.';
        }
        if (reason === 'pre-dispatch-rejected') {
          return describeAcpSessionOpenFailure('MiMoCode');
        }
        return undefined;
      },
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => {
        // A vendor that reports no cost on the wire has still charged for the
        // turn, and MiMoCode's own session database knows what. Read once per
        // turn that reported nothing, which is what the legacy runtime did.
        if (!sawTurnCost) {
          this.settle(this.recordSessionCost(content.lastSessionId(), databasePath));
        }
        sawTurnCost = false;
        return content.consumeTurnMetadata();
      },
      interactionPresenter: presenter,
      delay: delayThroughWindow,
      reportCleanupFailure: error => {
        this.plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'mimocode',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers
    // about *this tab's* conversation, so the context has to close over the
    // same one the ports above sync.
    const contributions = mimocodeProviderModule.runtimePorts(
      createMimocodeModuleContext(this.plugin, boundConversation, {
        databasePath: () => databasePath,
      }),
    );

    const runtime = new MimocodeRuntimeAdapter(
      {
        registry: this.registry,
        backendId: mimocodeProviderModule.execution.descriptor.backendId,
        capabilities: mimocodeProviderModule.capabilities,
        // The conversation the tab is showing, read when a session is
        // established: this is what a deleted conversation's control records
        // are found by (D4). The tab's own id stands in only while no
        // conversation is bound, which is a session that belongs to no chat.
        owner: () => (conversation?.id
          ? { kind: 'conversation', ownerId: conversation.id }
          // A tab with no conversation yet owns this session itself, and
          // saying `conversation` about it is what made its records
          // unreachable: deleting a chat looks for its own id and never finds
          // one keyed by a tab. Named for what it is, so the startup sweep can
          // remove what a closed tab left behind.
          : { kind: 'internal-service', ownerId: mimocodeTab }),
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
            const manager = ProviderWorkspaceRegistry.getMcpServerManager('mimocode');
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
        // The tab closing is when the prompts it raised stop being anyone's,
        // and when a write on its sessions has nobody left to ask.
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
   * What Grimoire asks MiMoCode when nobody is having a conversation.
   *
   * The model catalog, the settings tab and the chat toolbar all need the same
   * two answers, and each of them used to build a whole chat runtime to get
   * them. One isolated session serves all of them instead.
   */
  get metadata(): MimocodeMetadataSession {
    this.metadataSession ??= new MimocodeMetadataSession({
      // The same factory the backend runs on, so a test that hands the backend
      // a fake agent is not answered by a real process launched behind it.
      clientFactory: this.clientFactory ??= this.createClientFactory(),
      launch: () => this.metadataLaunch(),
      settingsBag: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      refreshSelectors: () => this.refreshSelectors(),
    });
    return this.metadataSession;
  }

  /**
   * An `AuxQueryRunner` for one auxiliary conversation, answered by the kernel.
   *
   * One per caller, and the caller decides what that means: the title service
   * builds one per title and resets it when the title is done, while inline edit
   * holds one for as long as the edit lasts. That is the unit a process is kept
   * for, so it is the unit the conversation id is minted for.
   */

  /**
   * Every auxiliary service this provider has, behind the one seam all nine
   * share. The runner is per service, and the model is only offered when this
   * provider is the one that owns the configured title model.
   */
  auxiliarySource(): ProviderAuxiliarySource {
    return {
      createRunner: purpose => this.createAuxRunner(auxiliaryPurposeKey(purpose)),
      resolveTitleModel: () => resolveConfiguredTitleModel(
        this.plugin.settings,
        (modelId, settings) => mimocodeChatUIConfig.ownsModel(modelId, settings),
        decodeMimocodeModelId,
      ),
    };
  }

  createAuxRunner(purpose: MimocodeAuxiliaryPurpose): AuxQueryRunner {
    const conversationId = opaqueId('ocaux');
    return new KernelAuxQueryRunner({
      reference: (config, prompt) => this.requests.referenceAuxiliary({
        purpose,
        conversationId,
        systemPrompt: config.systemPrompt,
        prompt,
        ...(config.model ? { model: config.model } : {}),
      }),
      run: (requestRef, options) => (this.backend ?? this.createBackend())
        .runAuxiliaryQuery(requestRef, options),
      release: async () => {
        await this.backend?.releaseAuxiliaryConversation(
          auxiliaryRetentionKey(purpose, conversationId),
        );
      },
    });
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
    // The backend closes these when it is disposed, and a composition disposed
    // without one still has processes to close: an auxiliary turn needs no chat
    // session and may have launched on its own.
    this.settle(this.auxiliaryQueries.dispose());
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
    sessionConfig: MimocodeSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): MimocodeAcpDynamicConfig | undefined {
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const effortValue = sessionConfig.resolveSelectedEffortValue();
    const effortConfigId = sessionConfig.effortConfigId;
    // The level the vault is set to, for the turn that is composed before its
    // session has said which levels exist — a tab's first, and the first after
    // every reload. The applier resolves the id from the session's own reply;
    // the legacy runtime applied it after the session opened for this reason.
    const desiredEffort = sessionConfig.desiredEffortValue();
    const dynamic: MimocodeAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(effortConfigId && effortValue
        ? { effort: { configId: effortConfigId, value: effortValue } }
        : {}),
      ...(!effortConfigId && desiredEffort ? { effortValue: desiredEffort } : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /**
   * What the vendor charged, when only MiMoCode's database knows.
   *
   * The plan indicator for this provider is spend, and a vendor that omits
   * `cost` from its usage update would otherwise never move it. The store
   * records the difference from the session total, so reading it twice for one
   * session counts nothing twice.
   */
  private async recordSessionCost(
    sessionId: string | undefined,
    databasePath: string | null,
  ): Promise<void> {
    if (!sessionId) {
      return;
    }
    const cost = await loadMimocodeSessionCost(
      sessionId,
      databasePath ? { databasePath } : undefined,
    );
    if (mimocodePlanUsageStore.recordSessionTotalCost(sessionId, cost)) {
      this.refreshSelectors();
    }
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
        scope: 'mimocode',
      });
    });
  }

  /**
   * The factory an auxiliary process is launched through, and it is not the
   * chat one.
   *
   * **What a chat turn may reach and an auxiliary turn may not.** The chat
   * filesystem opts out of containment in full access — the user asked for it,
   * and they are watching the turn that uses it. An auxiliary turn has nobody
   * watching and no surface to ask on: a title being generated in the background
   * must not read outside the vault because the *chat* was set to full access,
   * and must not write at all. The legacy runner contained every auxiliary read
   * for exactly this reason, and it declared no write.
   */
  private auxiliaryFactory(): ManagedAcpClientFactory {
    this.auxiliaryClientFactory ??= this.injectedClientFactory ?? this.createAuxiliaryFactory();
    return this.auxiliaryClientFactory;
  }

  private createAuxiliaryFactory(): ManagedAcpClientFactory {
    const fileSystem = createMimocodeAuxiliaryFileSystem(
      () => getVaultPath(this.plugin.app) ?? process.cwd(),
    );
    return new AcpManagedClientAdapterFactory({
      clientInfo: {
        name: 'grimoire-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
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

  private createClientFactory(): ManagedAcpClientFactory {
    const fileSystem = new MimocodeAcpFileSystem({
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
      'mimocode',
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
      `MiMoCode wants to write ${input.requestPath}.`,
      { decisionReason: 'File write permission required' },
    );
    return decision === 'allow' || decision === 'allow-always';
  }

  /**
   * The process a question is asked in, which is nobody's conversation.
   *
   * The database is in memory, which is what makes it isolated: the legacy
   * warmups passed the same override for the same reason, so that asking what
   * models exist never binds a session to a tab or writes MiMoCode state into
   * the vault.
   */
  private async metadataLaunch(): Promise<MimocodeMetadataLaunch> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'mimocode',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('mimocode') ?? 'mimo';
    const runtimeEnv = buildMimocodeRuntimeEnv(settings, executable, METADATA_DATABASE);
    const artifacts = await prepareMimocodeLaunchArtifacts({
      runtimeEnv,
      settings: {
        customPrompt: this.plugin.settings.systemPrompt,
        mediaFolder: this.plugin.settings.mediaFolder,
        userName: this.plugin.settings.userName,
        vaultPath: cwd,
      },
      workspaceRoot: cwd,
    });
    return {
      startupRef: this.requests.referenceLaunch({
        executable,
        arguments: ['acp'],
        cwd,
        environment: definedEnvironment({
          ...runtimeEnv,
          MIMOCODE_CONFIG: artifacts.configPath,
          PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
        }),
      }),
      cwd,
      mcpServers: toAcpMcpServers([
        ...(ProviderWorkspaceRegistry.getMcpServerManager('mimocode')?.getServers() ?? []),
      ]),
    };
  }

  /**
   * Everything a queued turn is launched under, read now rather than when it
   * was queued.
   *
   * The artifacts are written here, before the reference is minted, because
   * they are what the launch *is*: MiMoCode reads its config and system prompt
   * from files, so a process spawned before they exist runs under the previous
   * turn's configuration.
   */
  /**
   * What an auxiliary `mimo acp` is launched under.
   *
   * The chat environment's shape with three differences, and each is what makes
   * an auxiliary turn auxiliary: its **own artifacts directory** per purpose, so
   * a title's config cannot be the conversation's; its **own agent**, whose
   * permissions are what stops an unattended turn from writing to the vault;
   * and its **own system prompt**, which is the caller's rather than the
   * vault's — a title is asked for by the prompt that asks for a title.
   *
   * No MCP servers and no database: an auxiliary turn has no conversation to
   * resume and nothing to offer a tool.
   */
  private async auxiliaryEnvironment(
    request: MimocodeAuxiliaryRequest,
  ): Promise<MimocodeAuxiliaryEnvironment> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'mimocode',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('mimocode') ?? 'mimocode';
    const runtimeEnv = buildMimocodeRuntimeEnv(settings, executable);
    const profile = AUXILIARY_AGENT_PROFILES[request.purpose];
    const agentId = MIMOCODE_AUX_AGENT_IDS[profile];
    const artifacts = await prepareMimocodeLaunchArtifacts({
      artifactsSubdir: `mimocode/auxiliary/${request.purpose}`,
      defaultAgentId: agentId,
      managedAgents: [buildMimocodeAuxAgentConfig(profile)],
      runtimeEnv,
      systemPromptKey: request.systemPrompt,
      systemPromptText: request.systemPrompt,
      userName: this.plugin.settings.userName,
      workspaceRoot: cwd,
    });
    const modelId = resolveMimocodeAuxiliaryModelId(settings, request.model);
    return {
      executable,
      cwd,
      environment: definedEnvironment({
        ...runtimeEnv,
        MIMOCODE_CONFIG: artifacts.configPath,
        MIMOCODE_CONFIG_CONTENT: artifacts.configContent,
        PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
      }),
      // The legacy runner's launch key, unchanged: command, config, environment
      // and the instructions the artifacts wrote.
      launchKey: JSON.stringify({
        artifactKey: artifacts.launchKey,
        command: executable,
        configPath: artifacts.configPath,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'mimocode'),
      }),
      agentId,
      ...(modelId ? { modelId } : {}),
    };
  }

  private async environment(databasePath?: string): Promise<MimocodeInvocationEnvironment> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'mimocode',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('mimocode') ?? 'mimo';
    // The conversation's own database, when it has one: a session created
    // against one cannot be loaded from another, so a turn launched without it
    // resumes nothing and leaves the history behind.
    const runtimeEnv = buildMimocodeRuntimeEnv(settings, executable, databasePath ?? null);
    const promptSettings = {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath: cwd,
    };
    const artifacts = await prepareMimocodeLaunchArtifacts({
      runtimeEnv,
      settings: promptSettings,
      workspaceRoot: cwd,
    });
    const mcpServers = ProviderWorkspaceRegistry.getMcpServerManager('mimocode')?.getServers() ?? [];
    return {
      executable,
      cwd,
      environment: definedEnvironment({
        ...runtimeEnv,
        MIMOCODE_CONFIG: artifacts.configPath,
        PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
      }),
      // The legacy runtime's launch key, unchanged: what a running process
      // cannot be told about after it has started.
      launchKey: JSON.stringify({
        command: executable,
        configPath: artifacts.configPath,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'mimocode'),
        promptKey: computeSystemPromptKey(promptSettings),
        // The artifact key already carries the resolved database, which is what
        // makes a tab that moves to a conversation kept in another one restart
        // its process — a running process reads one database.
        artifactKey: artifacts.launchKey,
        // Added to the legacy key rather than inherited from it: the legacy
        // runtime shut the process down on an MCP reload, and a session that
        // is already loaded is never told about a server list that changed
        // under it. Here the fingerprint is what restarts the process, so the
        // next turn's session is created with the servers the vault now has.
        mcpServers,
      }),
      mcpServers,
      // What the artifacts resolved, which is the answer the conversation is
      // saved with — `MIMOCODE_DB` when it was given, the vault default when
      // it was not.
      databasePath: artifacts.databasePath,
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
    `MiMoCode MCP slot "${slot}" is served by the workspace registration, not by a chat tab.`,
  ));
}

/**
 * Which agent each purpose runs as.
 *
 * An inline edit reads the note around what it is editing; a title and a
 * refinement are given everything they need in the prompt. Copied from the
 * three legacy services rather than decided again — this is their behaviour,
 * moved.
 */
const AUXILIARY_AGENT_PROFILES: Readonly<Record<MimocodeAuxiliaryPurpose, MimocodeAuxAgentProfile>> = {
  inline: 'readonly',
  instructions: 'passive',
  'title-gen': 'passive',
};

/**
 * The raw model id an auxiliary turn runs under.
 *
 * Two id spaces and two callers. A caller that names a model hands over either
 * the encoded selection id the settings UI stores or a raw provider id carried
 * from elsewhere; decoding only the first and passing the second through is what
 * the legacy runner does, and an id decoded from the wrong space is a model the
 * account does not have.
 *
 * A caller that names none — inline edit and instruction refinement, unless the
 * user set an override — falls back to **the model the chat is set to**, which
 * is the behaviour the legacy runner had and the reason this takes the settings.
 * Without it an auxiliary turn silently runs on whatever the CLI defaults to,
 * which is a different model and a different bill from the one the vault is
 * configured for. A raw id in that setting is left alone: the legacy runner only
 * ever applied a decoded selection here.
 */
function resolveMimocodeAuxiliaryModelId(
  settings: Record<string, unknown>,
  model?: string,
): string | undefined {
  const trimmed = model?.trim();
  if (trimmed) {
    return isMimocodeModelSelectionId(trimmed) ? decodeMimocodeModelId(trimmed) ?? undefined : trimmed;
  }

  const selected = typeof settings.model === 'string' ? settings.model : '';
  return isMimocodeModelSelectionId(selected) ? decodeMimocodeModelId(selected) ?? undefined : undefined;
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
 * The adapter for one MiMoCode tab, plus the one lifecycle it has no port for.
 *
 * A tab closing is when the prompts it raised and the turns it queued stop
 * being anyone's; waiting for its next turn is waiting for one that never
 * comes.
 */
class MimocodeRuntimeAdapter extends ExecutionChatRuntimeAdapter {
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
