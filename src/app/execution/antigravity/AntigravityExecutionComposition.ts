import { randomUUID } from 'node:crypto';

import { NodeAntigravityProcessTransport } from '@/app/execution/antigravity/NodeAntigravityProcessTransport';
import type { RunTerminalReason } from '@/core/execution/ExecutionContracts';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import {
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
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/capabilities';
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
import { decodeAntigravityModelId } from '@/providers/antigravity/models';
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
   * One per tab, matching how `ProviderRegistry` constructs runtimes today. The
   * owner is minted per runtime rather than taken from a conversation because
   * the construction call site has none to give — it moves to the catalog at
   * M3, which is the checkpoint that can bind one. Print mode has no resume, so
   * nothing outlives the tab that would need the stronger binding.
   */
  createRuntime(): ChatRuntime {
    const plugin = this.plugin;
    const ports: ExecutionChatRuntimeHostPorts = {
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
      reasoningControl: ANTIGRAVITY_PROVIDER_CAPABILITIES.reasoningControl,
      // Print mode has no provider-native session, which is what the legacy
      // runtime reported too — it returned null and wrote `sessionId: null`.
      currentSessionId: () => null,
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
        owner: { kind: 'conversation', ownerId: opaqueId('agytab') },
        nextExecutionSessionId: () => executionSessionId(opaqueId('es')),
        nextRunId: () => runId(opaqueId('run')),
      },
      ports,
      antigravityProviderModule.features({
        resolveCliPath: async () => plugin.getResolvedProviderCliPath('antigravity'),
        listModels: async () => [],
        refreshModels: async () => [],
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
    return {
      command,
      cwd: getVaultPath(plugin.app) ?? process.cwd(),
      environment: buildAntigravityRuntimeEnv(plugin.settings, command),
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
