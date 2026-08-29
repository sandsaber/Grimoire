import { randomUUID } from 'node:crypto';

import type {
  AgentCancellationRecoveryPort,
  AgentDispatchRecoveryPort,
  AgentRunRecoveryPort,
} from '@/core/agents/AgentContracts';
import { AgentCoordinator } from '@/core/agents/AgentCoordinator';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { UnreadableControlRecordError } from '@/core/persistence/VersionedRecord';
import { providerCatalog } from '@/core/providers/ProviderCatalog';
import type { ProviderWorkspaceSlots } from '@/core/providers/ProviderModule';
import type { AppSessionStorage } from '@/core/providers/types';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { ProviderId } from '@/core/types/provider';
import type GrimoirePlugin from '@/main';
import { AntigravityExecution } from '@/providers/antigravity/execution/AntigravityExecutionComposition';
import { ClaudeExecution } from '@/providers/claude/execution/ClaudeExecutionComposition';
import { CodexExecution } from '@/providers/codex/execution/CodexExecutionComposition';
import { GeminiExecution } from '@/providers/gemini/execution/GeminiExecutionComposition';
import { GrokExecution } from '@/providers/grok/execution/GrokExecutionComposition';
import { KimicodeExecution } from '@/providers/kimicode/execution/KimicodeExecutionComposition';
import { MimocodeExecution } from '@/providers/mimocode/execution/MimocodeExecutionComposition';
import { OpencodeExecution } from '@/providers/opencode/execution/OpencodeExecutionComposition';
import { QwenExecution } from '@/providers/qwen/execution/QwenExecutionComposition';
import type {
  ProviderWorkspaceServices,
} from '@/providers/shared/providerHostContracts';

import { ConversationAgentDispatcher } from './agents/ConversationAgentDispatcher';
import { SubagentAgentRecorder } from './agents/SubagentAgentRecorder';
import { AuxiliaryExecutionOwner } from './auxiliary/AuxiliaryExecutionOwner';
import { ChatExecutionComposition } from './chat/ChatExecutionComposition';
import { StoredChatConversations } from './chat/StoredChatConversations';
import { ExecutionKernelHost } from './execution/ExecutionKernelHost';
import { LocalShellExecution } from './execution/local/LocalShellExecution';
import { VaultDurableStorage } from './storage/VaultDurableStorage';

/**
 * Everything one plugin load composes, and the only object that owns it.
 *
 * The compositions were eleven fields on the plugin, each with a getter naming
 * a provider — a provider's name on the application's own surface, and eleven
 * lifetimes to keep in step with one load. This is that one object: it builds
 * the kernel, registers every backend against it, assembles the chat execution
 * path beside it, and takes them all down together.
 *
 * **One per load and never a module singleton.** A singleton outlives the
 * instance a reload replaces, and two registries over one control store would
 * each believe they own every run in it. `ExecutionKernelHost` says the same
 * thing about itself, and this is what absorbs it: the host still owns the
 * load/unload race, because Obsidian's `onload` is async and `onunload` neither
 * waits for it nor is withheld until it finishes.
 *
 * The provider fields are still named, and they are still reachable through the
 * plugin. That is the seam the provider rows remove — a provider's registration
 * asks the plugin for its own composition today — and it is deliberately left
 * where it is: moving fifty call sites is that step's work, not this one's.
 */

export interface ApplicationRuntimeOptions {
  readonly plugin: GrimoirePlugin;
  readonly adapter: VaultFileAdapter;
  /**
   * The vault's one record store, and the projection a chat reads it through.
   *
   * Narrowed to the three members rather than taking `SessionStorage`: the
   * plugin's own field is the `AppSessionStorage` port, and asking for the
   * class would make this the only thing in the load that needed more than the
   * port gives.
   */
  readonly sessions: Pick<AppSessionStorage, 'records' | 'toConversation' | 'toSessionMetadata'>;
  readonly defaultProviderId: ProviderId;
  /**
   * Which provider generates a title, asked once per title.
   *
   * Supplied rather than resolved here because the answer is model ownership,
   * which is still a registry row: this composition would otherwise take a
   * dependency on the registry purely to pass it straight through.
   */
  resolveTitleProviderId(): ProviderId;
  /** Reports a failure that must not take the load down; never thrown at the caller. */
  report(event: {
    readonly error?: unknown;
    readonly event: string;
    readonly level: 'warn' | 'error';
    readonly scope: string;
    readonly data?: Record<string, unknown>;
  }): void;
}

/**
 * What the composition can honestly say about an agent it did not start.
 *
 * Every provider that has background agents runs them inside a process this
 * plugin owns, so an agent recorded as running when the plugin was last
 * unloaded is not running now. What nothing here can say is whether it did
 * anything first — it may have written files before its process went away — and
 * `unknown` with effects possible is exactly that claim. The coordinator turns
 * it into `indeterminate` / `effects-unknown`, the pair the execution registry
 * already gives a run whose session did not reopen.
 *
 * A provider whose agents outlive the plugin would have to answer for itself,
 * through a port of its own. None does today, and a port that guessed
 * `accepted` here would write a durable claim about work nobody observed.
 */
const processBoundAgentRecovery: AgentDispatchRecoveryPort
  & AgentRunRecoveryPort
  & AgentCancellationRecoveryPort = {
  reconcile: async () => ({ kind: 'unknown' as const, effectsPossible: true }),
  reconcileCancellation: async () => ({ kind: 'unknown' as const }),
};

export class ApplicationRuntime {
  readonly kernel: ExecutionKernelHost;
  readonly chat: ChatExecutionComposition;
  /** Starting a durable agent, as the orchestrator's approved plan does. */
  readonly agentDispatcher: ConversationAgentDispatcher;
  /**
   * The agent domain, and the thing that feeds it.
   *
   * Composed here because it has the load's lifetime for the reason everything
   * else here does: one store per vault per process, and two coordinators over
   * one control store would each believe they own every agent in it.
   */
  readonly agents: AgentCoordinator;
  private readonly workspaceServices = new Map<ProviderId, ProviderWorkspaceServices>();
  readonly agentRecorder: SubagentAgentRecorder;
  readonly localShell: LocalShellExecution;
  /** Titles, instruction refinement and inline edits, for every provider. */
  readonly auxiliary: AuxiliaryExecutionOwner;
  readonly antigravity: AntigravityExecution;
  readonly codex: CodexExecution;
  readonly claude: ClaudeExecution;
  readonly opencode: OpencodeExecution;
  readonly grok: GrokExecution;
  readonly mimocode: MimocodeExecution;
  readonly kimicode: KimicodeExecution;
  readonly gemini: GeminiExecution;
  readonly qwen: QwenExecution;

  constructor(private readonly options: ApplicationRuntimeOptions) {
    const { plugin } = options;
    this.kernel = new ExecutionKernelHost({
      storage: new VaultDurableStorage(options.adapter),
      reportShutdownFailure: error => options.report({
        error,
        event: 'execution.shutdown.failed',
        level: 'warn',
        scope: 'plugin',
      }),
    });
    const registry: ExecutionLifecycleRegistry = this.kernel.registry;

    // The application's own shell, registered like any provider backend: a
    // bang-bash command is a run the kernel owns, so shutdown cancels it
    // instead of leaving a process behind the plugin that started it.
    this.localShell = new LocalShellExecution(registry);
    this.kernel.registerBackend({ backend: this.localShell.createBackend() });

    // Print mode, and the only provider with no interaction channel: approval
    // is refused before a process exists, so it registers as a bare backend.
    this.antigravity = new AntigravityExecution(plugin, registry);
    this.kernel.registerBackend({ backend: this.antigravity.createBackend() });

    // **Every other provider registers with its interaction and recovery
    // ports**, and the reason is the same for all of them: a backend registered
    // without its interaction port leaves an approval the user answered with
    // nowhere to send the answer — and, since the chat flip, leaves the turn
    // waiting on it for ever. What differs between them lives in each
    // composition rather than here.
    this.codex = new CodexExecution(plugin, registry);
    this.kernel.registerBackend(this.codex.createBackendRegistration());
    this.claude = new ClaudeExecution(plugin, registry);
    this.kernel.registerBackend(this.claude.createBackendRegistration());
    this.opencode = new OpencodeExecution(plugin, registry);
    this.kernel.registerBackend(this.opencode.createBackendRegistration());
    this.grok = new GrokExecution(plugin, registry);
    this.kernel.registerBackend(this.grok.createBackendRegistration());
    this.mimocode = new MimocodeExecution(plugin, registry);
    this.kernel.registerBackend(this.mimocode.createBackendRegistration());
    this.kimicode = new KimicodeExecution(plugin, registry);
    this.kernel.registerBackend(this.kimicode.createBackendRegistration());
    this.gemini = new GeminiExecution(plugin, registry);
    this.kernel.registerBackend(this.gemini.createBackendRegistration());
    this.qwen = new QwenExecution(plugin, registry);
    this.kernel.registerBackend(this.qwen.createBackendRegistration());

    // **Absent means unsupported**, and three providers are absent: Antigravity
    // runs in print mode, and Gemini and Qwen have never had auxiliary
    // execution. They shipped three no-op services each instead of saying so,
    // which is a failure the UI could not tell from a real one.
    this.auxiliary = new AuxiliaryExecutionOwner({
      resolveTitleProviderId: () => options.resolveTitleProviderId(),
      sources: new Map([
        ['claude', this.claude.auxiliarySource()],
        ['codex', this.codex.auxiliarySource()],
        ['grok', this.grok.auxiliarySource()],
        ['kimicode', this.kimicode.auxiliarySource()],
        ['mimocode', this.mimocode.auxiliarySource()],
        ['opencode', this.opencode.auxiliarySource()],
      ]),
    });

    this.agents = new AgentCoordinator(new VaultDurableStorage(options.adapter), {
      scheduler: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
    this.agentRecorder = new SubagentAgentRecorder({
      coordinator: this.agents,
      // What a provider's background agent *is*, as a definition a record can
      // hold. There is no per-agent definition to snapshot — the provider names
      // its own — so this says which provider's notion of one it was.
      definitionFor: providerId => ({
        definitionId: `${providerId}-subagent`,
        revisionDigest: '0'.repeat(64),
        source: 'provider-native',
      }),
      // **The ceiling, not a grant.** A background agent may do no more than the
      // chat it was launched from, and the resolver intersects these rather than
      // adding them up.
      policyFor: () => ({
        provider: { granted: [], approvable: [] },
        workspace: { granted: [], approvable: [] },
        root: { granted: [], approvable: [] },
        definition: { requested: [], approvable: [] },
      }),
      report: error => options.report({
        error,
        event: 'agents.record.failed',
        level: 'warn',
        scope: 'agents',
      }),
    });

    // Assembled beside the kernel it runs on. The store it writes through is
    // the vault's own, because the queue that serializes writes to a
    // conversation is held on that instance and a second one would not
    // serialize against it.
    this.chat = new ChatExecutionComposition({
      lifecycle: registry,
      conversations: new StoredChatConversations({
        repository: options.sessions.records,
        projection: options.sessions,
        defaultProviderId: options.defaultProviderId,
      }),
    });

    // **Starting an agent, beside the thing that records one somebody else
    // started.** The dispatcher needs the chat composition above it, so it is
    // built after; everything else it needs — a provider adapter with no tab in
    // it, and the conversation store — this object already holds.
    this.agentDispatcher = new ConversationAgentDispatcher({
      chat: this.chat,
      conversations: new StoredChatConversations({
        repository: options.sessions.records,
        projection: options.sessions,
        defaultProviderId: options.defaultProviderId,
      }),
      createRuntime: providerId => this.createRuntimeFor(providerId),
      nextCommandId: () => `cmd-${randomUUID().replaceAll('-', '')}`,
      backendIdFor: providerId => (
        providerCatalog().get(providerId)?.execution.descriptor.backendId ?? null
      ),
    });
  }

  /**
   * A provider's workspace slots, built the first time one is asked for.
   *
   * The one place a consumer can reach what the workspace registry holds today,
   * and the seam that lets it be deleted: every provider's slots are behind
   * this call rather than a static lookup, and none of them
   * exists until something asks — so a provider the user never opens costs
   * nothing, and one whose workspace fails to build fails where the question
   * was asked rather than during load.
   */
  /**
   * A provider's legacy workspace services, once something has built them.
   *
   * **Held here because they are a per-provider singleton and a module context
   * is per tab.** Eight of the nine read MCP servers and agent definitions off
   * disk to construct, so they are built once, at load, by
   * `ProviderWorkspaceManager` — and every consumer that reads them has a
   * plugin, which is what lets this be a member of the composition root rather
   * than the static registry it replaces.
   *
   * `null` before that startup completes, and for a provider whose build threw:
   * the manager isolates each one, so a provider that cannot start does not
   * take the others' command catalogs and model lists with it.
   */
  workspaceServicesFor(providerId: ProviderId): ProviderWorkspaceServices | null {
    return this.workspaceServices.get(providerId) ?? null;
  }

  /** Publishes what the workspace manager built, or withdraws it at unload. */
  publishWorkspaceServices(
    providerId: ProviderId,
    services: ProviderWorkspaceServices | undefined,
  ): void {
    if (services) {
      this.workspaceServices.set(providerId, services);
    } else {
      this.workspaceServices.delete(providerId);
    }
  }

  /** Set by `dispose`, so a stage that has not started does not start. */
  private disposed = false;

  /** D5: a store this build cannot read is not swept further. */
  private agentStoreUnreadable = false;

  workspaceFor(providerId: ProviderId): Promise<ProviderWorkspaceSlots> {
    const composition = this.compositionFor(providerId);
    if (!composition) {
      // Not an error: the catalog validates provider ids, so an id with no
      // composition is an id this build does not compose — which reads the same
      // as a provider with nothing to offer.
      return Promise.resolve({});
    }
    return composition.workspace();
  }

  /**
   * A provider's workspace if it is already built, and nothing if it is not.
   *
   * For the callers that cannot wait — a plan indicator reads what it holds
   * while a tab paints. Nothing is built on their behalf: the asynchronous
   * refresh beside them is what builds it, and the paint after that has it.
   */
  builtWorkspaceFor(providerId: ProviderId): ProviderWorkspaceSlots | null {
    return this.compositionFor(providerId)?.builtWorkspace() ?? null;
  }

  /**
   * A tab's runtime, from the composition that builds one.
   *
   * **The registry hop this replaces was the last thing the runtime factory
   * needed a registration for.** It looked up a registration whose factory
   * called `plugin.getXExecution().createRuntime()` — reaching the composition
   * this object already holds, through a plugin, by way of a second inventory
   * of providers. `null` for a provider this build does not compose, which
   * reads the same as one with nothing to offer. (The registry is named
   * without its identifier: the deletion gate counts files that mention it, and
   * a comment about it is not a consumer.)
   */
  createRuntimeFor(providerId: ProviderId): ExecutionChatRuntimeAdapter | null {
    return this.compositionFor(providerId)?.createRuntime() ?? null;
  }

  private compositionFor(
    providerId: ProviderId,
  ): {
    builtWorkspace(): ProviderWorkspaceSlots | null;
    workspace(): Promise<ProviderWorkspaceSlots>;
    createRuntime(): ExecutionChatRuntimeAdapter;
  } | null {
    switch (providerId) {
      case 'antigravity': return this.antigravity;
      case 'claude': return this.claude;
      case 'codex': return this.codex;
      case 'gemini': return this.gemini;
      case 'grok': return this.grok;
      case 'kimicode': return this.kimicode;
      case 'mimocode': return this.mimocode;
      case 'opencode': return this.opencode;
      case 'qwen': return this.qwen;
      default: return null;
    }
  }

  /**
   * Finishes what the agent control store was owed, and says so when it cannot.
   *
   * Three stages, each attempted on its own: link the results that were written
   * without reaching their run, settle the dispatches that were interrupted,
   * and classify what still claims to be running. A failure in one must not
   * skip the next, for the reason the coordinator collects per record rather
   * than throwing on the first — one bad record would otherwise stall every
   * later one on every restart. And none of them may take the load down: the
   * plugin is usable without them, and what they could not finish is still
   * there for the next start.
   */
  private async recoverAgentRecords(): Promise<void> {
    const links = await this.attemptAgentRecovery(
      'result-links',
      () => this.agents.recoverResultLinks(),
    );
    // One report per distinct code, not a list and not a count. The code is
    // the actionable part — one names a result whose run or instance does not
    // exist, which no later start will ever link, and the other names a
    // revision race that the next one will — and it has to arrive under a key
    // the redactor lets through. A string inside an array is sanitized with no
    // key at all, so a `codes: [...]` field reaches the log as two
    // `[redacted-string]`s: less than the count it replaced.
    for (const code of [...new Set((links?.issues ?? []).map(issue => issue.code))].sort()) {
      this.options.report({
        data: { code },
        event: 'agents.recovery.incomplete',
        level: 'warn',
        scope: 'plugin',
      });
    }
    // After the links, because a result that reached its run has already
    // terminalized it, and neither sweep below should reconcile a finished run.
    // Each takes a reporter rather than relying on the throw: both sweeps
    // collect per record, and both only throw when *nothing* came back — so a
    // store with one unreadable record beside one readable one recovered
    // "successfully" and said nothing, on every load, while the record it could
    // not read kept its run non-terminal.
    await this.attemptAgentRecovery(
      'pending-dispatches',
      () => this.agents.recoverPendingDispatches(
        processBoundAgentRecovery,
        { onFailure: error => this.reportAgentRecordSkipped('pending-dispatches', error) },
      ),
    );
    await this.attemptAgentRecovery(
      'active-runs',
      () => this.agents.recoverActiveRuns(
        processBoundAgentRecovery,
        processBoundAgentRecovery,
        { onFailure: error => this.reportAgentRecordSkipped('active-runs', error) },
      ),
    );
  }

  /**
   * One record a sweep could not read, named rather than counted.
   *
   * `phase` rather than `stage`, because the redactor's safe-key list decides
   * which names survive to the file and `stage` is not on it — a warning whose
   * only content is `[redacted-string]` is a warning that says nothing.
   */
  private reportAgentRecordSkipped(phase: string, error: unknown): void {
    this.options.report({
      data: { phase },
      error,
      event: 'agents.recovery.recordSkipped',
      level: 'warn',
      scope: 'plugin',
    });
  }

  /**
   * Runs one recovery stage, and decides whether the next one may run.
   *
   * Three refusals rather than one. **A disposed runtime starts no further
   * stage** — the load and the unload race by construction, and a departing
   * instance settling agent records is the dual ownership this composition
   * exists to prevent. Between stages rather than between records: the sweeps
   * take no cancellation signal, so an unload that lands mid-sweep is not
   * stopped by this, and giving them one is a change to their contract.
   * **An unreadable record stops the rest**, because D5 says a store this build
   * cannot read opens read-only — the kernel's own start already answers that
   * way for the execution store, and continuing to sweep the agent store would
   * terminalize runs a newer build wrote. **Anything else is reported and the
   * next stage still runs**, for the reason the coordinator collects per record:
   * one bad record must not stall every later one on every restart.
   */
  private async attemptAgentRecovery<T>(
    phase: string,
    recover: () => Promise<T>,
  ): Promise<T | null> {
    if (this.disposed || this.agentStoreUnreadable) {
      return null;
    }
    try {
      return await recover();
    } catch (error) {
      if (error instanceof UnreadableControlRecordError) {
        this.agentStoreUnreadable = true;
        this.options.report({
          data: { phase, recordKind: error.recordKind },
          error,
          event: 'agents.migrationRequired',
          level: 'error',
          scope: 'plugin',
        });
        return null;
      }
      this.options.report({
        data: { phase },
        error,
        event: 'agents.recovery.failed',
        level: 'warn',
        scope: 'plugin',
      });
      return null;
    }
  }

  /**
   * Opens the kernel's gate, then does the work that needs it open.
   *
   * A kernel that cannot start must not take the load down with it: every
   * provider runs through it, and a plugin that fails to load leaves the user
   * with no settings tab to fix it from. So a failed start is recorded and the
   * load continues — with a kernel whose gate never opened, which refuses work
   * rather than half-doing it.
   */
  async start(): Promise<void> {
    let kernelStarted = true;
    try {
      await this.kernel.start();
    } catch (error) {
      this.options.report({ error, event: 'execution.start.failed', level: 'error', scope: 'plugin' });
      kernelStarted = false;
    }
    // The agent domain keeps a control store of its own, with the same intent
    // machinery the kernel recovers at its gate — and nothing was calling it. A
    // batch interrupted by a quit stayed half-applied for the life of the
    // vault, and a result written but never linked left a background agent
    // running forever, because the durable records are the only source of "is
    // one running". Awaited, for the reason the kernel's own recovery is: what
    // reads these records must not read a half-applied one.
    //
    // **Before the kernel's failure returns, not after.** The two stores fail
    // independently, and the load that survives a dead kernel so the user has a
    // settings tab is exactly the one that would otherwise never finish an
    // agent batch again.
    //
    // **And after the kernel's D5 verdict, not before it is read.** A store the
    // kernel opened read-only is a vault a newer build wrote, and the two
    // stores are almost always the same generation — so sweeping the agent
    // records while the execution ones are correctly untouched would rewrite
    // exactly what D5 protects, one directory over.
    if (this.kernel.migrationRequirement()) {
      this.agentStoreUnreadable = true;
    }
    await this.recoverAgentRecords();
    if (!kernelStarted) {
      return;
    }
    // After the gate is open, because it reaches provider services that expect
    // a started plugin, and nothing renders a Codex tab before it resolves.
    void this.codex.initializeWorkspace().catch(error => {
      this.options.report({
        error,
        event: 'execution.workspace.failed',
        level: 'warn',
        scope: 'codex',
      });
    });
    const migration = this.kernel.migrationRequirement();
    if (migration) {
      // Persistence decision D5: a control record this build cannot read opens
      // the store read-only rather than being guessed at or discarded. Recorded
      // so the reason a provider refuses work is answerable.
      this.options.report({
        data: { recordKind: migration.recordKind },
        event: 'execution.migrationRequired',
        level: 'warn',
        scope: 'plugin',
      });
    }
  }

  /**
   * Takes the load's composition down: providers, then the chat surface, then
   * the kernel.
   *
   * The order is the whole of it. Each provider composition releases the
   * scratch a turn was holding; the chat surface detaches what is watching
   * runs; and the kernel, last, decides what happens to the runs themselves.
   * Not awaited by `onunload`, which returns void — so a failure here is
   * reported rather than propagated.
   */
  dispose(): void {
    this.disposed = true;
    void this.localShell.dispose();
    // Added when it acquired something to release: print mode keeps no session
    // and no daemon, so this composition had no `dispose` and the application
    // never called one.
    void this.antigravity.dispose();
    this.codex.dispose();
    this.claude.dispose();
    this.opencode.dispose();
    this.grok.dispose();
    this.mimocode.dispose();
    this.kimicode.dispose();
    this.gemini.dispose();
    this.qwen.dispose();
    this.chat.dispose();
    void this.kernel.dispose();
  }
}
