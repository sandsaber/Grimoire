import { randomUUID } from 'node:crypto';

import { type Options,query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

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
import type { ProviderFeatureContributions } from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import {
  type BoundConversation,
  ExecutionChatRuntimeAdapter,
  type ExecutionChatRuntimeHostPorts,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatTurnRequest, PreparedChatTurn } from '@/core/runtime/types';
import type { PermissionMode } from '@/core/types/settings';
import type GrimoirePlugin from '@/main';
import { createClaudeModuleContext } from '@/providers/claude/app/ClaudeModuleContext';
import { claudePlanUsageStore } from '@/providers/claude/app/ClaudePlanUsageStore';
import { getClaudeWorkspaceServices } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { CLAUDE_PROVIDER_CAPABILITIES } from '@/providers/claude/capabilities';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { ClaudeAuxiliaryQuery } from '@/providers/claude/execution/ClaudeAuxiliaryQuery';
import { ClaudeContentPresenter } from '@/providers/claude/execution/ClaudeContentPresenter';
import type { ClaudeSessionIntent } from '@/providers/claude/execution/ClaudeExecutionBackend';
import {
  ClaudeExecutionBackend,
  type ClaudeExecutionBackendContext,
  type ClaudeExecutionQueryFactory,
  type ClaudeExecutionReconciler,
} from '@/providers/claude/execution/ClaudeExecutionBackend';
import {
  ClaudeExecutionRequests,
  type ClaudeInvocationEnvironment,
} from '@/providers/claude/execution/ClaudeExecutionRequests';
import { ClaudeInteractionBridge } from '@/providers/claude/execution/ClaudeInteractionBridge';
import { ClaudeInteractionPresenter } from '@/providers/claude/execution/ClaudeInteractionPresenter';
import { ClaudeProjectionResultSink } from '@/providers/claude/execution/ClaudeProjectionResultSink';
import {
  ClaudeSdkExecutionQueryFactory,
  type ClaudeSdkQueryFunction,
} from '@/providers/claude/execution/ClaudeSdkExecutionAdapter';
import { ClaudeTaskOutputLoader } from '@/providers/claude/execution/ClaudeTaskOutputLoader';
import { createStopSubagentHook } from '@/providers/claude/hooks/SubagentHooks';
import { encodeClaudeTurn } from '@/providers/claude/prompt/ClaudeTurnEncoder';
import { QueryOptionsBuilder } from '@/providers/claude/runtime/ClaudeQueryOptionsBuilder';
import { createClaudeRewindBackup } from '@/providers/claude/runtime/ClaudeRewindService';
import type { ClaudeProviderSettings } from '@/providers/claude/settings';
import { getClaudeState } from '@/providers/claude/types/providerState';
import { getEnhancedPath,parseEnvironmentVariables } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

import { delayThroughWindow } from '../hostTimers';

/** What an auxiliary answer may be, before it is refused as too large. */
const AUXILIARY_RESULT_BYTE_LIMIT = 64_000;

/**
 * Claude chat execution, assembled from the running plugin.
 *
 * One object per plugin load, holding what the backend and every tab runtime
 * must agree on: the store behind the kernel's request references and the SDK
 * options behind its startup references, and the bridge that turns a permission
 * request into something a tab can show. None of these can be handed out as
 * copies — a reference minted against one store resolves to nothing in another.
 *
 * It lives in `src/app/` because the backend takes no plugin and no vault: it
 * is a strict module by the composition gate, and everything ambient reaches it
 * as a port constructed here.
 *
 * Still legacy beside it, until their own checkpoints: Claude's **workspace**
 * services — commands, agents, MCP, models, the settings tab — are registered
 * the old way, and its **auxiliary** services (titles, refinement, inline
 * edits) run on their own cold-start queries. Those are M5's, and a session or
 * process conflict between them and this path is a stop condition.
 */
export class ClaudeExecution {
  private readonly requests = new ClaudeExecutionRequests(
    () => opaqueId('claudereq'),
    () => this.environment(),
  );

  /**
   * One bridge per plugin load, and it holds what the kernel must not.
   *
   * A control record carries an opaque reference to a presentation; the
   * presentation itself — the command, the questions, the plan — stays here,
   * and the surface reads it back by that reference. Shared across tabs for the
   * same reason the request store is: a reference minted against one is
   * unresolvable in another.
   */
  private readonly presenters = new Set<ClaudeInteractionPresenter>();
  private readonly disposers: Array<() => void> = [];
  private backend: ClaudeExecutionBackend | undefined;

  private readonly interactions = new ClaudeInteractionBridge({
    // The mode *this* provider was given, not `settings.permissionMode`, which
    // is the projection of whichever provider the settings tab is showing —
    // the defect wave 1 found in a real vault, where Antigravity refused every
    // turn while its own toggle read Auto-approve.
    permissionMode: () => ProviderSettingsCoordinator
      .getProviderSettingsSnapshot(this.plugin.settings, 'claude')
      .permissionMode,
    resolveSdkPermissionMode: (mode: PermissionMode) => (
      QueryOptionsBuilder.resolveClaudeSdkPermissionMode(mode)
    ),
  });

  constructor(
    private readonly plugin: GrimoirePlugin,
    private readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /** The store every tab runtime will reference its turns through. */
  get turnRequests(): ClaudeExecutionRequests {
    return this.requests;
  }

  /** The registry this composition's backend is registered with. */
  get lifecycleRegistry(): ExecutionLifecycleRegistry {
    return this.registry;
  }

  /**
   * The backend, over the official SDK by default.
   *
   * The SDK's own `query` is a parameter because it is the seam between
   * provider protocol and the process: a test that has to start `claude` to
   * check how a turn is composed is testing the wrong thing. Everything above
   * it — the startup reference, the options built from live settings, the store
   * the request came from — is the real path.
   */
  createBackend(
    queryFunction: ClaudeSdkQueryFunction = agentQuery,
  ): ClaudeExecutionBackend {
    const queryFactory: ClaudeExecutionQueryFactory = this.createQueryFactory(queryFunction);
    const context: ClaudeExecutionBackendContext = {
      queryFactory,
      requestResolver: this.requests,
      interactionBridge: this.interactions,
      resultSink: new ClaudeProjectionResultSink(),
      taskResultLoader: new ClaudeTaskOutputLoader(),
      reconciler: unknownReconciler(),
      auxiliaryQueries: new ClaudeAuxiliaryQuery(
        {
          // Auxiliary work — titles, refinement, inline edits — still runs on
          // the legacy services until M5, and this composition has no reference
          // space of its own for it yet. Refused rather than answered emptily:
          // an auxiliary turn that silently returns nothing is the failure mode
          // this migration exists to remove.
          resolve: async () => {
            throw new Error('Claude auxiliary execution is not wired to the kernel yet.');
          },
        },
        AUXILIARY_RESULT_BYTE_LIMIT,
        agentQuery,
        this.scheduler(),
      ),
      scheduler: this.scheduler(),
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      interactionIdFactory: () => interactionId(opaqueId('ix')),
      // The safety net the legacy runtime wrapped its rewind in: a copy of what
      // the preview says is about to change, restored if the apply fails. The
      // backend cannot take one itself — it has no vault — so it reaches the
      // same helper through here.
      rewindBackup: {
        create: filesChanged => createClaudeRewindBackup(
          filesChanged ? [...filesChanged] : undefined,
          getVaultPath(this.plugin.app),
        ),
      },
    };
    this.backend = new ClaudeExecutionBackend(context);
    return this.backend;
  }

  /**
   * The backend as the kernel registers it, with its two side ports.
   *
   * `interactions` is not optional dressing: the registry refuses to resolve an
   * interaction for a backend that declared no resolution port, so a
   * registration without it opens approvals nobody can answer — the SDK waits
   * on a permission for ever and the turn never ends. Found exactly that way,
   * by a turn that hung on its first tool.
   */
  createBackendRegistration(queryFunction?: ClaudeSdkQueryFunction): BackendLifecycleRegistration {
    const backend = queryFunction ? this.createBackend(queryFunction) : this.createBackend();
    return { backend, interactions: backend, recovery: backend };
  }


  /**
   * The Claude chat runtime, over the kernel.
   *
   * One per tab, matching how `ProviderRegistry` constructs runtimes today. Two
   * things are built per tab rather than shared: the content presenter, because
   * it tracks a turn's streamed text and the session the tab is on, and the
   * interaction presenter, because a prompt belongs to the tab that raised it.
   */
  createRuntime(): ChatRuntime {
    let conversation: BoundConversation | null = null;
    let adapter: ClaudeRuntimeAdapter | undefined;
    let currentExecutionSession: string | null = null;
    const boundConversation = (): BoundConversation | null => conversation;
    const scope = opaqueId('claudetab');
    const content = new ClaudeContentPresenter({
      settings: () => {
        const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          'claude',
        );
        const model = typeof settings.model === 'string' ? settings.model : undefined;
        return {
          ...(model ? { intendedModel: model } : {}),
          ...(isRecord(settings.customContextLimits)
            ? { customContextLimits: settings.customContextLimits }
            : {}),
        };
      },
      // What the turn cost, and what the plan has left. Both are in the SDK's
      // own messages and in nothing else the surface reads, so a path that
      // renders chunks and drops the message leaves the indicator empty.
      onUsageMessage: message => {
        if (claudePlanUsageStore.recordSdkMessage(message)) {
          this.refreshSelectors();
        }
      },
      // The SDK approves `EnterPlanMode` itself, so this tool call in the
      // stream is the only sign the turn began planning.
      onPlanModeEntered: () => {
        const sync = adapter?.interactionCallbacks().permissionModeSync;
        if (typeof sync === 'function') {
          (sync as (mode: string) => void)('plan');
        }
      },
    });
    // Read late: the surface installs its callbacks on the runtime after this
    // constructs, so a presenter that captured them now would capture nothing.
    const presenter = new ClaudeInteractionPresenter(
      this.interactions,
      () => adapter?.interactionCallbacks() ?? {},
    );
    this.presenters.add(presenter);
    this.disposers.push(this.interactions.onSettled(ref => presenter.dismiss(ref)));

    const ports: ExecutionChatRuntimeHostPorts = {
      prepareTurn: (request: ChatTurnRequest) => encodeClaudeTurn(
        request,
        getClaudeWorkspaceServices().mcpManager,
      ),
      encodeRequestRef: (turn: PreparedChatTurn) => {
        // The turn boundary, and the one place a turn is known to be starting.
        // Without it `sawStreamText` and `sawStreamThinking` stayed true for the
        // life of a conversation, so a later turn whose assistant message
        // arrives with no deltas of its own rendered nothing — the presenter's
        // "a turn that streamed nothing still renders" path never ran again
        // after the first turn that did stream. Grok and OpenCode do this here.
        content.beginTurn();
        return this.requests.reference({
        prompt: turn.prompt,
        ...(turn.request.images?.length ? { images: [...turn.request.images] } : {}),
        // Read at dispatch, not now: a turn queued before another one finishes
        // must resume the session that one created rather than the one this tab
        // was on when the user pressed send.
        session: () => claudeSessionIntent(boundConversation(), content.lastSessionId()),
        // Whether *this tab* has a subagent running, asked when the SDK wants
        // to stop. Read late for the same reason as the session: the surface
        // installs its provider after this runtime is built.
        subagentState: () => {
          const provider = adapter?.interactionCallbacks().subagentState;
          return typeof provider === 'function'
            ? (provider as () => { hasRunning: boolean })()
            : { hasRunning: false };
        },
        });
      },
      reasoningControl: CLAUDE_PROVIDER_CAPABILITIES.reasoningControl,
      // The session this conversation is on, which the kernel records and a
      // resume asks for. The presenter's copy comes first because a new
      // conversation learns its session mid-turn, and the record is written
      // only after that turn ends.
      currentSessionId: () => {
        const bound = boundConversation();
        const state = getClaudeState(bound?.providerState);
        return state.providerSessionId ?? bound?.sessionId ?? content.lastSessionId() ?? null;
      },
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          // A different conversation — or none — is a different session, and
          // the presenter's is only this one's while this one is bound to it.
          content.forgetConversation();
        }
        conversation = next;
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
          scope: 'claude',
        });
      },
    };

    // Built here, not passed in: the module's history contribution answers
    // about *this tab's* conversation, so the context has to close over the
    // same one the ports above sync.
    const contributions = claudeProviderModule.features(createClaudeModuleContext(
      this.plugin,
      boundConversation,
      {
        executionSessionId: () => currentExecutionSession,
        // The backend owns the SDK query a rewind restores files through, so
        // the module's slot reaches it rather than reimplementing the walk.
        rewind: async input => (
          this.backend?.rewind(input)
          ?? { canRewind: false, error: 'Claude execution is not running.' }
        ),
      },
    ));

    const runtime = new ClaudeRuntimeAdapter(
      {
        registry: this.registry,
        backendId: claudeProviderModule.execution.descriptor.backendId,
        capabilities: claudeProviderModule.capabilities,
        // The conversation the tab is showing, read when a session is
        // established: this is what a deleted conversation's control records
        // are found by (D4). The tab's own id stands in only while no
        // conversation is bound, which is a session that belongs to no chat.
        owner: () => ({ kind: 'conversation', ownerId: conversation?.id ?? scope }),
        // Captured on the way out: a rewind runs against the session this tab
        // is executing in, and the id is minted here rather than reported back.
        nextExecutionSessionId: () => {
          currentExecutionSession = opaqueId('es');
          return executionSessionId(currentExecutionSession);
        },
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      contributions,
      () => {
        // The tab closing is when the prompts it raised stop being anyone's.
        presenter.dismissAll();
        this.presenters.delete(presenter);
      },
    );
    adapter = runtime;
    return runtime;
  }

  /** Redraws the model and plan indicators of every open view. */
  private refreshSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
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

  private createQueryFactory(queryFunction: ClaudeSdkQueryFunction): ClaudeExecutionQueryFactory {
    return new ClaudeSdkExecutionQueryFactory({
      resolve: (startupRef: string, signal: AbortSignal): Promise<Options> => (
        this.requests.resolveStartupOptions(startupRef, signal)
      ),
    }, queryFunction);
  }

  private scheduler() {
    return {
      setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => window.clearTimeout(
        handle as ReturnType<typeof setTimeout>,
      ),
    };
  }

  /**
   * Everything a queued turn is started against, read now rather than when it
   * was queued.
   *
   * The same rule the other two compositions follow: a turn queued before a
   * settings change must start the SDK the user has configured now.
   */
  private async environment(): Promise<ClaudeInvocationEnvironment> {
    const workspace = getClaudeWorkspaceServices();
    const cliPath = this.plugin.getResolvedProviderCliPath('claude');
    if (!cliPath) {
      throw new Error('The Claude CLI could not be resolved.');
    }
    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      throw new Error('Claude execution requires a vault path.');
    }
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'claude',
    );
    const customEnv = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables('claude'),
    );
    return {
      context: {
        vaultPath,
        cliPath,
        settings,
        customEnv,
        enhancedPath: getEnhancedPath(customEnv.PATH, cliPath),
        mcpManager: workspace.mcpManager,
        pluginManager: workspace.pluginManager,
      },
      // The fallback for a turn that carries no answer of its own: every turn
      // a tab sends does, and it is the tab that knows whether a subagent is
      // running. A turn without one blocks nothing.
      hooks: { Stop: [createStopSubagentHook(() => ({ hasRunning: false }))] },
    };
  }
}

/**
 * What is known about a run this process did not see finish: nothing.
 *
 * The SDK's transcript could answer it — the reconciler's whole point is to
 * read that file — and until it does, the honest evidence is `unknown` with
 * effects possible, which is what makes the kernel refuse to re-dispatch.
 */
function unknownReconciler(): ClaudeExecutionReconciler {
  return { reconcile: async () => ({ kind: 'unknown', effectsPossible: true }) };
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}

/**
 * The adapter, typed for this provider's settings and told when its tab closes.
 *
 * The tab closing is the only lifecycle the adapter has no port for, and it is
 * when a prompt this tab raised stops being anyone's: leaving it open locks the
 * composer of a view that no longer exists.
 */
class ClaudeRuntimeAdapter extends ExecutionChatRuntimeAdapter<ClaudeProviderSettings> {
  constructor(
    context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[1],
    features: ProviderFeatureContributions<ClaudeProviderSettings>,
    private readonly releaseTab: () => void,
  ) {
    super(context, ports, features);
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
 * Where this tab's next turn continues from.
 *
 * A fork before its first turn has a source and no session of its own; a
 * conversation with a session resumes it; anything else is new. The presenter's
 * session is the last fallback and it matters: a new conversation learns its
 * session mid-turn, and the record that would carry it is written only after
 * that turn ends — so without it every second turn would start again.
 */
function claudeSessionIntent(
  bound: BoundConversation | null,
  observedSessionId: string | undefined,
): ClaudeSessionIntent {
  const state = getClaudeState(bound?.providerState);
  if (state.forkSource && !state.providerSessionId && !bound?.sessionId) {
    return {
      kind: 'fork',
      sourceSessionId: state.forkSource.sessionId,
      resumeAt: state.forkSource.resumeAt,
    };
  }
  const sessionId = state.providerSessionId ?? bound?.sessionId ?? observedSessionId;
  return sessionId ? { kind: 'resume', sessionId } : { kind: 'new' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
