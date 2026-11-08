import { createHash, randomUUID } from 'node:crypto';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import { delayThroughWindow } from '@/app/execution/hostTimers';
import { ProviderWorkspaceHolder } from '@/app/execution/ProviderWorkspaceHolder';
import type { RunTerminalReason } from '@/core/execution/ExecutionContracts';
import { executionSessionId, interactionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { BackendLifecycleRegistration, ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
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
import { t } from '@/i18n/i18n';
import type GrimoirePlugin from '@/main';
import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import { acpCancellationEvidence } from '@/providers/acp/execution/acpCancellationEvidence';
import { AcpManagedClientAdapterFactory } from '@/providers/acp/execution/AcpManagedClientAdapter';
import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';
import type { ManagedAcpClient, ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import { ManagedAcpExecutionBackend } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type { AcpNewSessionResponse } from '@/providers/acp/types';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { createAntigravityModuleContext } from '@/providers/antigravity/app/AntigravityModuleContext';
import { maybeGetAntigravityWorkspaceServices } from '@/providers/antigravity/app/AntigravityWorkspaceServices';
import { AntigravityContentPresenter } from '@/providers/antigravity/execution/AntigravityContentPresenter';
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
import { expandAntigravityVaultSkillInvocation } from '@/providers/antigravity/runtime/AntigravityVaultSkills';
import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';
import { getVaultPath } from '@/utils/path';

import {
  type AntigravityImageAttachmentBundle,
  attachAntigravityImages,
} from '../runtime/AntigravityImageAttachments';
import { AntigravityAcpContentPresenter } from './AntigravityAcpContentPresenter';
import { AntigravityAcpRequests } from './AntigravityAcpRequests';

/** Combined stdout, stderr, and recovered-transcript ceiling for one run. */
/**
 * How much one print turn may say before the run is stopped.
 *
 * A ceiling on memory, not a budget for an answer: the runner keeps the whole
 * stream so the transcript can be parsed, so something has to bound it.
 *
 * The number matters. It used to be `OUTPUT_BUFFER_LIMIT = 64_000` — the size
 * of a *sliding* parse buffer (`.slice(-OUTPUT_BUFFER_LIMIT)`), which bounded
 * memory while letting a turn print without end. Carried over to a cumulative
 * budget, the same 64 KB stopped meaning "keep the last 64 KB" and started
 * meaning "kill any turn that says more than 64 KB". A trivial agy probe
 * already writes ~30 KB of stream-json, so real turns were terminated with
 * `output-limit` and stored an empty answer under the question that asked for
 * it.
 */
export const ANTIGRAVITY_OUTPUT_BYTE_LIMIT = 16 * 1024 * 1024;
const OUTPUT_BYTE_LIMIT = ANTIGRAVITY_OUTPUT_BYTE_LIMIT;

/**
 * Antigravity chat execution, assembled from the running plugin.
 *
 * One object per plugin load, holding the one thing the backend and the tab
 * runtimes must agree on: the store behind the kernel's request references. The
 * runtime puts a request in and the backend takes it out, and neither can be
 * given its own copy — a reference minted against one store and resolved
 * against another resolves to nothing.
 *
 * Ambient plugin and process state reaches the backends through ports built here.
 */
export class AntigravityExecution {
  private readonly requests = new AntigravityRequestStore(() => opaqueId('agyreq'));
  private readonly acpRequests = new AntigravityAcpRequests(
    this.requests,
    () => {
      if (!getAntigravityProviderSettings(this.plugin.settings).enabled) {
        throw new Error('Antigravity is disabled.');
      }
      const command = this.plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
      return {
        command,
        cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
        environment: buildAntigravityRuntimeEnv(this.plugin.settings, command),
        permissionMode: antigravityPermissionMode(this.plugin),
      };
    },
    prompt => expandAntigravityVaultSkillInvocation(prompt,
      maybeGetAntigravityWorkspaceServices(this.plugin)?.commandCatalog ?? null),
  );
  private readonly interactions = new AcpPermissionBridge((request, input) => ({
    toolName: request.toolCall.title || request.toolCall.kind || 'Antigravity tool',
    description: request.toolCall.title || 'Antigravity requests permission to use a tool.',
    ...(typeof input.TargetFile === 'string' ? { blockedPath: input.TargetFile } : {}),
  }), () => opaqueId('agyix'));
  private readonly presenters = new Set<AcpApprovalPresenter>();
  private acpBackend: ManagedAcpExecutionBackend | undefined;
  /**
   * The temp files each tab's currently dispatched turn handed to `agy`, by tab.
   *
   * Freed when *that tab* dispatches its next turn, and all of them on dispose:
   * Codex's rule for the same problem and for the same reason. The process
   * reads these files while the turn runs and print mode ends its process
   * without anything here observing it, so a turn's copies have to outlive its
   * own end — and they are user data, so they do not outlive the turn after it.
   *
   * **Keyed, because this object is one per plugin and a runtime is one per
   * tab.** A single slot let a second tab's dispatch delete the files a first
   * tab's live `agy` was still reading.
   */
  private readonly liveAttachments = new Map<string, AntigravityImageAttachmentBundle>();

  /**
   * This provider's workspace slots, built independently of any tab's session.
   */
  private readonly workspaceHolder = new ProviderWorkspaceHolder(
    antigravityProviderModule.workspace,
    () => createAntigravityModuleContext(this.plugin),
  );

  constructor(
    private readonly plugin: GrimoirePlugin,
    private readonly registry: ExecutionLifecycleRegistry,
    /**
     * How the CLI's advertised flags are read, injectable for the same reason
     * the process runner is: the real one spawns `agy --help`, and a unit suite
     * that resolves an invocation should not reach for a binary to find out
     * that it is absent.
     */
    private readonly probeCapabilities = probeAntigravityCliCapabilities,
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


  /** Releases presentation, launch references and legacy attachment files. */
  async dispose(): Promise<void> {
    this.freeAttachments();
    this.acpRequests.dispose();
    for (const presenter of this.presenters) presenter.dismissAll();
    this.presenters.clear();
    await this.workspaceHolder.dispose();
  }

  createBackend(
    processRunner: AntigravityProcessRunner = this.createProcessRunner(),
    clientFactory?: ManagedAcpClientFactory,
  ): AntigravityExecutionBackend {
    const acp = this.createAcpBackend(clientFactory);
    this.acpBackend = acp;
    const context: AntigravityExecutionBackendContext = {
      acp: {
        backend: acp,
        available: async () => {
          if (!getAntigravityProviderSettings(this.plugin.settings).enabled) return false;
          const command = this.plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
          const capabilities = await this.probeCapabilities(command,
            buildAntigravityRuntimeEnv(this.plugin.settings, command));
          if (capabilities.conclusive === false) {
            throw new Error('Could not inspect the Antigravity CLI. Check that agy is installed, '
              + 'set its absolute path in Antigravity settings, then try again.');
          }
          return capabilities.acp === true;
        },
      },
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
      // Recorded at `info`, not `debug`: a turn that ends without a terminal
      // frame is the report we could not explain, and the log is the only place
      // that outlives it. The payload is names, counts, and timings.
      onDiagnostic: data => this.plugin.recordDebugLog?.({
        data: { ...data, providerId: 'antigravity' },
        event: 'antigravity.turn.completion',
        level: 'info',
        scope: 'provider.antigravity',
      }),
    };
    return new AntigravityExecutionBackend(context);
  }

  createBackendRegistration(
    processRunner?: AntigravityProcessRunner,
    clientFactory?: ManagedAcpClientFactory,
  ): BackendLifecycleRegistration {
    const backend = this.createBackend(processRunner, clientFactory);
    return { backend, interactions: this.acpBackend!, recovery: this.acpBackend! };
  }

  private createAcpBackend(factory?: ManagedAcpClientFactory): ManagedAcpExecutionBackend {
    const underlying = factory ?? new AcpManagedClientAdapterFactory({
      clientInfo: { name: 'grimoire', version: this.plugin.manifest?.version ?? '0.0.0' },
      processLauncher: new NodeManagedAcpProcessLauncher({
        resolve: startupRef => this.acpRequests.resolveLaunch(startupRef),
      }),
    });
    const clientFactory: ManagedAcpClientFactory = {
      create: async input => {
        const client = await underlying.create(input);
        const wrapped: ManagedAcpClient = {
          initialize: () => client.initialize(),
          newSession: async request => {
            const session = await client.newSession(request);
            this.acpRequests.rememberSession(wrapped, session);
            return session;
          },
          loadSession: async request => {
            const session = await client.loadSession(request);
            this.acpRequests.rememberSession(wrapped, { ...session, sessionId: request.sessionId });
            return session;
          },
          prompt: request => client.prompt(request),
          setConfigOption: request => client.setConfigOption(request),
          setMode: request => client.setMode(request),
          setModel: request => client.setModel(request),
          ...(client.listSessions ? { listSessions: request => client.listSessions!(request) } : {}),
          cancel: sessionId => client.cancel(sessionId),
          onSessionNotification: listener => client.onSessionNotification(listener),
          onConnectionLost: listener => client.onConnectionLost(listener),
          close: async () => {
            try { return await client.close(); }
            finally { this.acpRequests.forgetClient(wrapped); }
          },
        };
        return wrapped;
      },
      ...(underlying.dispose ? { dispose: () => underlying.dispose!() } : {}),
    };
    return new ManagedAcpExecutionBackend({
      descriptor: antigravityProviderModule.execution.descriptor,
      clientFactory,
      requestResolver: this.acpRequests,
      dynamicApplier: { apply: input => this.acpRequests.configure(input) },
      interactionBridge: this.interactions,
      resultSink: {
        storeResult: async input => input.signal.aborted ? { kind: 'aborted' } : {
          kind: 'committed',
          result: {
            resultId: opaqueId('result'),
            storage: 'projection',
            digest: createHash('sha256').update(input.output).digest('hex'),
          },
        },
      },
      reconciler: { reconcile: async query => acpCancellationEvidence(query)
        ?? { kind: 'unknown', effectsPossible: true } },
      auxiliaryQueries: { execute: async () => { throw new Error('Antigravity auxiliary execution is unsupported.'); } },
      scheduler: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      interactionIdFactory: () => interactionId(opaqueId('ix')),
      resultCommitTimeoutMs: 2_000,
      recoveryTimeoutMs: 2_000,
      runTimeoutMs: 10 * 60_000,
      runAbsoluteTimeoutMs: () => 30 * 60_000,
      maxResultBytes: OUTPUT_BYTE_LIMIT,
      acceptEmptyResultAfterPermissionDenied: response => response.stopReason === 'end_turn',
    });
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
   * One per tab: native identity and approval presentation belong to its conversation.
   */
  createRuntime(): ExecutionChatRuntimeAdapter {
    const plugin = this.plugin;
    // Minted once, and only used while no conversation is bound: a fallback
    // minted per read would give one tab's session and its runs different
    // owners, which the registry refuses.
    const agyTab = opaqueId('agytab');

    // Control records and the native binding belong to this conversation.
    let conversation: BoundConversation | null = null;
    let sessionDropped = false;
    let adapter: ExecutionChatRuntimeAdapter | undefined;
    const content = new AntigravityAcpContentPresenter({
      displayModel: () => selectedModel(plugin) ?? undefined,
      onSessionResume: outcome => { sessionDropped = outcome === 'replaced'; },
      onSessionOpened: session => this.syncAcpModels(session),
    });
    const legacy = new AntigravityContentPresenter();
    const presenter = new AcpApprovalPresenter(this.interactions,
      () => adapter?.interactionCallbacks() ?? {});
    this.presenters.add(presenter);
    const releaseSettled = this.interactions.onSettled(ref => presenter.dismiss(ref));
    const ports: ExecutionChatRuntimeHostPorts = {
      syncConversation: next => {
        if (next?.id !== conversation?.id) {
          content.forgetConversation();
          sessionDropped = next?.providerState?.sessionDropped === true;
        }
        conversation = next;
      },
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
      encodeRequestRef: (turn, history?: ChatMessage[], options?: ChatRuntimeQueryOptions) => {
        content.beginTurn();
        return this.requests.reference({
          ...buildAntigravityRequest(plugin, agyTab, turn, history, options),
          acpPrompt: buildAntigravityPrintPrompt(turn.prompt,
            ports.currentSessionId() ? [] : history),
        });
      },
      // The live ACP binding takes precedence over the last persisted one.
      currentSessionId: () => content.lastSessionId() ?? conversation?.sessionId ?? null,
      sessionDropped: () => sessionDropped,
      interactionPresenter: presenter,
      consumeProviderTurnMetadata: () => content.consumeTurnMetadata(),
      delay: delayThroughWindow,
      reportCleanupFailure: error => {
        plugin.recordDebugLog({
          error,
          event: 'execution.cleanup.failed',
          level: 'warn',
          scope: 'antigravity',
        });
      },
      describeFailure: reason => {
        if (reason === 'provider-failure' || reason === 'pre-dispatch-rejected') {
          const refusal = content.consumeTurnRefusal();
          if (refusal) return describeAcpSessionOpenFailure('Antigravity', refusal.message, refusal.origin);
        }
        // A native session always stays on ACP, so an ACP error must not be
        // explained as the legacy print transport refusing Safe mode.
        return ports.currentSessionId() && reason === 'pre-dispatch-rejected'
          ? describeAcpSessionOpenFailure('Antigravity')
          : describeAntigravityFailure(plugin, reason);
      },
      // Each transport retains its own content vocabulary, scoped to this tab.
      presentProviderContent: payload => [
        ...content.present(payload), ...legacy.present(payload),
      ],
    };
    adapter = new AntigravityRuntimeAdapter(
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
      antigravityProviderModule.runtimePorts(createAntigravityModuleContext(plugin,
        () => conversation, { sessionDropped: () => sessionDropped })),
      () => {
        presenter.dismissAll();
        releaseSettled();
        this.presenters.delete(presenter);
      },
    );
    return adapter;
  }

  private syncAcpModels(session: AcpNewSessionResponse): void {
    const models = session.models?.availableModels
      .filter(model => Boolean((model.modelId ?? model.id)?.trim() && model.name.trim()))
      .map(model => ({ rawId: model.name.trim(), label: model.name.trim(), description: model.description }));
    if (!models?.length) return;
    const current = getAntigravityProviderSettings(this.plugin.settings).discoveredModels;
    if (JSON.stringify(models) === JSON.stringify(current)) return;
    updateAntigravityProviderSettings(this.plugin.settings, { discoveredModels: models });
    void this.plugin.saveSettings?.().catch(error => this.plugin.recordDebugLog?.({
      error, event: 'execution.sessionConfig.failed', level: 'warn', scope: 'antigravity',
    }));
    for (const view of this.plugin.getAllViews?.() ?? []) view.refreshModelSelector();
  }

  /**
   * Turns a request reference back into a launchable invocation.
   *
   * Everything ambient is read here rather than held with the request: a turn
   * queued before a settings change must launch the CLI the user has configured
   * now, not the one configured when they pressed send.
   */
  private freeAttachments(owner?: string): void {
    if (owner === undefined) {
      for (const bundle of this.liveAttachments.values()) bundle.cleanup();
      this.liveAttachments.clear();
      return;
    }
    this.liveAttachments.get(owner)?.cleanup();
    this.liveAttachments.delete(owner);
  }

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
    const cliCapabilities = await this.probeCapabilities(command, environment);
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
    // The previous turn's copies go now rather than at its end: print mode
    // finishes its process without this composition seeing it, and the files
    // have to outlive the read `agy` makes from them.
    this.freeAttachments(request.owner);
    // Expanded here rather than where the request was composed: reading the
    // vault is asynchronous and the composer is a pure text transform, and this
    // is already the place that resolves ambient state at dispatch. Expanded
    // *before* the attachments, so the paths land on the prompt that is sent
    // rather than on one a later step rewrites.
    const expanded = await expandAntigravityVaultSkillInvocation(
      request.prompt,
      maybeGetAntigravityWorkspaceServices(plugin)?.commandCatalog ?? null,
    );
    const dropped: string[] = [];
    const attached = attachAntigravityImages(expanded, request.images ? [...request.images] : undefined, (image, error) => {
      dropped.push(image.name);
      plugin.recordDebugLog?.({
        data: {
          error: error instanceof Error ? error.message : String(error),
          mediaType: image.mediaType,
          name: image.name,
          providerId: 'antigravity',
        },
        event: 'print.imageAttachmentFailed',
        level: 'warn',
        scope: 'provider.antigravity',
      });
    });
    this.liveAttachments.set(request.owner, attached);
    return {
      command,
      cliCapabilities,
      cwd: vaultPath ?? process.cwd(),
      ...(dropped.length ? { droppedAttachments: dropped } : {}),
      ...(vaultPath ? { addDirPath: vaultPath } : {}),
      environment,
      model: request.model,
      // Reported as configured, not normalized: the backend is where fail-closed
      // lives, because `agy --print` exposes no approval hook and anything short
      // of full access must be refused before a process exists.
      permissionMode: antigravityPermissionMode(plugin),
      prompt: attached.prompt,
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
  owner: string,
  turn: PreparedChatTurn,
  history?: ChatMessage[],
  options?: ChatRuntimeQueryOptions,
): AntigravityRequest {
  return {
    owner,
    prompt: buildAntigravityPrintPrompt(turn.prompt, history),
    model: selectedModel(plugin, options),
    ...(turn.request.images?.length ? { images: [...turn.request.images] } : {}),
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

/** Releases only this tab's approval presentation after the kernel releases it. */
class AntigravityRuntimeAdapter extends ExecutionChatRuntimeAdapter {
  constructor(
    context: ConstructorParameters<typeof ExecutionChatRuntimeAdapter>[0],
    ports: ExecutionChatRuntimeHostPorts,
    features: ProviderRuntimePorts,
    private readonly releaseTab: () => void,
  ) { super(context, ports, features); }

  override async cleanup(): Promise<void> {
    try { await super.cleanup(); }
    finally { this.releaseTab(); }
  }
}
