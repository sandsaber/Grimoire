import { randomUUID } from 'node:crypto';

import { delayThroughWindow } from '@/app/execution/hostTimers';
import { ProviderWorkspaceHolder } from '@/app/execution/ProviderWorkspaceHolder';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type GrimoirePlugin from '@/main';
import type { ProviderSettingsTabRenderer } from '@/providers/shared/providerHostContracts';
import { createWorkspaceContextSlots } from '@/providers/shared/workspaceContextSlots';
import { getVaultPath } from '@/utils/path';

import { commandcodeProviderModule } from '../CommandcodeProviderModule';
import { type CommandcodeInvocation, type CommandcodeProcessRunner, NodeCommandcodeProcessRunner } from '../runtime/CommandcodeProcess';
import { buildCommandcodePrompt } from '../runtime/CommandcodePrompt';
import { commandcodeEnvironment, decodeCommandcodeModel, getCommandcodeSettings, resolveCommandcodeCli } from '../settings';
import { commandcodeChatUIConfig } from '../ui/CommandcodeChatUIConfig';
import { CommandcodeApprovalPresenter, CommandcodeApprovals } from './CommandcodeApprovals';
import { CommandcodeContentPresenter } from './CommandcodeContentPresenter';
import { CommandcodeExecutionBackend } from './CommandcodeExecutionBackend';

export class CommandcodeExecution {
  private readonly approvals = new CommandcodeApprovals();
  private readonly requests = new Map<string, { prompt: string; model?: string; effort?: string; sessionId?: string; mode: string }>();
  private readonly workspaceHolder = new ProviderWorkspaceHolder(commandcodeProviderModule.workspace, () => {
    const services = () => this.plugin.getApplicationRuntimeOrNull()?.workspaceServicesFor('commandcode') ?? null;
    const slots = createWorkspaceContextSlots({ plugin: this.plugin, providerId: 'commandcode',
      chatUI: commandcodeChatUIConfig, services });
    return {
      models: { list: () => slots.listModels(), refresh: options => slots.refreshModels(options) },
      usage: { cached: () => slots.cachedPlanUsage(), refresh: () => slots.refreshPlanUsage() },
      transcripts: { hydrate: async () => ({ outcome: 'absent' as const }), deleteSession: async () => undefined },
      settingsPresentation: { render: (host: unknown) => {
        const input = host as { container: HTMLElement; context: Parameters<ProviderSettingsTabRenderer['render']>[1] };
        services()?.settingsTabRenderer?.render(input.container, input.context);
      } },
    };
  });

  constructor(private readonly plugin: GrimoirePlugin, private readonly registry: ExecutionLifecycleRegistry) {}

  workspace() { return this.workspaceHolder.resolve(); }
  builtWorkspace() { return this.workspaceHolder.peek() ?? null; }
  async dispose() {
    this.requests.clear(); await this.workspaceHolder.dispose();
  }

  createBackend(runner: CommandcodeProcessRunner = new NodeCommandcodeProcessRunner()): CommandcodeExecutionBackend {
    return new CommandcodeExecutionBackend({
      resolve: async ref => this.resolveInvocation(ref), runner, approvals: this.approvals,
      sessionInstanceId: () => sessionInstanceId(opaqueId("si")), delay: delayThroughWindow,
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: timer => window.clearTimeout(timer as number),
    });
  }

  createRuntime(): ExecutionChatRuntimeAdapter {
    let runtime: ExecutionChatRuntimeAdapter;
    const approvals = new CommandcodeApprovalPresenter(this.approvals, () => runtime?.interactionCallbacks() ?? {});
    let conversation: BoundConversation | null = null;
    const tabId = randomUUID();
    const presenter = new CommandcodeContentPresenter(() => {
      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.plugin.settings, 'commandcode');
      return commandcodeChatUIConfig.getContextWindowSize(String(snapshot.model ?? 'commandcode'),
        this.plugin.settings.customContextLimits);
    });
    runtime = new ExecutionChatRuntimeAdapter({ registry: this.registry,
      backendId: commandcodeProviderModule.execution.descriptor.backendId,
      capabilities: commandcodeProviderModule.capabilities,
      owner: () => conversation?.id ? { kind: 'conversation', ownerId: conversation.id }
        : { kind: 'internal-service', ownerId: tabId },
      nextExecutionSessionId: () => executionSessionId(opaqueId("es")), nextRunId: () => runId(opaqueId("run")),
    }, {
      syncConversation: next => {
        if (next?.id !== conversation?.id) presenter.sessionId = undefined;
        conversation = next;
      },
      prepareTurn: request => {
        if (request.images?.length) throw new Error('Command Code image attachments are not supported.');
        const prompt = buildCommandcodePrompt(request);
        return { prompt, persistedContent: prompt, request, isCompact: false,
          mcpMentions: request.enabledMcpServers ?? new Set<string>() };
      },
      encodeRequestRef: (turn, _history, options) => {
        const ref = randomUUID();
        const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.plugin.settings, 'commandcode');
        const model = options?.model ?? settings.model;
        this.requests.set(ref, { prompt: turn.prompt,
          model: typeof model === 'string' ? decodeCommandcodeModel(model) : undefined,
          effort: typeof settings.effortLevel === 'string' && settings.effortLevel !== 'default' ? settings.effortLevel : undefined,
          sessionId: presenter.sessionId ?? conversation?.sessionId ?? undefined,
          mode: typeof settings.permissionMode === 'string' ? settings.permissionMode : 'normal' });
        return ref;
      },
      currentSessionId: () => presenter.sessionId ?? conversation?.sessionId ?? null,
      presentProviderContent: payload => presenter.present(payload), delay: delayThroughWindow,
      interactionPresenter: approvals,
      describeFailure: reason => reason === 'pre-dispatch-rejected' && !getCommandcodeSettings(this.plugin.settings).enabled
        ? 'Command Code is disabled. Enable it in Providers settings.' : undefined,
    }, commandcodeProviderModule.runtimePorts({
      resolveSessionId: id => id === conversation?.id ? presenter.sessionId ?? conversation.sessionId ?? null : null,
    }));
    return runtime;
  }

  private resolveInvocation(ref: string): CommandcodeInvocation {
    const request = this.requests.get(ref);
    this.requests.delete(ref);
    if (!request) throw new Error('Unknown Command Code request.');
    if (!getCommandcodeSettings(this.plugin.settings).enabled) throw new Error('Command Code is disabled.');
    const cwd = getVaultPath(this.plugin.app);
    if (!cwd) throw new Error('Command Code requires a local vault.');
    const command = resolveCommandcodeCli(this.plugin.settings) ?? 'command-code';
    if (request.effort && (!request.model
      || !getCommandcodeSettings(this.plugin.settings).reasoningEffortsByModel[request.model]?.includes(request.effort))) {
      throw new Error('The selected reasoning effort is unavailable for this Command Code model. Select the model again to refresh its options.');
    }
    return { command, cwd, environment: commandcodeEnvironment(this.plugin.settings, command),
      prompt: request.prompt, model: request.model, effort: request.effort, sessionId: request.sessionId, permissionMode: request.mode };
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "")}`;
}
