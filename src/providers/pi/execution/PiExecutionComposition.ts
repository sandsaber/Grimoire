import { randomUUID } from 'node:crypto';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import { delayThroughWindow } from '@/app/execution/hostTimers';
import { ProviderWorkspaceHolder } from '@/app/execution/ProviderWorkspaceHolder';
import { executionSessionId, interactionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { BackendLifecycleRegistration, ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import type { ProviderCommandDescriptor } from '@/core/providers/ProviderModule';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { type BoundConversation,ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { resolveRunAbsoluteTimeoutMs } from '@/core/types/settings';
import type GrimoirePlugin from '@/main';
import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import type { ManagedAcpClient, ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { ProviderSettingsTabRenderer } from '@/providers/shared/providerHostContracts';
import { getVaultPath } from '@/utils/path';

import { piProviderModule } from '../PiProviderModule';
import { buildPiPromptBlocks, buildPiPromptText } from '../runtime/buildPiPrompt';
import { decodePiModel, getPiSettings, piEnvironment, resolvePiAdapter, resolvePiCommand, updatePiSettings } from '../settings';
import { piChatUIConfig } from '../ui/PiChatUIConfig';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';
import { PiAcpDynamicConfigApplier } from './PiAcpDynamicConfig';
import { PiContentPresenter } from './PiContentPresenter';
import { discoverPiThinkingLevels, syncPiDiscovery } from './PiDiscovery';
import { PiExecutionBackend } from './PiExecutionBackend';
import { PiExecutionRequests, type PiInvocationEnvironment } from './PiExecutionRequests';
import { PiProjectionResultSink } from './PiProjectionResultSink';

export class PiExecution {
  private readonly requests = new PiExecutionRequests(() => opaqueId('pireq'), () => this.environment());
  private readonly interactions = new AcpPermissionBridge(request => ({
    toolName: request.toolCall.kind ?? 'Pi extension',
    description: request.toolCall.title || 'Pi requests permission.',
  }), () => opaqueId('piix'));
  private readonly presenters = new Set<AcpApprovalPresenter>();
  private clientFactory: ManagedAcpClientFactory | undefined;
  private discovery: Promise<boolean> | undefined;
  private disposed = false;
  private readonly metadataControllers = new Set<AbortController>();
  private readonly workspaceHolder = new ProviderWorkspaceHolder(piProviderModule.workspace, () => ({
    models: {
      list: async () => this.models(),
      refresh: async () => { await this.discoverModels(); return this.models(); },
    },
    usage: { cached: () => null, refresh: async () => null },
    settingsPresentation: { render: (host: unknown) => {
      const input = host as { container: HTMLElement; context: Parameters<ProviderSettingsTabRenderer['render']>[1] };
      piSettingsTabRenderer.render(input.container, input.context);
    } },
  }));

  constructor(private readonly plugin: GrimoirePlugin, private readonly registry: ExecutionLifecycleRegistry) {}

  workspace() { return this.workspaceHolder.resolve(); }
  builtWorkspace() { return this.workspaceHolder.peek() ?? null; }

  createBackendRegistration(factory?: ManagedAcpClientFactory): BackendLifecycleRegistration {
    this.clientFactory = factory ?? new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire', version: this.plugin.manifest?.version ?? '0.0.0' },
      processLauncher: new NodeManagedAcpProcessLauncher({ resolve: ref => this.requests.resolveLaunch(ref) }),
    });
    const backend = new PiExecutionBackend({
      clientFactory: this.clientFactory, requestResolver: this.requests,
      dynamicApplier: new PiAcpDynamicConfigApplier(ref => this.requests.resolveDynamic(ref)),
      interactionBridge: this.interactions, resultSink: new PiProjectionResultSink(),
      reconciler: { reconcile: async query => acpCancellationEvidence(query) ?? { kind: 'unknown', effectsPossible: true } },
      auxiliaryQueries: { execute: async () => { throw new Error('Pi auxiliary execution is unavailable.'); } },
      scheduler: { setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: handle => window.clearTimeout(handle as number) },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      interactionIdFactory: () => interactionId(opaqueId('ix')),
      resultCommitTimeoutMs: 2_000, recoveryTimeoutMs: 2_000, runTimeoutMs: 10 * 60_000,
      runAbsoluteTimeoutMs: () => resolveRunAbsoluteTimeoutMs(this.plugin.settings), maxResultBytes: 256_000,
    });
    return { backend, interactions: backend, recovery: backend };
  }

  createRuntime(): ExecutionChatRuntimeAdapter {
    let conversation: BoundConversation | null = null;
    let runtime: ExecutionChatRuntimeAdapter;
    let commands: readonly ProviderCommandDescriptor[] = [];
    const tabId = opaqueId('pitab');
    const content = new PiContentPresenter(session => {
      if (syncPiDiscovery(this.plugin.settings, session)) this.refreshSelectors();
    }, announced => { commands = announced.map(command => ({ name: command.name,
      ...(command.description ? { description: command.description } : {}), source: 'session' })); });
    const presenter = new AcpApprovalPresenter(this.interactions, () => runtime?.interactionCallbacks() ?? {});
    this.presenters.add(presenter);
    const unsubscribe = this.interactions.onSettled(ref => presenter.dismiss(ref));
    runtime = new PiRuntimeAdapter({ registry: this.registry,
      backendId: piProviderModule.execution.descriptor.backendId, capabilities: piProviderModule.capabilities,
      owner: () => conversation?.id ? { kind: 'conversation', ownerId: conversation.id } : { kind: 'internal-service', ownerId: tabId },
      nextExecutionSessionId: () => executionSessionId(opaqueId('es')), nextRunId: () => runId(opaqueId('run')),
    }, {
      prepareTurn: request => ({ request, prompt: buildPiPromptText(request), persistedContent: buildPiPromptText(request),
        isCompact: false, mcpMentions: new Set<string>() }),
      encodeRequestRef: (turn, history, options) => {
        content.beginTurn();
        const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.plugin.settings, 'pi');
        const selected = options?.model ?? this.plugin.settings.savedProviderModel?.pi;
        const modelId = typeof selected === 'string' ? decodePiModel(selected) : undefined;
        const thinking = typeof snapshot.effortLevel === 'string' && snapshot.effortLevel !== 'default'
          ? snapshot.effortLevel : undefined;
        return this.requests.reference({
          prompt: buildPiPromptBlocks(turn.request, content.sessionId || conversation?.sessionId ? [] : history ?? [], options),
          dynamic: { ...(modelId ? { modelId } : {}), ...(thinking ? { thinking } : {}) },
        });
      },
      currentSessionId: () => content.sessionId ?? conversation?.sessionId ?? null,
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          content.forget(); commands = [];
          content.sessionDropped = next?.providerState?.sessionDropped === true;
        }
        conversation = next;
      },
      sessionDropped: () => content.sessionDropped,
      presentProviderContent: payload => content.present(payload),
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      interactionPresenter: presenter, delay: delayThroughWindow,
      describeFailure: reason => {
        const refused = content.consumeRefusal();
        if (refused) return refused.origin ? describeAcpSessionOpenFailure('Pi', refused.message, refused.origin) : refused.message;
        if (reason === 'spawn-failed' || reason === 'pre-dispatch-rejected') {
          if (!getPiSettings(this.plugin.settings).enabled) return 'Pi is disabled. Enable it in Providers settings.';
          if (!resolvePiAdapter(this.plugin.settings)) return 'pi-acp is missing. Install it with npm install -g pi-acp or set its path in Pi settings.';
          if (!resolvePiCommand(this.plugin.settings)) return 'Pi is missing. Install @earendil-works/pi-coding-agent or set PI_ACP_PI_COMMAND in Pi environment settings.';
          return 'Could not start Pi. Install pi and pi-acp, configure Pi in a terminal, and check the adapter path in Pi settings.';
        }
        return undefined;
      },
    }, piProviderModule.runtimePorts({
      resolveSessionId: id => id === conversation?.id ? content.sessionId ?? conversation.sessionId ?? null : null,
      sessionDropped: () => content.sessionDropped,
    }), { runtimeCommands: { listForSession: async () => commands } }, () => {
      presenter.dismissAll(); unsubscribe(); this.presenters.delete(presenter);
    });
    return runtime;
  }

  async discoverModels(): Promise<boolean> {
    if (this.disposed || !getPiSettings(this.plugin.settings).enabled) return false;
    if (this.discovery) return this.discovery;
    this.discovery = this.readMetadata().finally(() => { this.discovery = undefined; });
    return this.discovery;
  }

  private async readMetadata(): Promise<boolean> {
    const environment = await this.environment();
    const key = environment.launchKey;
    const abort = new AbortController();
    this.metadataControllers.add(abort);
    const timer = window.setTimeout(() => abort.abort(), 30_000);
    let client: ManagedAcpClient | undefined;
    const closeOnAbort = () => { void client?.close().catch(() => undefined); };
    abort.signal.addEventListener('abort', closeOnAbort, { once: true });
    try {
      if (!this.clientFactory) throw new Error('Pi execution is not initialized.');
      client = await this.clientFactory.create({ startupRef: this.requests.referenceLaunch({
        executable: environment.executable, arguments: [], cwd: environment.cwd, environment: { ...environment.environment },
      }), signal: abort.signal, requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }) });
      if (abort.signal.aborted) return false;
      await client.initialize();
      const session = await client.newSession({ cwd: environment.cwd, mcpServers: [] });
      const discoveredModels = await discoverPiThinkingLevels(client, session, abort.signal);
      if (this.disposed || abort.signal.aborted || (await this.environment()).launchKey !== key) return false;
      updatePiSettings(this.plugin.settings, { discoveredModels });
      this.refreshSelectors();
      return true;
    } finally {
      abort.signal.removeEventListener('abort', closeOnAbort);
      window.clearTimeout(timer); abort.abort(); this.metadataControllers.delete(abort);
      await client?.close();
    }
  }

  private models() {
    return piChatUIConfig.getModelOptions(this.plugin.settings).map(model => ({ id: model.value, label: model.label,
      ...(model.description ? { description: model.description } : {}) }));
  }

  private refreshSelectors(): void { for (const view of this.plugin.getAllViews()) view.refreshModelSelector(); }

  private async environment(): Promise<PiInvocationEnvironment> {
    if (this.disposed || !getPiSettings(this.plugin.settings).enabled) throw new Error('Pi is disabled.');
    const cwd = getVaultPath(this.plugin.app);
    if (!cwd) throw new Error('Pi requires a local vault.');
    const executable = resolvePiAdapter(this.plugin.settings);
    if (!executable) throw new Error('pi-acp is missing. Install it with npm install -g pi-acp.');
    const environment = piEnvironment(this.plugin.settings, executable);
    const pi = resolvePiCommand(this.plugin.settings);
    if (!pi) throw new Error('The pi executable is missing.');
    environment.PI_ACP_PI_COMMAND = pi;
    return { executable, cwd, environment, launchKey: JSON.stringify([executable, cwd, environment]) };
  }

  dispose(): void {
    this.disposed = true;
    for (const abort of this.metadataControllers) abort.abort();
    for (const presenter of this.presenters) presenter.dismissAll();
    this.presenters.clear(); this.requests.dispose();
    void this.workspaceHolder.dispose();
  }
}

class PiRuntimeAdapter extends ExecutionChatRuntimeAdapter {
  constructor(context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[1],
    features: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[2],
    workspace: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[3], private readonly release: () => void) {
    super(context, ports, features, workspace);
  }
  override async cleanup(): Promise<void> { try { await super.cleanup(); } finally { this.release(); } }
}

function opaqueId(prefix: string): string { return `${prefix}-${randomUUID().replaceAll('-', '')}`; }
