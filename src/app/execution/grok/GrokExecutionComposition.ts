import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import {
  type GrokMetadataLaunch,
  GrokMetadataSession,
} from '@/app/execution/grok/GrokMetadataSession';
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
import {
  type BoundConversation,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeHostPorts,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import type GrimoirePlugin from '@/main';
import { isAcpMissingSessionError, JsonRpcErrorResponse } from '@/providers/acp';
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { AcpWorkspaceFileSystem } from '@/providers/acp/execution/AcpWorkspaceFileSystem';
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import { ManagedAcpAuxiliaryQuery } from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { ManagedAcpExecutionBackendContext } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import type {
  AcpAskUserQuestionRequest,
  AcpAskUserQuestionResponse,
} from '@/providers/acp/types';
import { createGrokModuleContext } from '@/providers/grok/app/GrokModuleContext';
import { grokPlanUsageStore } from '@/providers/grok/app/GrokPlanUsageStore';
import {
  type GrokAcpDynamicConfig,
  GrokAcpDynamicConfigApplier,
} from '@/providers/grok/execution/GrokAcpDynamicConfig';
import { createGrokAuxiliaryFileSystem } from '@/providers/grok/execution/GrokAuxiliaryFileSystem';
import { GrokContentPresenter } from '@/providers/grok/execution/GrokContentPresenter';
import { GrokExecutionBackend } from '@/providers/grok/execution/GrokExecutionBackend';
import {
  auxiliaryRetentionKey,
  type GrokAuxiliaryEnvironment,
  type GrokAuxiliaryPurpose,
  type GrokAuxiliaryRequest,
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
import { GrokNativeTranscriptRecovery } from '@/providers/grok/history/GrokTranscriptRecovery';
import {
  loadGrokSessionContextUsage,
  loadGrokSessionCost,
} from '@/providers/grok/history/GrokUsageMetadataStore';
import {
  decodeGrokModelId,
  isGrokModelSelectionId,
} from '@/providers/grok/models';
import { resolveGrokPermissionModeForSettings } from '@/providers/grok/modes';
import { buildGrokPromptBlocks, buildGrokPromptText } from '@/providers/grok/runtime/buildGrokPrompt';
import { formatGrokAskUserQuestionResponse } from '@/providers/grok/runtime/formatGrokAskUserQuestionResponse';
import { logGrokDebug } from '@/providers/grok/runtime/grokDebugLog';
import { buildGrokAgentProcessArgs } from '@/providers/grok/runtime/GrokLaunchArgs';
import {
  type GrokAuxiliaryProfile,
  prepareGrokLaunchArtifacts,
  resolveGrokAuxiliaryPermissionMode,
} from '@/providers/grok/runtime/GrokLaunchArtifacts';
import { applyGrokNativeModelCatalog, readGrokNativeModelCatalog } from '@/providers/grok/runtime/GrokModelsCache';
import {
  buildManagedGrokProcessEnv,
  resolveGrokSessionDirectory,
  resolveManagedGrokHomePath,
} from '@/providers/grok/runtime/GrokPaths';
import { buildGrokRuntimeEnv } from '@/providers/grok/runtime/GrokRuntimeEnvironment';
import { GrokSessionNotificationMirrorDeduplicator } from '@/providers/grok/runtime/GrokSessionNotificationMirrorDeduplicator';
import {
  GROK_SESSION_NOTIFICATION_METHODS,
  type GrokSessionNotificationSource,
  parseGrokSessionNotification,
} from '@/providers/grok/runtime/GrokSessionNotifications';
import type { GrokProviderState } from '@/providers/grok/types';
import { grokChatUIConfig } from '@/providers/grok/ui/GrokChatUIConfig';
import { getEnhancedPath } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

import { auxiliaryPurposeKey } from '../auxiliaryPurpose';
import { delayThroughWindow } from '../hostTimers';
import { KernelAuxQueryRunner } from '../KernelAuxQueryRunner';
import { ProviderWorkspaceHolder } from '../ProviderWorkspaceHolder';

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

/**
 * What the account has spent, in Grok's own method name.
 *
 * No ACP method answers it, and the legacy runtime asks the live transport the
 * same question — the plan indicator is otherwise empty for this provider.
 */
const GROK_BILLING_METHOD = 'x.ai/billing';

/** Where a session opened only to answer a question keeps its state. */
const GROK_METADATA_ARTIFACTS_SUBDIR = 'grok/metadata';

/** How much of a session log a recovered answer may be, in bytes. */
const GROK_RECOVERED_ANSWER_LIMIT_BYTES = 1_000_000;

/**
 * Grok chat execution, assembled from the running plugin.
 *
 * **Live.** `registration.ts` builds every Grok chat runtime from here, and
 * `GrokChatRuntime` is gone. Reverting the flip means restoring that file and
 * this composition's `createRuntime`, in one commit; the control records it
 * writes are inert to anything else.
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

  /** Which tab answers a question Grok asked on which session. */
  private readonly questionAskers = new Map<string, () => AskUserQuestionCallback | undefined>();
  private questionAbort: AbortController | null = null;

  /** Where each open session's transcript is, by the tab that opened it. */
  private readonly sessionPaths = new Map<string, () => GrokProviderState>();

  private readonly presenters = new Set<GrokInteractionPresenter>();

  private readonly transcriptRecovery = new GrokNativeTranscriptRecovery();

  private metadataSession: GrokMetadataSession | undefined;
  private clientFactory: ManagedAcpClientFactory | undefined;
  private auxiliaryClientFactory: ManagedAcpClientFactory | undefined;
  private injectedClientFactory: ManagedAcpClientFactory | undefined;

  /** This composition's identity in the plan-usage store's reader table. */
  private readonly billingReaderOwner = {};

  private backend: GrokExecutionBackend | undefined;

  /**
   * This provider's workspace slots, built on the first question.
   *
   * The context is built with no conversation and with every runtime port
   * refusing: a workspace slot answers about the plugin, never about a tab, and
   * one that reached for a tab's session would be answering from whichever tab
   * happened to build the workspace first. Refusing says so where it happens.
   */
  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    grokProviderModule.workspace,
    () => createGrokModuleContext(this.plugin, () => null,
      { sessionPaths: () => runtimeOnly('sessionPaths') }),
  );

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
  createBackend(clientFactory?: ManagedAcpClientFactory): GrokExecutionBackend {
    // Injected once, and for both: a test that hands the backend a fake agent
    // must not have an auxiliary turn launch a real one behind it.
    if (clientFactory) {
      this.injectedClientFactory = clientFactory;
      this.auxiliaryClientFactory = clientFactory;
    }
    this.clientFactory = clientFactory ?? this.clientFactory ?? this.createClientFactory();

    const context: Omit<ManagedAcpExecutionBackendContext, 'descriptor'> = {
      clientFactory: this.clientFactory,
      requestResolver: this.requests,
      dynamicApplier: new GrokAcpDynamicConfigApplier({
        resolve: dynamicRef => this.requests.resolveDynamic(dynamicRef),
      }),
      interactionBridge: this.interactions,
      resultSink: new GrokProjectionResultSink({
        fillSurface: input => this.fillSurface(input),
        recoverAnswer: input => this.recoverAnswer(input.nativeSessionRef),
      }),
      reconciler: {
        // A turn that answered the cancel it was sent is a turn known to
        // have stopped, and ACP delivers that answer on the prompt itself.
        // For anything else — a run this process did not see finish — what
        // is known is nothing. Grok's own session log could answer that, and
        // until it is read the honest evidence is `unknown` with effects
        // possible, which is what makes the kernel refuse to re-dispatch.
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
      // What this provider says when a saved session is not there any more.
      //
      // The shared heuristic wants the agent to say "session" and Grok says
      // `FS_NOT_FOUND` — its store is a directory, and a session that was
      // deleted, or a vault that moved, is a missing path. Without this the
      // kernel reads it as a hard failure and refuses the turn, where the
      // legacy resume policy dropped the binding and created a session. Only
      // for `session/load`: the same code from a prompt is a real error.
      isMissingSessionError: error => (
        isAcpMissingSessionError(error)
        || (error instanceof JsonRpcErrorResponse
          && (error.method === 'session/load' || error.method === 'loadSession')
          && readErrorCode(error.data) === 'FS_NOT_FOUND')
      ),
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
   * One per tab, not one per provider.
   * Four things are built per tab rather than shared, each because it is about
   * *this* conversation's session: what it is set to, what it has said, what
   * commands it offers, and which prompt is on screen.
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
    let adapter: GrokRuntimeAdapter | undefined;
    let sessionCommands: readonly ProviderCommandDescriptor[] = [];
    // Where this tab's session writes its transcript. Grok's history, its
    // context reading and its cost all come out of that directory, and the
    // conversation is saved pointing at it.
    let sessionDirPath: string | null = null;
    let workspacePath: string | null = null;
    const ownedSessions = new Set<string>();
    /**
     * Lets go of every native session this tab registered callbacks for.
     *
     * Called when the tab closes, and when it moves to another conversation.
     * The second is the one that was missing: the callbacks read *this tab's*
     * current state, so an entry left behind under the previous conversation's
     * session id answered a late-settling run of that conversation with the new
     * conversation's session directory — and approved its writes with the new
     * conversation's callback.
     */
    const releaseOwnedSessions = (): void => {
      for (const sessionId of ownedSessions) {
        this.writeApprovers.delete(sessionId);
        this.surfaceReaders.delete(sessionId);
        this.sessionPaths.delete(sessionId);
        this.questionAskers.delete(sessionId);
      }
      ownedSessions.clear();
    };
    let sawTurnCost = false;
    const boundConversation = (): BoundConversation | null => conversation;
    // Minted once, and only used while no conversation is bound: a fallback
    // minted per read would give one tab's session and its runs different
    // owners, which the registry refuses.
    const grokTab = opaqueId('groktab');


    const sessionConfig = new GrokSessionConfigState({
      settingsBag: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      refreshSelectors: () => this.refreshSelectors(),
      workspaceRoot: () => getVaultPath(this.plugin.app) ?? process.cwd(),
      cliPath: () => this.plugin.getResolvedProviderCliPath('grok') ?? 'grok',
      // Through Grok's own logger rather than the plugin's: it stamps the
      // provider onto every record, which is what makes a debug log filterable
      // by the provider that wrote it.
      recordDebug: (event, data) => logGrokDebug(this.plugin, event, data),
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
      // What the session says it is set to now: a `/mode` in the composer moves
      // it under the tab, and the next turn is translated against whatever the
      // state last heard.
      onCurrentMode: currentModeId => this.settle(
        sessionConfig.syncSessionModeState({ currentModeId }),
      ),
      onConfigOptions: configOptions => this.settle(
        sessionConfig.syncSessionModelState({ configOptions: [...configOptions] }),
      ),
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
        this.questionAskers.set(
          opening.sessionId,
          () => adapter?.interactionCallbacks().question as AskUserQuestionCallback | undefined,
        );
        this.sessionPaths.set(opening.sessionId, () => ({
          ...(sessionDirPath ? { sessionDirPath } : {}),
          ...(workspacePath ? { workspacePath } : {}),
        }));
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
          releaseOwnedSessions();
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
            return describeAcpSessionOpenFailure('Grok Build', refused.message);
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
          return 'Grimoire could not start the Grok CLI. Set an absolute CLI path in the '
            + 'Grok settings — desktop apps do not inherit the shell PATH.';
        }
        if (reason === 'pre-dispatch-rejected') {
          return describeAcpSessionOpenFailure('Grok Build');
        }
        return undefined;
      },
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter,
      delay: delayThroughWindow,
      reportCleanupFailure: error => {
        logGrokDebug(this.plugin, 'execution.cleanup.failed', {}, { error, level: 'warn' });
      },
    };

    // Built here, not passed in: the module's history contribution answers
    // about *this tab's* conversation, so the context has to close over the
    // same one the ports above sync.
    const contributions = grokProviderModule.runtimePorts(
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
          : { kind: 'internal-service', ownerId: grokTab }),
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
          load: async () => {
            const manager = ProviderWorkspaceRegistry.getMcpServerManager('grok');
            await manager?.loadServers();
            return manager?.getServers() ?? [];
          },
          save: () => notWiredHere('save'),
        },
      },
      () => {
        // The tab closing is when the prompts it raised stop being anyone's,
        // and when a write on its sessions has nobody left to ask.
        presenter.dismissAll();
        releaseSettled();
        this.presenters.delete(presenter);
        releaseOwnedSessions();
      },
    );
    adapter = runtime;
    return runtime;
  }

  /**
   * What Grimoire asks Grok when nobody is having a conversation.
   *
   * The model catalog, the settings tab, the chat toolbar and the command
   * loader all need the same two answers, and each of them used to build a
   * whole chat runtime to get them. One isolated session serves all of them.
   */
  get metadata(): GrokMetadataSession {
    this.metadataSession ??= new GrokMetadataSession({
      // The same factory the backend runs on, so a test that hands the backend
      // a fake agent is not answered by a real process launched behind it.
      clientFactory: this.clientFactory ??= this.createClientFactory(),
      launch: () => this.metadataLaunch(),
      settingsBag: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      refreshSelectors: () => this.refreshSelectors(),
      workspaceRoot: () => getVaultPath(this.plugin.app) ?? process.cwd(),
      cliPath: () => this.plugin.getResolvedProviderCliPath('grok') ?? 'grok',
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
        (modelId, settings) => grokChatUIConfig.ownsModel(modelId, settings),
        decodeGrokModelId,
      ),
    };
  }

  createAuxRunner(purpose: GrokAuxiliaryPurpose): AuxQueryRunner {
    const conversationId = opaqueId('grokaux');
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
    grokPlanUsageStore.setBillingReader(null, this.billingReaderOwner);
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
   * applier skips whatever is empty. The reasoning effort is absent on purpose:
   * Grok takes it on the command line, so it belongs to the launch key.
   */
  private dynamicConfiguration(
    sessionConfig: GrokSessionConfigState,
    options?: ChatRuntimeQueryOptions,
  ): GrokAcpDynamicConfig | undefined {
    // The vault's wish, in the vault's own vocabulary. Translating it needs
    // what the session named, which is known when the turn is applied and not
    // when it is composed — so the applier does it.
    const modeId = sessionConfig.resolveSelectedModeId();
    const modelId = sessionConfig.resolveSelectedRawModelId(options);
    const dynamic: GrokAcpDynamicConfig = {
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { modelId } : {}),
    };
    return Object.keys(dynamic).length > 0 ? dynamic : undefined;
  }

  /**
   * The answer Grok wrote down but never sent.
   *
   * Read from the session's own transcript, through the tab that owns it —
   * which is the only thing that knows where that transcript is. Bounded,
   * because an unbounded read of a session log is a whole conversation loaded
   * to recover one message.
   */
  private async recoverAnswer(nativeSessionRef: string): Promise<string | null> {
    const paths = this.sessionPaths.get(nativeSessionRef)?.();
    if (!paths) {
      return null;
    }
    const recovered = await this.transcriptRecovery.recoverFinalAssistantMessage({
      nativeSessionRef,
      workspacePath: paths.workspacePath ?? null,
      providerState: paths,
      maxBytes: GROK_RECOVERED_ANSWER_LIMIT_BYTES,
    }).catch(() => '');
    return recovered.trim() || null;
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
      logGrokDebug(this.plugin, 'execution.sessionConfig.failed', {}, { error, level: 'warn' });
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
   * A question Grok asked, put to the tab whose session it came in on.
   *
   * Not an interaction the kernel carries: ACP's `ask_user_question` is a
   * server request with its own answer shape, and the legacy runtime answered
   * it from the same callback the chat surface installs. A question whose
   * session belongs to no open tab is cancelled — the alternative is a turn
   * waiting for an answer nobody will ever be shown.
   */
  private async askUserQuestion(
    request: AcpAskUserQuestionRequest,
  ): Promise<AcpAskUserQuestionResponse> {
    const ask = this.questionAskers.get(request.sessionId)?.();
    if (!ask) {
      return { outcome: 'cancelled' };
    }
    const abort = new AbortController();
    const previous = this.questionAbort;
    this.questionAbort = abort;
    previous?.abort();
    try {
      const answers = await ask({ questions: request.questions }, abort.signal);
      return formatGrokAskUserQuestionResponse(answers);
    } finally {
      if (this.questionAbort === abort) {
        this.questionAbort = null;
      }
    }
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

  /**
   * The factory an auxiliary process is launched through, and it is not the
   * chat one.
   *
   * **What a chat turn may reach and an auxiliary turn may not.** The chat
   * filesystem opts out of containment in `always-approve` — the user asked for
   * it, and they are watching the turn that uses it. An auxiliary turn has
   * nobody watching and no surface to ask on: a title being generated in the
   * background must not read outside the vault because the *chat* was set to
   * auto-approve, and must not write at all. The legacy runner contained every
   * auxiliary read for exactly this reason, and it declared no write.
   */
  private auxiliaryFactory(): ManagedAcpClientFactory {
    this.auxiliaryClientFactory ??= this.injectedClientFactory ?? this.createAuxiliaryFactory();
    return this.auxiliaryClientFactory;
  }

  /**
   * Two auxiliary clients behind one factory, chosen by what the launch may read.
   *
   * The OpenCode forks can build one client for all three purposes because their
   * agent definition is what denies a read. Grok has no such definition, so the
   * only thing that can say "this purpose reads nothing" is the client — and it
   * says it in the handshake, by being built without a filesystem delegate at
   * all. That is what the legacy runner's `allowReadTextFile` did, and it is
   * decided per launch, which is what the startup reference names.
   */
  private createAuxiliaryFactory(): ManagedAcpClientFactory {
    const reading = this.buildAuxiliaryFactory(createGrokAuxiliaryFileSystem(
      () => getVaultPath(this.plugin.app) ?? process.cwd(),
    ));
    const blind = this.buildAuxiliaryFactory(undefined);
    return {
      create: input => (
        this.requests.auxiliaryReadsFiles(input.startupRef) ? reading : blind
      ).create(input),
    };
  }

  private buildAuxiliaryFactory(
    fileSystem: AcpWorkspaceFileSystem | undefined,
  ): ManagedAcpClientFactory {
    return new AcpManagedClientAdapterFactory({
      clientInfo: {
        name: 'grimoire-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      // The vendor envelope is the chat client's too: without it a turn's stop
      // reason arrives on a method this client would drop, and an auxiliary
      // prompt would never settle.
      vendorSessionNotifications: {
        methods: GROK_SESSION_NOTIFICATION_METHODS,
        parse: (method, params) => parseGrokSessionNotification(method, params),
        createDeduplicator: () => {
          const mirror = new GrokSessionNotificationMirrorDeduplicator();
          return (notification, source) => mirror.shouldProcess(
            notification,
            source as GrokSessionNotificationSource,
          );
        },
      },
      delegate: {
        ...(fileSystem
          ? {
            fileSystem: {
              readTextFile: request => fileSystem.readTextFile(request),
              writeTextFile: request => fileSystem.writeTextFile(request),
            },
          }
          : {}),
      },
      processLauncher: new NodeManagedAcpProcessLauncher({
        resolve: startupRef => this.requests.resolveLaunch(startupRef),
      }),
    });
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
        // Some releases mirror the same update onto both channels, and a
        // client that delivers both prints every sentence twice and commits it
        // twice. One filter per connection, because two Grok processes are two
        // conversations.
        createDeduplicator: () => {
          const mirror = new GrokSessionNotificationMirrorDeduplicator();
          return (notification, source) => mirror.shouldProcess(
            notification,
            source as GrokSessionNotificationSource,
          );
        },
      },
      // Declared, and therefore used: an ACP client that advertises no
      // filesystem is one the agent writes around, and the containment and the
      // write approval below are the two things it would be writing around.
      delegate: {
        // Grok asks the client questions of its own, beside the permissions the
        // kernel carries as interactions. Answered by the tab the question's
        // session belongs to, the same way a write is — and cancelled rather
        // than guessed when no tab owns it.
        askUserQuestion: request => this.askUserQuestion(request),
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
   * The process a question is asked in, which is nobody's conversation.
   *
   * Its own managed home is what makes it isolated — the same isolation the
   * auxiliary query runner uses — so asking what models exist never binds a
   * session to a tab or leaves one in the chat home's session store. The
   * permission policy is the vault's, because a launch flag is not optional.
   */
  private async metadataLaunch(): Promise<GrokMetadataLaunch> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'grok',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('grok') ?? 'grok';
    const permissionMode = resolveGrokPermissionModeForSettings(settings.permissionMode);
    const artifacts = await prepareGrokLaunchArtifacts({
      artifactsSubdir: GROK_METADATA_ARTIFACTS_SUBDIR,
      permissionMode,
      settings: {
        customPrompt: this.plugin.settings.systemPrompt,
        mediaFolder: this.plugin.settings.mediaFolder,
        userName: this.plugin.settings.userName,
        vaultPath: cwd,
      },
      workspaceRoot: cwd,
    });
    const runtimeEnv = buildGrokRuntimeEnv(this.plugin.settings, executable, artifacts.grokHomePath);
    return {
      startupRef: this.requests.referenceLaunch({
        executable,
        arguments: buildGrokAgentProcessArgs(null, permissionMode),
        cwd,
        environment: definedEnvironment({
          ...runtimeEnv,
          PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
        }),
      }),
      cwd,
      mcpServers: toAcpMcpServers([
        ...(ProviderWorkspaceRegistry.getMcpServerManager('grok')?.getServers() ?? []),
      ]),
    };
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
  /**
   * What an auxiliary `grok agent … stdio` is launched under.
   *
   * The chat environment's shape with three differences, and each is what makes
   * an auxiliary turn auxiliary: its **own managed home** per purpose, so a
   * title's config, system prompt and session store cannot be the
   * conversation's; its **own permission mode**, which is what stops an
   * unattended turn from writing to the vault, and which rides on the command
   * line here rather than on the session; and its **own system prompt**, which
   * is the caller's rather than the vault's — a title is asked for by the prompt
   * that asks for a title.
   *
   * No MCP servers: an auxiliary turn has nothing to offer a tool.
   */
  private async auxiliaryEnvironment(
    request: GrokAuxiliaryRequest,
  ): Promise<GrokAuxiliaryEnvironment> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'grok',
    );
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const executable = this.plugin.getResolvedProviderCliPath('grok') ?? 'grok';
    const profile = AUXILIARY_PROFILES[request.purpose];
    const permissionMode = resolveGrokAuxiliaryPermissionMode(profile);
    const artifacts = await prepareGrokLaunchArtifacts({
      artifactsSubdir: `grok/auxiliary/${request.purpose}`,
      permissionMode,
      systemPromptKey: request.systemPrompt,
      systemPromptText: request.systemPrompt,
      workspaceRoot: cwd,
    });
    const runtimeEnv = buildGrokRuntimeEnv(this.plugin.settings, executable, artifacts.grokHomePath);
    // Read from the projected snapshot rather than off the settings bag: the
    // bag's `effortLevel` belongs to whichever provider a tab last selected,
    // and an auxiliary turn launched with another provider's effort is a
    // process started for settings nobody chose. The legacy runner read the bag.
    const reasoningEffort = typeof settings.effortLevel === 'string' ? settings.effortLevel : null;
    const modelId = resolveGrokAuxiliaryModelId(settings, request.model);
    return {
      executable,
      arguments: buildGrokAgentProcessArgs(reasoningEffort, permissionMode),
      cwd,
      environment: definedEnvironment({
        ...runtimeEnv,
        PATH: getEnhancedPath(runtimeEnv.PATH, isAbsolute(executable) ? executable : undefined),
      }),
      // The legacy runner's launch key, unchanged: command, environment, the
      // managed home, the effort it was started with, and the artifacts' own key
      // — which carries the system prompt and the permission mode with it.
      launchKey: JSON.stringify({
        artifactKey: artifacts.launchKey,
        command: executable,
        envText: getRuntimeEnvironmentText(this.plugin.settings, 'grok'),
        grokHomePath: artifacts.grokHomePath,
        reasoningEffort,
      }),
      readsFiles: profile === 'readonly',
      ...(modelId ? { modelId } : {}),
    };
  }

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

/**
 * Which profile each purpose runs as.
 *
 * An inline edit reads the note around what it is editing; a title and a
 * refinement are given everything they need in the prompt. Copied from the
 * three legacy services rather than decided again — this is their behaviour,
 * moved.
 */
const AUXILIARY_PROFILES: Readonly<Record<GrokAuxiliaryPurpose, GrokAuxiliaryProfile>> = {
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
 * Without it an auxiliary turn silently runs on whatever the CLI defaults to.
 * A raw id in that setting is left alone: the legacy runner only ever applied a
 * decoded selection here.
 */
function resolveGrokAuxiliaryModelId(
  settings: Record<string, unknown>,
  model?: string,
): string | undefined {
  const trimmed = model?.trim();
  if (trimmed) {
    return isGrokModelSelectionId(trimmed) ? decodeGrokModelId(trimmed) ?? undefined : trimmed;
  }

  const selected = typeof settings.model === 'string' ? settings.model : '';
  return isGrokModelSelectionId(selected) ? decodeGrokModelId(selected) ?? undefined : undefined;
}

/** The vendor's own code for a failure, where it names one. */
function readErrorCode(data: unknown): string | undefined {
  return typeof data === 'object' && data !== null && 'code' in data
    && typeof (data as { code?: unknown }).code === 'string'
    ? (data as { code: string }).code
    : undefined;
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
class GrokRuntimeAdapter extends ExecutionChatRuntimeAdapter {
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
 * A runtime port reached from a workspace context.
 *
 * Refused rather than answered: these are a tab's, and a workspace slot that
 * asked for one would be answering from whichever tab happened to build the
 * workspace first. Nothing does today, and this is what would happen if
 * something started.
 */
function runtimeOnly(port: string): never {
  throw new Error(`Runtime port "${port}" is not available from a workspace context.`);
}
