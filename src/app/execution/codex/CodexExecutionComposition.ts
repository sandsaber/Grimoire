import { randomUUID } from 'node:crypto';

import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/app/execution/codex/NodeCodexExecutionConnectionFactory';
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
import type { ProviderFeatureContributions, ProviderWorkspaceSlots } from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
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
import { createCodexModuleContext } from '@/providers/codex/app/CodexModuleContext';
import { CODEX_PROVIDER_CAPABILITIES } from '@/providers/codex/capabilities';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import { CodexContentPresenter } from '@/providers/codex/execution/CodexContentPresenter';
import { readCodexConversationBinding } from '@/providers/codex/execution/CodexConversationBinding';
import {
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
  type CodexExecutionConnectionFactory,
} from '@/providers/codex/execution/CodexExecutionBackend';
import {
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
import { createCodexRuntimeContext } from '@/providers/codex/runtime/CodexRuntimeContext';
import type { CodexProviderSettings } from '@/providers/codex/settings';
import { CodexSkillListingService } from '@/providers/codex/skills/CodexSkillListingService';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';
import { getVaultPath } from '@/utils/path';

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
  );
  private readonly presenters = new Set<CodexInteractionPresenter>();
  private workspaceSlots: ProviderWorkspaceSlots | undefined;
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
    const context: CodexExecutionBackendContext = {
      connectionFactory,
      requestResolver: this.requests,
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
    return new CodexExecutionBackend(context);
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
   * One per tab, matching how `ProviderRegistry` constructs runtimes today. The
   * conversation is held here rather than in the shared store because one store
   * serves every tab: what the next dispatch resumes, forks, or starts is a
   * property of *this* tab, read when the turn is dispatched.
   */
  createRuntime(
    features?: ProviderFeatureContributions<CodexProviderSettings>,
    workspace?: ProviderWorkspaceSlots,
  ): ChatRuntime {
    let conversation: BoundConversation | null = null;
    let adapter: ExecutionChatRuntimeAdapter<CodexProviderSettings> | undefined;
    // One store serves every tab, so each turn says which tab queued it: the
    // scratch a turn holds is freed by that tab's next turn and by no other's.
    const scope = opaqueId('codextab');
    const boundConversation = (): BoundConversation | null => conversation;
    // Read late: the surface installs its callbacks on the runtime after this
    // constructs, so a presenter that captured them now would capture nothing.
    const presenter = this.createInteractionPresenter(() => adapter?.interactionCallbacks() ?? {});
    const content = new CodexContentPresenter(() => ProviderSettingsCoordinator
      .getProviderSettingsSnapshot(this.plugin.settings, 'codex').permissionMode === 'plan');

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => encodeCodexTurn(request),
      encodeRequestRef: (
        turn: PreparedChatTurn,
        history?: ChatMessage[],
        options?: ChatRuntimeQueryOptions,
      ) => this.requests.reference({
        ...turnRequest(turn, options),
        conversation: boundConversation,
        scope,
        ...(history ? { history } : {}),
      }),
      // Steering carries the input and nothing else: the turn it joins was
      // launched with the parameters, and it is not being started again.
      encodeSteerRef: (turn: PreparedChatTurn) => this.requests.reference({
        ...turnRequest(turn),
        conversation: boundConversation,
        scope,
      }),
      reasoningControl: CODEX_PROVIDER_CAPABILITIES.reasoningControl,
      // The thread this conversation is bound to, which is what the legacy
      // runtime reported and what the history patch writes back.
      currentSessionId: () => {
        const binding = readCodexConversationBinding(conversation);
        return binding.kind === 'thread' ? binding.threadId : null;
      },
      syncConversation: next => {
        conversation = next;
      },
      interactionPresenter: presenter,
      // One per tab, because the router it runs tracks a turn's items across
      // notifications and two tabs are two turns.
      presentProviderContent: payload => content.present(payload),
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
      ?? codexProviderModule.features(createCodexModuleContext(this.plugin, boundConversation));

    adapter = new ExecutionChatRuntimeAdapter<CodexProviderSettings>(
      {
        registry: this.registry,
        backendId: codexProviderModule.execution.descriptor.backendId,
        capabilities: codexProviderModule.capabilities,
        // Minted per runtime because the construction call site has no
        // conversation to bind one to; it moves to the catalog at M3.
        owner: { kind: 'conversation', ownerId: scope },
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      workspace ?? this.workspaceSlots,
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
  ): CodexInteractionPresenter {
    const presenter = new CodexInteractionPresenter(this.interactions, callbacks);
    this.presenters.add(presenter);
    const unsubscribe = this.interactions.onSettled(ref => presenter.dismiss(ref));
    this.disposers.push(() => {
      unsubscribe();
      this.presenters.delete(presenter);
    });
    return presenter;
  }

  /**
   * The workspace slots every tab shares, initialized once.
   *
   * None of them depend on a conversation — commands, models, usage, the CLI,
   * the settings tab — so they are built for the plugin rather than per tab,
   * which is also the only way a synchronous `createRuntime` can have them.
   */
  async initializeWorkspace(): Promise<void> {
    this.workspaceSlots = await codexProviderModule.workspace.initialize(
      createCodexModuleContext(this.plugin, () => null),
      // Nothing here awaits anything cancellable; the signal exists so a
      // provider whose workspace does can honour an unload that overtakes it.
      new AbortController().signal,
    );
  }

  /** The store every tab runtime references its turns through. */
  get turnRequests(): CodexExecutionRequests {
    return this.requests;
  }

  /** Releases the scratch directories and takes down whatever is on screen. */
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
    this.skills.invalidate();
  }

  private createConnectionFactory(): CodexExecutionConnectionFactory {
    return new NodeCodexExecutionConnectionFactory({ activeLaunchSpec: this.activeLaunchSpec });
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
