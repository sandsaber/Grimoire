import { randomUUID } from 'node:crypto';

import { delayThroughWindow } from '@/app/execution/hostTimers';
import { ProviderWorkspaceHolder } from '@/app/execution/ProviderWorkspaceHolder';
import type { RunTerminalReason } from '@/core/execution/ExecutionContracts';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import type { ProviderWorkspaceSlots } from '@/core/providers/ProviderModule';
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
import { t } from '@/i18n/i18n';
import type GrimoirePlugin from '@/main';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { createAntigravityModuleContext } from '@/providers/antigravity/app/AntigravityModuleContext';
import {
  AntigravityExecutionBackend,
  type AntigravityExecutionBackendContext,
  type AntigravityInvocation,
  type AntigravityProcessRunner,
} from '@/providers/antigravity/execution/AntigravityExecutionBackend';
import { AntigravityProjectionResultSink } from '@/providers/antigravity/execution/AntigravityProjectionResultSink';
import {
  type AntigravityRequest,
  AntigravityRequestStore,
} from '@/providers/antigravity/execution/AntigravityRequestStore';
import { NodeAntigravityProcessTransport } from '@/providers/antigravity/execution/NodeAntigravityProcessTransport';
import { decodeAntigravityModelId } from '@/providers/antigravity/models';
import { probeAntigravityCliCapabilities } from '@/providers/antigravity/runtime/AntigravityCliCapabilities';
import { AntigravityPrintProcessRunner } from '@/providers/antigravity/runtime/AntigravityPrintProcessRunner';
import {
  buildAntigravityPrintPrompt,
  buildAntigravityPromptText,
} from '@/providers/antigravity/runtime/AntigravityPromptComposer';
import { buildAntigravityRuntimeEnv } from '@/providers/antigravity/runtime/AntigravityRuntimeEnvironment';
import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import { getVaultPath } from '@/utils/path';

/** Combined stdout, stderr, and recovered-transcript ceiling for one run. */
const OUTPUT_BYTE_LIMIT = 64_000;

/**
 * Antigravity chat execution, assembled from the running plugin.
 *
 * One object per plugin load, holding the one thing the backend and the tab
 * runtimes must agree on: the store behind the kernel's request references. The
 * runtime puts a request in and the backend takes it out, and neither can be
 * given its own copy — a reference minted against one store and resolved
 * against another resolves to nothing.
 *
 * It lives in `src/app/` because the backend takes no plugin, no process
 * module, and no vault: it is a strict module by the composition gate, and
 * everything ambient reaches it as a port constructed here.
 */
export class AntigravityExecution {
  private readonly requests = new AntigravityRequestStore(() => opaqueId('agyreq'));

  /**
   * This provider's workspace slots, built on the first question.
   *
   * No runtime ports to refuse: print mode binds to no conversation, so the
   * whole context is the workspace half.
   */
  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    antigravityProviderModule.workspace,
    () => createAntigravityModuleContext(this.plugin),
  );

  constructor(
    private readonly plugin: GrimoirePlugin,
    private readonly registry: ExecutionLifecycleRegistry,
  ) {}

  /**
   * The backend, over the OS by default.
   *
   * The runner is a parameter because it is the seam between provider protocol
   * and process ownership, and a test that has to launch `agy` to check how a
   * turn is composed is testing the wrong thing.
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


  /**
   * Releases the workspace, which is all this composition holds.
   *
   * It had no `dispose` at all until it had a workspace: print mode keeps no
   * session, no daemon and no scratch, so there was nothing to release and the
   * application never called one. A lazily built workspace is still a
   * workspace, and the contract's `dispose` half is mandatory for that reason.
   */
  async dispose(): Promise<void> {
    await this.workspaceHolder.dispose();
  }

  createBackend(
    processRunner: AntigravityProcessRunner = this.createProcessRunner(),
  ): AntigravityExecutionBackend {
    const context: AntigravityExecutionBackendContext = {
      requestResolver: {
        resolve: async requestRef => this.resolveInvocation(requestRef),
      },
      processRunner,
      resultSink: new AntigravityProjectionResultSink(),
      scheduler: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
    };
    return new AntigravityExecutionBackend(context);
  }

  private createProcessRunner(): AntigravityProcessRunner {
    return new AntigravityPrintProcessRunner({
      transport: new NodeAntigravityProcessTransport(),
      outputByteLimit: OUTPUT_BYTE_LIMIT,
    });
  }

  /**
   * The Antigravity chat runtime, over the kernel.
   *
   * One per tab, not one per provider.
   * Print mode has no resume and keeps nothing per conversation, so the only
   * thing the binding below is for is naming the owner of what a turn records.
   */
  createRuntime(): ExecutionChatRuntimeAdapter {
    const plugin = this.plugin;
    // Minted once, and only used while no conversation is bound: a fallback
    // minted per read would give one tab's session and its runs different
    // owners, which the registry refuses.
    const agyTab = opaqueId('agytab');

    // Print mode keeps nothing per conversation; this is here so the records a
    // turn writes name the chat that owns them, which is what deleting that
    // chat then finds them by (D4).
    let conversation: BoundConversation | null = null;
    const ports: ExecutionChatRuntimeHostPorts = {
      syncConversation: next => { conversation = next; },
      prepareTurn: (request: ChatTurnRequest) => {
        const prompt = buildAntigravityPromptText(request);
        return {
          isCompact: false,
          mcpMentions: request.enabledMcpServers ?? new Set<string>(),
          persistedContent: prompt,
          prompt,
          request,
        };
      },
      encodeRequestRef: (turn, history?: ChatMessage[], options?: ChatRuntimeQueryOptions) => (
        this.requests.reference(buildAntigravityRequest(plugin, turn, history, options))
      ),
      // Print mode has no provider-native session, which is what the legacy
      // runtime reported too — it returned null and wrote `sessionId: null`.
      currentSessionId: () => null,
      delay: delayThroughWindow,
      reportCleanupFailure: error => {
        plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'antigravity',
        });
      },
      describeFailure: reason => describeAntigravityFailure(plugin, reason),
    };
    return new ExecutionChatRuntimeAdapter(
      {
        registry: this.registry,
        backendId: antigravityProviderModule.execution.descriptor.backendId,
        capabilities: antigravityProviderModule.capabilities,
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
          : { kind: 'internal-service', ownerId: agyTab }),
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      antigravityProviderModule.runtimePorts({
        listModels: async () => [],
        refreshModels: async () => [],
        // Stubbed like the two above: this context is passed for the runtime
        // ports, which never draw a settings tab. The workspace holder builds
        // the real one.
        renderSettingsTab: () => undefined,
      }),
    );
  }

  /**
   * Turns a request reference back into a launchable invocation.
   *
   * Everything ambient is read here rather than held with the request: a turn
   * queued before a settings change must launch the CLI the user has configured
   * now, not the one configured when they pressed send.
   */
  private async resolveInvocation(requestRef: string): Promise<AntigravityInvocation> {
    const request = this.requests.resolve(requestRef);
    const plugin = this.plugin;
    if (!getAntigravityProviderSettings(plugin.settings).enabled) {
      throw new Error('Antigravity is disabled.');
    }
    const command = plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
    const environment = buildAntigravityRuntimeEnv(plugin.settings, command);
    const vaultPath = getVaultPath(plugin.app);
    // Probed here, with the rest of what a launch reads at dispatch time. The
    // runner cannot: it hands back a handle synchronously, and a probe is a
    // process. Cached per CLI command by the prober, and fail-closed for a
    // launch it could not read — an older `agy` fails on a flag it does not
    // know, so an unread probe has to mean "send nothing extra".
    const cliCapabilities = await probeAntigravityCliCapabilities(command, environment);
    plugin.recordDebugLog?.({
      data: {
        addDir: cliCapabilities.addDir,
        printTimeout: cliCapabilities.printTimeout,
        providerId: 'antigravity',
        streamJson: cliCapabilities.streamJson,
      },
      event: 'antigravity.capabilities.probed',
      level: 'debug',
      scope: 'provider.antigravity',
    });
    return {
      command,
      cliCapabilities,
      cwd: vaultPath ?? process.cwd(),
      ...(vaultPath ? { addDirPath: vaultPath } : {}),
      environment,
      model: request.model,
      // Reported as configured, not normalized: the backend is where fail-closed
      // lives, because `agy --print` exposes no approval hook and anything short
      // of full access must be refused before a process exists.
      permissionMode: antigravityPermissionMode(plugin),
      prompt: request.prompt,
    };
  }
}

/**
 * Antigravity's wording for the failures it can explain.
 *
 * The kernel's neutral sentence for `pre-dispatch-rejected` cannot name the
 * setting that caused it, and that terminal is what a user meets on their first
 * turn: the shipped permission mode is `normal` and `agy --print` cannot request
 * approvals.
 *
 * The cause is not carried on the terminal, so it is re-read from the same
 * settings the resolver read. Where neither reachable cause holds — an
 * unresolvable request reference, a defect rather than a user situation — this
 * returns nothing and the neutral sentence stands.
 */
export function describeAntigravityFailure(
  plugin: GrimoirePlugin,
  reason: RunTerminalReason,
): string | undefined {
  if (reason === 'missing-required-result') {
    return t('chat.ui.errors.provider.antigravityEmptyOutput');
  }
  if (reason !== 'pre-dispatch-rejected') {
    return undefined;
  }
  if (!getAntigravityProviderSettings(plugin.settings).enabled) {
    return t('chat.ui.errors.provider.antigravityDisabled');
  }
  if (antigravityPermissionMode(plugin) !== 'full_access') {
    return t('chat.ui.errors.provider.antigravitySafeModeUnavailable');
  }
  return undefined;
}

/**
 * The permission mode **this** provider was given.
 *
 * Not `settings.permissionMode`, which is the projection of whichever provider
 * the settings tab is showing. The toolbar toggle writes into
 * `savedProviderPermissionMode[providerId]` and only copies to the top level
 * when those two happen to coincide, so reading the top level reads another
 * provider's mode — observed in a real vault as Antigravity refusing every turn
 * while its own toggle read Auto-approve. This is the same projection the tab
 * UI renders the toggle from, so what the user sees is what the run gets.
 */
function antigravityPermissionMode(plugin: GrimoirePlugin): string {
  const projected = ProviderSettingsCoordinator
    .getProviderSettingsSnapshot(plugin.settings, 'antigravity')
    .permissionMode;
  return typeof projected === 'string' && projected ? projected : 'normal';
}

/** What one turn decides, before it becomes an opaque reference. */
export function buildAntigravityRequest(
  plugin: GrimoirePlugin,
  turn: PreparedChatTurn,
  history?: ChatMessage[],
  options?: ChatRuntimeQueryOptions,
): AntigravityRequest {
  return {
    prompt: buildAntigravityPrintPrompt(turn.prompt, history),
    model: selectedModel(plugin, options),
  };
}

function selectedModel(
  plugin: GrimoirePlugin,
  queryOptions?: ChatRuntimeQueryOptions,
): string | null {
  if (typeof queryOptions?.model === 'string') {
    const selected = decodeAntigravityModelId(queryOptions.model);
    if (selected) {
      return selected;
    }
  }
  const saved = plugin.settings.savedProviderModel;
  const savedAntigravity = saved && typeof saved === 'object' && !Array.isArray(saved)
    ? (saved as Record<string, unknown>).antigravity
    : null;
  if (typeof savedAntigravity === 'string') {
    return decodeAntigravityModelId(savedAntigravity);
  }
  return getAntigravityProviderSettings(plugin.settings).visibleModels[0] ?? null;
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
