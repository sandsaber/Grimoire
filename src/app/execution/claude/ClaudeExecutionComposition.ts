import { randomUUID } from 'node:crypto';

import { type Options,query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

import { interactionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { PermissionMode } from '@/core/types/settings';
import type GrimoirePlugin from '@/main';
import { getClaudeWorkspaceServices } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { ClaudeAuxiliaryQuery } from '@/providers/claude/execution/ClaudeAuxiliaryQuery';
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
import { ClaudeProjectionResultSink } from '@/providers/claude/execution/ClaudeProjectionResultSink';
import {
  ClaudeSdkExecutionQueryFactory,
  type ClaudeSdkQueryFunction,
} from '@/providers/claude/execution/ClaudeSdkExecutionAdapter';
import { ClaudeTaskOutputLoader } from '@/providers/claude/execution/ClaudeTaskOutputLoader';
import { createStopSubagentHook } from '@/providers/claude/hooks/SubagentHooks';
import { QueryOptionsBuilder } from '@/providers/claude/runtime/ClaudeQueryOptionsBuilder';
import { getEnhancedPath,parseEnvironmentVariables } from '@/utils/env';
import { getVaultPath } from '@/utils/path';

/** What an auxiliary answer may be, before it is refused as too large. */
const AUXILIARY_RESULT_BYTE_LIMIT = 64_000;

/**
 * Claude chat execution, assembled from the running plugin.
 *
 * **Dark.** Nothing constructs this yet: `registration.ts` still points
 * `createRuntime` at `ClaudeChatRuntime`, and the flip is the checkpoint after
 * this one. What is built here is the half that has to exist before a flip can
 * be attempted at all — the store behind the kernel's request references, the
 * SDK options behind its startup references, and the backend over both.
 *
 * Three things are deliberately **not** here, each because it is its own
 * increment and each named so a flip cannot land while it is missing:
 *
 * - **the runtime half.** `createRuntime` needs the provider module's feature
 *   context — history hydration, rewind, task-result interpretation — which is
 *   the tab-facing surface rather than the execution one;
 * - **the content surface.** The backend emits `output-delta` and nothing else,
 *   because it was harvested before `provider-content` existed. Until it
 *   carries tool calls, plans and results the way wave 2's does, a flipped tab
 *   would render text and nothing around it — and the native session id, which
 *   the SDK announces in a message the tab never sees, would never reach the
 *   conversation that has to resume with it;
 * - **the surface that shows an interaction.** The bridge turns Claude's
 *   permission requests into interactions the kernel can carry, and answers the
 *   two that are policy rather than questions; what is missing is the presenter
 *   that puts one on screen and hands back what the user chose, which belongs
 *   to the tab and therefore to the runtime half.
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
    };
    return new ClaudeExecutionBackend(context);
  }

  /** Drops every reference held for turns that will never dispatch. */
  dispose(): void {
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
      // The one hook the legacy runtime installs, and it is about subagents
      // rather than settings: a stop that arrives while a subagent is running
      // must not end the turn under it. Answered as "nothing running" until the
      // runtime half can say otherwise, which is the increment that owns it.
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
