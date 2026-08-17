import { randomUUID } from 'node:crypto';

import { NodeAntigravityProcessTransport } from '@/app/execution/antigravity/NodeAntigravityProcessTransport';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
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
import type GrimoirePlugin from '@/main';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/capabilities';
import {
  AntigravityExecutionBackend,
  type AntigravityExecutionBackendContext,
  type AntigravityInvocation,
  type AntigravityRequestResolver,
} from '@/providers/antigravity/execution/AntigravityExecutionBackend';
import { AntigravityProjectionResultSink } from '@/providers/antigravity/execution/AntigravityProjectionResultSink';
import {
  type AntigravityRequest,
  decodeAntigravityRequestRef,
  encodeAntigravityRequestRef,
} from '@/providers/antigravity/execution/AntigravityRequestCodec';
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
 * Assembles the Antigravity execution backend from the running plugin.
 *
 * The backend itself takes no plugin, no process module, and no vault: it is a
 * strict module by the composition gate, and everything ambient reaches it as
 * a port constructed here. That is the whole reason this file is in `src/app/`.
 */
export function createAntigravityExecutionBackend(
  plugin: GrimoirePlugin,
): AntigravityExecutionBackend {
  const context: AntigravityExecutionBackendContext = {
    requestResolver: createAntigravityRequestResolver(plugin),
    processRunner: new AntigravityPrintProcessRunner({
      transport: new NodeAntigravityProcessTransport(),
      outputByteLimit: OUTPUT_BYTE_LIMIT,
    }),
    resultSink: new AntigravityProjectionResultSink(),
    scheduler: {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
  };
  return new AntigravityExecutionBackend(context);
}

/**
 * The Antigravity chat runtime, over the kernel.
 *
 * One per tab, matching how `ProviderRegistry` constructs runtimes today. The
 * owner is minted per runtime rather than taken from a conversation because
 * the construction call site has none to give — it moves to the catalog at M3,
 * which is the checkpoint that can bind a conversation. Print mode has no
 * resume, so nothing outlives the tab that would need the stronger binding.
 */
export function createAntigravityChatRuntime(
  plugin: GrimoirePlugin,
  registry: ExecutionLifecycleRegistry,
): ChatRuntime {
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
      encodeAntigravityRequestRef(buildAntigravityRequest(plugin, turn, history, options))
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
  };
  return new ExecutionChatRuntimeAdapter(
    {
      registry,
      backendId: antigravityProviderModule.execution.descriptor.backendId,
      capabilities: antigravityProviderModule.capabilities,
      owner: { kind: 'conversation', ownerId: `antigravity-${opaqueId('tab')}` },
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
 * Everything ambient is read here rather than frozen into the reference: a turn
 * queued before a settings change must launch the CLI the user has configured
 * now, not the one configured when they pressed send.
 */
export function createAntigravityRequestResolver(
  plugin: GrimoirePlugin,
): AntigravityRequestResolver {
  return { resolve: requestRef => resolveInvocation(plugin, requestRef) };
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

async function resolveInvocation(
  plugin: GrimoirePlugin,
  requestRef: string,
): Promise<AntigravityInvocation> {
  const request = decodeAntigravityRequestRef(requestRef);
  const settings = getAntigravityProviderSettings(plugin.settings);
  if (!settings.enabled) {
    throw new Error('Antigravity is disabled.');
  }
  const command = plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
  return {
    command,
    cwd: getVaultPath(plugin.app) ?? process.cwd(),
    environment: buildAntigravityRuntimeEnv(plugin.settings, command),
    model: request.model,
    // Fail-closed, as the provider's instructions require: `agy --print`
    // exposes no approval hook, so any mode short of full access is refused
    // before dispatch rather than launched unsupervised.
    permissionMode: typeof plugin.settings.permissionMode === 'string'
      ? plugin.settings.permissionMode
      : 'normal',
    prompt: request.prompt,
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
