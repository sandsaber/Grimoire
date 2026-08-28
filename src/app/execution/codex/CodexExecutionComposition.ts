import { randomUUID } from 'node:crypto';

import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/app/execution/codex/NodeCodexExecutionConnectionFactory';
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
import { buildSystemPrompt } from '@/core/prompt/mainAgent';
import type { ProviderRuntimePorts, ProviderWorkspaceSlots } from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
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
import { createCodexModuleContext } from '@/providers/codex/app/CodexModuleContext';
import { codexPlanUsageStore } from '@/providers/codex/app/CodexPlanUsageStore';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import { CodexAuxiliaryQuery } from '@/providers/codex/execution/CodexAuxiliaryQuery';
import { CodexContentPresenter } from '@/providers/codex/execution/CodexContentPresenter';
import { readCodexConversationBinding } from '@/providers/codex/execution/CodexConversationBinding';
import {
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
  type CodexExecutionConnectionFactory,
} from '@/providers/codex/execution/CodexExecutionBackend';
import {
  auxiliaryRetentionKey,
  type CodexAuxiliaryEnvironment,
  type CodexAuxiliaryPurpose,
  type CodexAuxiliaryRequest,
  CodexExecutionRequests,
  type CodexInvocationEnvironment,
} from '@/providers/codex/execution/CodexExecutionRequests';
import {
  CodexExecutionTurnReconciler,
  CodexJsonlExecutionTranscriptReader,
} from '@/providers/codex/execution/CodexExecutionTurnReconciler';
import { CodexInteractionBridge } from '@/providers/codex/execution/CodexInteractionBridge';
import { CodexInteractionPresenter } from '@/providers/codex/execution/CodexInteractionPresenter';
import { CodexProjectionResultSink } from '@/providers/codex/execution/CodexProjectionResultSink';
import { encodeCodexTurn } from '@/providers/codex/prompt/encodeCodexTurn';
import { resolveCodexAppServerLaunchSpec } from '@/providers/codex/runtime/codexAppServerSupport';
import type { CodexExecutionConnection } from '@/providers/codex/runtime/CodexExecutionConnection';
import { createCodexRuntimeContext } from '@/providers/codex/runtime/CodexRuntimeContext';
import { CodexSkillListingService } from '@/providers/codex/skills/CodexSkillListingService';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';
import { getVaultPath } from '@/utils/path';

import { auxiliaryPurposeKey } from '../auxiliaryPurpose';
import { delayThroughWindow } from '../hostTimers';
import { KernelAuxQueryRunner } from '../KernelAuxQueryRunner';
import { ProviderWorkspaceHolder } from '../ProviderWorkspaceHolder';

/**
 * What an auxiliary turn may answer with, which is much less than a chat turn.
 *
 * A title is a line and a refinement is a paragraph. The chat limit is for a
 * turn that may legitimately produce a file's worth of text; an auxiliary answer
 * that size is a model that misread its instructions, and reading 64 KB of it
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
 * Codex chat execution, assembled from the running plugin.
 *
 * One object per plugin load, holding what the backend and every tab runtime
 * must agree on: the store behind the kernel's request references, the launch
 * spec the daemon runs under and paths are expressed in, and the bridge that
 * turns a server request into something the surface can show. None of these can
 * be handed out as copies — a reference minted against one store resolves to
 * nothing in another, and a path expressed for one target means a different
 * place on the other.
 *
 * It lives in `src/app/` because the backend takes no plugin and no vault: it
 * is a strict module by the composition gate, and everything ambient reaches it
 * as a port constructed here.
 */
export class CodexExecution {
  private readonly activeLaunchSpec = new CodexActiveLaunchSpec(
    () => resolveCodexAppServerLaunchSpec(this.plugin, 'codex'),
  );
  private readonly interactions = new CodexInteractionBridge();
  private readonly skills = new CodexSkillListingService(this.plugin);
  private readonly requests = new CodexExecutionRequests(
    () => opaqueId('codexreq'),
    () => this.environment(),
    undefined,
    request => this.auxiliaryEnvironment(request),
  );

  /**
   * The auxiliary daemons, one per runner that asked for one.
   *
   * Built here rather than per tab because auxiliary work belongs to no tab: a
   * title is generated for a conversation nobody may be looking at, and an
   * inline edit runs from a modal over a note. Disposed with the backend, which
   * is what closes the daemons it kept.
   */
  private readonly auxiliaryQueries = new CodexAuxiliaryQuery(
    { resolve: requestRef => this.requests.resolveAuxiliary(requestRef) },
    // Resolved per launch rather than captured: `createBackend` may be handed a
    // fake connection factory by a test, and an auxiliary daemon launched behind
    // it would be a real CLI nobody asked for.
    { create: () => this.auxiliaryConnectionFactory().create() },
    {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    AUXILIARY_RESULT_BYTE_LIMIT,
    AUXILIARY_TIMEOUT_MS,
  );
  private injectedConnectionFactory: CodexExecutionConnectionFactory | undefined;
  private auxiliaryFactory: CodexExecutionConnectionFactory | undefined;
  private backend: CodexExecutionBackend | undefined;
  private readonly presenters = new Set<CodexInteractionPresenter>();
  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    codexProviderModule.workspace,
    // No conversation: the workspace slots are the plugin's, not a tab's, which
    // is also the only way a synchronous `createRuntime` can have them.
    () => createCodexModuleContext(this.plugin, () => null),
  );
  private runtimeContext: ReturnType<typeof createCodexRuntimeContext> | undefined;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly plugin: GrimoirePlugin,
    private readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /**
   * The backend, over an application-owned daemon by default.
   *
   * The connection factory is a parameter because it is the seam between
   * provider protocol and process ownership, and a test that has to launch
   * `codex app-server` to check how a turn is composed is testing the wrong
   * thing.
   */
  createBackend(
    connectionFactory: CodexExecutionConnectionFactory = this.createConnectionFactory(),
  ): CodexExecutionBackend {
    // Remembered for both: a test that hands the backend a fake daemon must not
    // have an auxiliary turn launch a real one behind it.
    this.injectedConnectionFactory ??= connectionFactory;
    const context: CodexExecutionBackendContext = {
      // Wrapped so every connection this composition builds also feeds the
      // plan-limit indicator: its reader and its subscription both lived in the
      // deleted runtime, and without them the badge is permanently empty.
      connectionFactory: {
        create: () => {
          const connection = connectionFactory.create();
          this.wirePlanUsage(connection);
          return connection;
        },
      },
      requestResolver: this.requests,
      auxiliaryQueries: this.auxiliaryQueries,
      resultSink: new CodexProjectionResultSink(),
      interactionBridge: this.interactions,
      turnReconcilerFactory: {
        create: connection => new CodexExecutionTurnReconciler(
          connection,
          // The daemon reports where it keeps transcripts as part of its
          // handshake, so the reader is built per connection rather than from a
          // path guessed before one exists.
          new CodexJsonlExecutionTranscriptReader(this.rememberRuntimeContext(connection)),
        ),
      },
      // What a thread has to be resumed with when the backend has no turn of
      // its own to take parameters from — recovery after a restart, where the
      // conversation's own request is long gone.
      defaultResumeParams: {
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        experimentalRawEvents: true,
        persistExtendedHistory: true,
      },
      scheduler: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      interactionIdFactory: () => interactionId(opaqueId('ix')),
    };
    this.backend = new CodexExecutionBackend(context);
    return this.backend;
  }

  /**
   * An `AuxQueryRunner` for one auxiliary conversation, answered by the kernel.
   *
   * One per caller, and the caller decides what that means: the title service
   * builds one per title and resets it when the title is done, while inline edit
   * holds one for as long as the edit lasts. That is the unit a daemon and its
   * thread are kept for, so it is the unit the conversation id is minted for.
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
        (modelId, settings) => codexChatUIConfig.ownsModel(modelId, settings)
      ),
    };
  }

  createAuxRunner(purpose: CodexAuxiliaryPurpose): AuxQueryRunner {
    const conversationId = opaqueId('codexaux');
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

  /**
   * The backend and the ports the kernel resolves through it.
   *
   * One call rather than three fields to remember: `CodexExecutionBackend` is
   * also the interaction and recovery port, and registering it as a bare
   * backend leaves both unwired — approvals then reach the surface, are
   * answered, and the answer never gets back to the daemon, because the
   * registry has nowhere to send it.
   */
  createBackendRegistration(
    connectionFactory?: CodexExecutionConnectionFactory,
  ): BackendLifecycleRegistration {
    const backend = connectionFactory
      ? this.createBackend(connectionFactory)
      : this.createBackend();
    return { backend, interactions: backend, recovery: backend };
  }

  /**
   * The Codex chat runtime, over the kernel.
   *
   * One per tab, not one per provider. The
   * conversation is held here rather than in the shared store because one store
   * serves every tab: what the next dispatch resumes, forks, or starts is a
   * property of *this* tab, read when the turn is dispatched.
   */
  createRuntime(
    features?: ProviderRuntimePorts,
    workspace?: ProviderWorkspaceSlots,
  ): ExecutionChatRuntimeAdapter {
    let conversation: BoundConversation | null = null;
    let adapter: CodexRuntimeAdapter | undefined;
    // One store serves every tab, so each turn says which tab queued it: the
    // scratch a turn holds is freed by that tab's next turn and by no other's.
    const scope = opaqueId('codextab');
    const boundConversation = (): BoundConversation | null => conversation;
    // Read late: the surface installs its callbacks on the runtime after this
    // constructs, so a presenter that captured them now would capture nothing.
    const { presenter, release: releaseSettled } = this.createInteractionPresenter(
      () => adapter?.interactionCallbacks() ?? {},
    );
    const isPlanTurn = (): boolean => ProviderSettingsCoordinator
      .getProviderSettingsSnapshot(this.plugin.settings, 'codex').permissionMode === 'plan';
    const content = new CodexContentPresenter(isPlanTurn);
    // The reference this tab last handed the kernel, so a rejection can be
    // explained in the words it was rejected with. Per tab, because the store
    // behind it serves every tab and a refusal belongs to the turn that earned
    // it.
    let lastRequestRef: string | undefined;

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => encodeCodexTurn(request),
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => {
        lastRequestRef = this.requests.reference({
          ...turnRequest(turn, options),
          conversation: boundConversation,
          scope,
          ...(history ? { history } : {}),
        });
        return lastRequestRef;
      },
      // Steering carries the input and nothing else: the turn it joins was
      // launched with the parameters, and it is not being started again.
      encodeSteerRef: (turn: PreparedChatTurn) => this.requests.reference({
        ...turnRequest(turn),
        conversation: boundConversation,
        scope,
      }),
      // The thread this conversation is bound to, which is what the legacy
      // runtime reported and what the history patch writes back.
      currentSessionId: () => {
        const binding = readCodexConversationBinding(conversation);
        if (binding.kind === 'thread') {
          return binding.threadId;
        }
        // Falling back to the thread the daemon is on, which is how a
        // conversation learns its own: the binding is empty until a finished
        // turn writes it, and reporting nothing would mean it never does.
        return content.lastThreadId() ?? null;
      },
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          // A different conversation — or none — is a different thread, and the
          // daemon's is only this one's while this one is bound to it.
          content.forgetConversation();
        }
        conversation = next;
      },
      // The daemon's own words for a failure it reported, instead of the
      // neutral sentence. The error chunk itself is dropped by the presenter,
      // so this is the only place that failure is rendered.
      //
      // A rejection before dispatch is the same problem one step earlier: the
      // resolver refuses `/compact please` with a sentence a user can act on,
      // and the kernel's neutral wording for that terminal cannot name the
      // argument that caused it.
      describeFailure: reason => {
        if (reason === 'provider-failure') {
          return content.lastFailure();
        }
        return reason === 'pre-dispatch-rejected'
          ? this.requests.refusalFor(lastRequestRef)
          : undefined;
      },
      // A plan turn answers with a plan, which arrives as its own notification
      // rather than as a message, so the kernel sees no result to require. A
      // compaction is the adapter's rule, not this one: `isCompact` is a
      // provider-neutral property of the turn.
      resultExpectation: () => (isPlanTurn() ? 'optional' : 'required'),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter,
      // One per tab, because the router it runs tracks a turn's items across
      // notifications and two tabs are two turns.
      presentProviderContent: payload => content.present(payload),
      delay: delayThroughWindow,
      reportCleanupFailure: error => {
        this.plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'codex',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers about
    // *this tab's* conversation, so the context has to close over the same one
    // the ports above sync.
    const contributions = features
      ?? codexProviderModule.runtimePorts(createCodexModuleContext(this.plugin, boundConversation));

    adapter = new CodexRuntimeAdapter(
      {
        registry: this.registry,
        backendId: codexProviderModule.execution.descriptor.backendId,
        capabilities: codexProviderModule.capabilities,
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
          : { kind: 'internal-service', ownerId: scope }),
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      workspace ?? this.workspaceHolder.peek(),
      // The tab closing is the only lifecycle the adapter has no port for, and
      // it is when a tab's images and any prompt it is showing stop being
      // anyone's. Waiting for the tab's next turn is waiting for one that never
      // comes.
      () => {
        this.requests.releaseScope(scope);
        presenter.dismissAll();
        releaseSettled();
      },
    );
    return adapter;
  }

  /**
   * A presenter for one tab, subscribed to the interactions it shows.
   *
   * Subscribed rather than polled because the two endings the surface cannot
   * see — a run cancelled while its prompt is up, and a request Codex answered
   * itself — reach the bridge and nothing else.
   */
  createInteractionPresenter(
    callbacks: ConstructorParameters<typeof CodexInteractionPresenter>[1],
  ): { presenter: CodexInteractionPresenter; release: () => void } {
    const presenter = new CodexInteractionPresenter(this.interactions, callbacks);
    this.presenters.add(presenter);
    const unsubscribe = this.interactions.onSettled(ref => presenter.dismiss(ref));
    // Released by the tab that owns it, and again at plugin dispose for a tab
    // that never closed. Only the second existed: a vault opened and closed all
    // day accumulated one subscription per tab, each holding a presenter for a
    // view that is gone. Grok and OpenCode release theirs at tab close.
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      unsubscribe();
      this.presenters.delete(presenter);
    };
    this.disposers.push(release);
    return { presenter, release };
  }

  /**
   * The workspace slots every tab shares, initialized once.
   *
   * None of them depend on a conversation — commands, models, usage, the CLI,
   * the settings tab — so they are built for the plugin rather than per tab,
   * which is also the only way a synchronous `createRuntime` can have them.
   */
  async initializeWorkspace(): Promise<void> {
    await this.workspaceHolder.resolve();
  }

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

  /** The store every tab runtime references its turns through. */
  get turnRequests(): CodexExecutionRequests {
    return this.requests;
  }

  /** Releases the scratch directories and takes down whatever is on screen. */
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
    for (const disposer of this.disposers.splice(0)) {
      disposer();
    }
    this.presenters.clear();
    this.requests.dispose();
    this.skills.invalidate();
    // The backend closes these when it is disposed, and a composition disposed
    // without one still has daemons to close: an auxiliary turn needs no chat
    // session and may have launched on its own.
    void this.auxiliaryQueries.dispose().catch(() => undefined);
  }

  private createConnectionFactory(): CodexExecutionConnectionFactory {
    return new NodeCodexExecutionConnectionFactory({ activeLaunchSpec: this.activeLaunchSpec });
  }

  /**
   * The factory an auxiliary daemon is launched through.
   *
   * **The same one the chat uses, and for this provider that is the honest
   * answer.** An ACP composition needs a second client factory because its
   * containment is a filesystem delegate the client advertises; Codex's
   * containment is on the thread — `approvalPolicy: 'never'` and
   * `sandbox: 'read-only'`, set in `auxiliaryEnvironment` below — so what
   * separates an auxiliary daemon from a chat one is not how it was launched but
   * what it was asked to do. Every daemon this factory makes is its own process
   * either way, which is the isolation that matters.
   */
  private auxiliaryConnectionFactory(): CodexExecutionConnectionFactory {
    this.auxiliaryFactory ??= this.injectedConnectionFactory ?? this.createConnectionFactory();
    return this.auxiliaryFactory;
  }

  /**
   * What an auxiliary Codex thread is started with.
   *
   * The chat environment's shape with three differences, and each is what makes
   * an auxiliary turn auxiliary: **approvals off and the sandbox read-only**, so
   * an unattended turn cannot write to the vault or ask a question nobody is
   * there to answer; **its own base instructions**, which are the caller's
   * rather than the vault's — a title is asked for by the prompt that asks for a
   * title; and **`persistExtendedHistory: false`**, which keeps auxiliary work
   * out of the transcript store the chat path reads back.
   */
  private async auxiliaryEnvironment(
    request: CodexAuxiliaryRequest,
  ): Promise<CodexAuxiliaryEnvironment> {
    const launchSpec = this.activeLaunchSpec.current();
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'codex',
    );
    const selected = typeof settings.model === 'string' && settings.model
      ? settings.model
      : DEFAULT_CODEX_PRIMARY_MODEL;
    // The thread is started under whichever model this turn will run on, so a
    // caller that named one is not answered by a thread built for another.
    const model = request.model ?? selected;
    return {
      thread: {
        model,
        cwd: launchSpec.targetCwd ?? process.cwd(),
        approvalPolicy: 'never',
        sandbox: 'read-only',
        baseInstructions: request.systemPrompt,
        experimentalRawEvents: true,
        persistExtendedHistory: false,
      },
      // Everything the daemon and its thread were started for. The base
      // instructions are in here because Codex takes them on `thread/start` and
      // a thread cannot be told new ones: changing them has to be a new thread,
      // and the retained pair is a daemon and its thread together.
      launchKey: JSON.stringify({
        command: launchSpec.command,
        args: launchSpec.args,
        cwd: launchSpec.targetCwd ?? null,
        model,
        systemPrompt: request.systemPrompt,
      }),
      // Named on the turn only where the caller named one: a turn that repeats
      // the thread's own model says nothing, and the legacy runner sent it only
      // when it had been asked for.
      ...(request.model ? { model: request.model } : {}),
    };
  }

  /**
   * Everything a queued turn is resolved against, read now rather than when it
   * was queued.
   */
  private async environment(): Promise<CodexInvocationEnvironment> {
    const launchSpec = this.activeLaunchSpec.current();
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'codex',
    );
    return {
      settings,
      launchSpec,
      baseInstructions: orchestratorMode => buildSystemPrompt({
        mediaFolder: this.plugin.settings.mediaFolder,
        customPrompt: this.plugin.settings.systemPrompt,
        vaultPath: getVaultPath(this.plugin.app) ?? undefined,
        userName: this.plugin.settings.userName,
      }, { orchestratorMode }),
      listSkills: () => this.skills.listSkills(),
      // Absent until the first handshake, which is also the first moment it is
      // knowable: the policy then falls back to this machine's home, and says
      // nothing at all for a target that is not this machine. The memories
      // directory is derived from this root by the policy itself, so passing
      // both would be two answers to one question.
      ...(this.runtimeContext?.sessionsDirTarget
        ? { transcriptRootTarget: this.runtimeContext.sessionsDirTarget }
        : {}),
    };
  }

  /**
   * Lets the plan-limit indicator ask the daemon what is left.
   *
   * The reader and the subscription both lived in the deleted runtime, and
   * without them every refresh answers "no reader" and the badge stays empty.
   * Rebound per connection because a reader pointed at a dead daemon answers
   * nothing.
   */
  private wirePlanUsage(connection: CodexExecutionConnection): void {
    const reader = async (): Promise<unknown> => connection.request(
      'account/rateLimits/read',
      {},
    );
    codexPlanUsageStore.setRateLimitsReader(reader);
    const unsubscribe = connection.onNotification((method: string, params: unknown) => {
      if (method === 'account/rateLimits/updated') {
        codexPlanUsageStore.updateFromRateLimits(params);
      }
    });
    // The store is process-wide and this composition is not: on unload there is
    // no next connection to rebind the reader, so without this the badge keeps
    // asking a daemon the kernel has already taken down. Identity-checked in
    // the store, because a later connection's reader is not ours to clear.
    this.disposers.push(() => {
      codexPlanUsageStore.clearRateLimitsReader(reader);
      unsubscribe();
    });
  }

  /**
   * Where the daemon in front of us keeps its transcripts and memories.
   *
   * The daemon reports its own home in the handshake, which is the only source
   * that is right for a custom `CODEX_HOME` and the only one at all for a WSL
   * target. Remembered here because two callers need it: the transcript reader
   * built per connection, and every turn's writable-root policy.
   */
  private rememberRuntimeContext(connection: { readonly initializeResult: unknown }): string {
    const initializeResult = connection.initializeResult;
    if (initializeResult) {
      this.runtimeContext = createCodexRuntimeContext(
        this.activeLaunchSpec.current(),
        initializeResult as Parameters<typeof createCodexRuntimeContext>[1],
      );
    }
    // The reader treats an unreadable root as "no replay available", which is
    // the same answer it gives for a transcript that is not there.
    return this.runtimeContext?.sessionsDirHost ?? '';
  }
}

/**
 * The adapter, plus the one thing a tab's close has to release.
 *
 * A subclass rather than a host port: closing a tab is not a provider
 * capability, it is this composition noticing that the scratch directories and
 * the prompt belonging to that tab are now nobody's.
 */
class CodexRuntimeAdapter extends ExecutionChatRuntimeAdapter {
  constructor(
    context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[1],
    features: ProviderRuntimePorts,
    workspace: ProviderWorkspaceSlots | undefined,
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

/** What one turn decided, before it becomes an opaque reference. */
function turnRequest(turn: PreparedChatTurn, options?: ChatRuntimeQueryOptions): {
  readonly prompt: string;
  readonly text: string;
  readonly images?: readonly { data: string; mediaType: string; name?: string }[];
  readonly isCompact: boolean;
  readonly externalContextPaths: readonly string[];
  readonly orchestratorMode: boolean;
  readonly model?: string;
} {
  return {
    prompt: turn.prompt,
    text: turn.request.text,
    ...(turn.request.images ? { images: turn.request.images } : {}),
    isCompact: turn.isCompact,
    externalContextPaths: turn.request.externalContextPaths
      ?? options?.externalContextPaths
      ?? [],
    orchestratorMode: turn.request.orchestratorMode === true
      || options?.orchestratorMode === true,
    // Absent where the send named no model, which the resolver reads from
    // settings at dispatch — the same order the legacy runtime resolved in.
    ...(typeof options?.model === 'string' ? { model: options.model } : {}),
  };
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
