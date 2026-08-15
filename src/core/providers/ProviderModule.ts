import type { ExecutionBackendFactory } from '../execution/ExecutionBackendDescriptor';
import type { ProviderId } from '../types/provider';

/**
 * The contract a built-in provider contributes to the application.
 *
 * Designed against `docs/provider-contribution-inventory.md`, not harvested.
 * The first attempt's module had slots for execution, settings, workspace
 * lifecycle, capabilities, and ten feature ports typed as bare `object` — and
 * nothing else. Its cutover then replaced exactly one contribution and silently
 * dropped the rest, because there was nowhere for them to go. Every row of the
 * inventory therefore has a typed slot here, even where the consumer does not
 * move until M3 or M5.
 *
 * Two rules keep it honest:
 *
 * - **no bare `object` slots.** A reserved name is not a contract; it is the
 *   defect that produced the v1 cutover;
 * - **absent means unsupported.** An optional slot left out is a provider
 *   declaring it cannot do the thing, which the UI can read. A present slot
 *   that no-ops is a lie the UI cannot detect.
 *
 * The slot types are structural and generic over the composition context, so
 * this contract stays free of plugin, Obsidian, feature, and DOM imports. The
 * concrete legacy interfaces each slot replaces are named in the inventory.
 *
 * Dark code: nothing constructs a `ProviderModule` yet. It is dark until M2
 * wires the first backend, and the parity gate proves it stays out of the
 * shipped bundle until then.
 */

// ---------------------------------------------------------------------------
// Manifest — inventory rows 1-2
// ---------------------------------------------------------------------------

export interface ProviderManifest {
  readonly id: ProviderId;
  /** Provider identity label. Inventory row 1. */
  readonly displayName: string;
  /** Deterministic ordering for blank tabs, pickers, and settings. Inventory row 2. */
  readonly order: number;
}

// ---------------------------------------------------------------------------
// Settings — inventory rows 3, 4, 7, 9, and app-level row 2
// ---------------------------------------------------------------------------

export type ProviderSettingsDecodeResult<TSettings extends object> =
  | {
    readonly ok: true;
    readonly value: TSettings;
    /**
     * Keys the codec did not model, carried through so a settings file written
     * by a newer build is not silently truncated by an older one. The current
     * loader drops them; the M0a characterization records that, and this field
     * is the contract that fixes it.
     */
    readonly preservedUnknown: Readonly<Record<string, unknown>>;
  }
  | {
    readonly ok: false;
    readonly fallback: TSettings;
    readonly issues: readonly string[];
    readonly preservedUnknown: Readonly<Record<string, unknown>>;
  };

export interface ProviderSettingsCodec<TSettings extends object = Record<string, unknown>> {
  readonly providerId: ProviderId;
  readonly schemaVersion: number;

  /** Defaults published through the catalog. App-level inventory row 2. */
  defaults(): TSettings;
  decode(input: unknown): ProviderSettingsDecodeResult<TSettings>;
  encode(
    value: TSettings,
    preservedUnknown?: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;

  /** Enablement predicate and writer. Inventory rows 3 and 4. */
  isEnabled(settings: TSettings): boolean;
  withEnabled(settings: TSettings, enabled: boolean): TSettings;

  /**
   * Environment keys whose change invalidates a backend generation.
   * Inventory row 7, declared as data rather than as a regex the core applies
   * blindly.
   */
  readonly runtimeInputKeys: readonly string[];

  /**
   * Normalization on load and on environment change. Inventory row 9.
   * Returns the reconciled settings and what the change invalidates, instead of
   * mutating settings and reporting a boolean.
   */
  reconcile(settings: TSettings, reason: ProviderSettingsReconcileReason): ProviderSettingsReconcileResult<TSettings>;
}

export type ProviderSettingsReconcileReason = 'load' | 'environment-change' | 'model-change';

export interface ProviderSettingsReconcileResult<TSettings extends object> {
  readonly settings: TSettings;
  readonly changed: boolean;
  /**
   * Whether the reconciliation makes this provider's existing sessions
   * unusable.
   *
   * It first read `invalidatedConversationIds`, which no provider could ever
   * fill: `reconcile` receives settings, not the conversation list, so the ids
   * were unknowable from inside the module. Antigravity hid the flaw by having
   * no resumable session to invalidate; Codex, which resumes by native thread
   * id, exposed it. The host owns conversations and applies this to its own
   * list — which is exactly what the legacy reconciler does when it walks every
   * conversation of the provider.
   */
  readonly invalidatesSessions: boolean;
}

// ---------------------------------------------------------------------------
// Workspace — inventory workspace rows 1-11 and app-level rows 1 and 3
// ---------------------------------------------------------------------------

/**
 * Provider-owned workspace services.
 *
 * Every member is optional because a provider may genuinely not have the
 * capability — but each has a real type, and `initialize`/`dispose` are both
 * mandatory. Shipping init without dispose is app-level inventory row 3, and
 * repeating it is called out there as the v1 defect recurring.
 */
export interface ProviderWorkspaceContribution<TContext = unknown, TWorkspace extends ProviderWorkspaceSlots = ProviderWorkspaceSlots> {
  readonly providerId: ProviderId;
  initialize(context: TContext, signal: AbortSignal): Promise<TWorkspace>;
  dispose(workspace: TWorkspace): Promise<void>;
}

export interface ProviderWorkspaceSlots {
  /** Static slash-command inventory. Workspace row 1. */
  readonly commands?: ProviderCommandsPort;
  /** Agent mention inventory and its refresh hook. Workspace rows 2 and 11. */
  readonly agentMentions?: ProviderAgentMentionsPort;
  /** CLI binary resolution. Workspace row 3. */
  readonly cliResolution?: ProviderCliResolutionPort;
  /** Model discovery and listing. Workspace row 4. */
  readonly models?: ProviderModelsPort;
  /** Plan and usage indicators. Workspace row 5. */
  readonly usage?: ProviderUsagePort;
  /** Active-session command discovery. Workspace row 6. */
  readonly runtimeCommands?: ProviderRuntimeCommandsPort;
  /**
   * Warmup policy. Workspace row 7, replaced by lifecycle residency at M5;
   * the slot exists so the contribution is not lost before then.
   */
  readonly residency?: ProviderResidencyPort;
  /** Grimoire-owned MCP storage and server lifecycle. Workspace rows 8 and 9. */
  readonly mcp?: ProviderMcpPort;
  /** Provider settings tab. Workspace row 10. */
  readonly settingsPresentation?: ProviderSettingsPresentationPort;
}

export interface ProviderCommandsPort {
  list(): Promise<readonly ProviderCommandDescriptor[]>;
}

export interface ProviderCommandDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly source: 'built-in' | 'project' | 'user' | 'session';
}

export interface ProviderAgentMentionsPort {
  list(): Promise<readonly ProviderAgentMention[]>;
  refresh(): Promise<void>;
}

export interface ProviderAgentMention {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface ProviderCliResolutionPort {
  resolve(): Promise<ProviderCliResolution>;
}

export interface ProviderCliResolution {
  readonly executable: string | null;
  readonly source: 'configured' | 'discovered' | 'unavailable';
  readonly diagnostics?: readonly string[];
}

export interface ProviderModelsPort {
  list(): Promise<readonly ProviderModelDescriptor[]>;
  refresh(): Promise<readonly ProviderModelDescriptor[]>;
}

export interface ProviderModelDescriptor {
  /** Provider-native identifier, kept opaque rather than parsed by core. */
  readonly id: string;
  readonly label: string;
  readonly contextWindow?: number;
}

export interface ProviderUsagePort {
  read(): Promise<ProviderUsageSnapshot | null>;
}

export interface ProviderUsageSnapshot {
  readonly label: string;
  readonly usedFraction?: number;
  readonly resetsAt?: number;
}

export interface ProviderRuntimeCommandsPort {
  listForSession(sessionId: string): Promise<readonly ProviderCommandDescriptor[]>;
}

export interface ProviderResidencyPort {
  shouldKeepWarm(): boolean;
}

export interface ProviderMcpPort {
  loadServers(): Promise<readonly ProviderMcpServer[]>;
  saveServers(servers: readonly ProviderMcpServer[]): Promise<void>;
  start(serverId: string): Promise<void>;
  stop(serverId: string): Promise<void>;
}

export interface ProviderMcpServer {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
}

/**
 * Renders the provider's settings tab.
 *
 * Typed as an opaque host handle so this contract acquires no DOM vocabulary —
 * a projection or contract that learns element structure is a plan stop
 * condition. The host supplies the real surface at M3.
 */
export interface ProviderSettingsPresentationPort<THost = unknown> {
  render(host: THost): void;
}

// ---------------------------------------------------------------------------
// Feature contributions — inventory rows 5, 8, 14, 15, 16
// ---------------------------------------------------------------------------

export interface ProviderFeatureContributions<TSettings extends object = Record<string, unknown>> {
  readonly providerId: ProviderId;
  /** Provider-preloaded context file names. Inventory row 5. */
  readonly context?: ProviderContextPort;
  /**
   * Chat UI configuration. Inventory row 8 — one row, a wide object. It is
   * split into named members here because losing the model picker inside a
   * "migrated" chatUIConfig is the precise shape of the v1 failure.
   */
  readonly chatUI: ProviderChatUiContribution<TSettings>;
  /** Hydration, fork state, session resolution, deletion. Inventory row 14. */
  readonly history?: ProviderHistoryPort;
  /** Provider task and tool result interpretation. Inventory row 15. */
  readonly taskResults?: ProviderTaskResultPort;
  /** Subagent tool-name recognition and display parsing. Inventory row 16. */
  readonly nativeAgents?: ProviderNativeAgentPort;
}

export interface ProviderContextPort {
  preloadedFileNames(): readonly string[];
}

export interface ProviderChatUiContribution<TSettings extends object = Record<string, unknown>> {
  readonly modelPresentation: ProviderModelPresentation<TSettings>;
  readonly reasoningControl: ProviderReasoningControl;
  readonly permissionToggles: readonly ProviderPermissionToggle[];
  readonly icon: string;
}

/**
 * Model ownership and labelling.
 *
 * Each method takes the provider's decoded settings, because a user-configured
 * or environment-supplied model is owned by the provider just as much as a
 * built-in one. The first version of this slot omitted the parameter; writing
 * the second module surfaced it, since the live chat UI config has always
 * consulted settings and a settings-blind port would have silently disowned
 * every custom model. Providers that need no settings can ignore the argument.
 */
export interface ProviderModelPresentation<TSettings extends object = Record<string, unknown>> {
  ownsModel(modelId: string, settings: TSettings): boolean;
  label(modelId: string, settings: TSettings): string;
  contextWindow(modelId: string, settings: TSettings): number | undefined;
}

export type ProviderReasoningControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'effort'; readonly tiers: readonly string[] }
  | { readonly kind: 'toggle' };

export interface ProviderPermissionToggle {
  readonly id: string;
  readonly label: string;
}

export interface ProviderHistoryPort {
  hydrate(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
}

/**
 * Hydration outcomes are typed rather than collapsed into an empty
 * conversation. The M0a characterization recorded the current behavior — an
 * unrecognized session silently disappears — which is what these outcomes
 * replace.
 */
export type ProviderHistoryHydration =
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'complete' }
  | { readonly outcome: 'partial'; readonly reason: string }
  | { readonly outcome: 'stale'; readonly reason: string }
  | { readonly outcome: 'corrupt'; readonly reason: string }
  | { readonly outcome: 'recovered'; readonly reason: string };

export interface ProviderTaskResultPort {
  interpret(toolName: string, payload: unknown): ProviderTaskResultSummary | null;
}

export interface ProviderTaskResultSummary {
  readonly title: string;
  readonly detail?: string;
  readonly isError: boolean;
}

export interface ProviderNativeAgentPort {
  recognizesToolName(toolName: string): boolean;
  parseDisplay(payload: unknown): ProviderNativeAgentDisplay | null;
}

export interface ProviderNativeAgentDisplay {
  readonly agentId: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Auxiliary execution — inventory rows 11-13
// ---------------------------------------------------------------------------

/**
 * Provider execution outside chat.
 *
 * Kept as its own slot group because a flip moves chat execution only: until
 * M5 a flipped provider intentionally runs new chat execution beside legacy
 * auxiliary execution, and the two must hold disjoint sessions and processes.
 */
export interface ProviderAuxiliaryContributions<TContext = unknown> {
  readonly providerId: ProviderId;
  /** Inventory row 11. */
  readonly title?: ExecutionBackendFactory<TContext>;
  /** Inventory row 12. */
  readonly instructionRefine?: ExecutionBackendFactory<TContext>;
  /** Inventory row 13. */
  readonly inlineEdit?: ExecutionBackendFactory<TContext>;
}

// ---------------------------------------------------------------------------
// Capabilities — inventory row 6 and app-level row 1
// ---------------------------------------------------------------------------

export type CapabilitySupport = 'native' | 'grimoire' | 'unsupported';
export type SecurityEnforcement = CapabilitySupport | 'advisory';

export type ProviderProcessTopology =
  | 'process-per-run'
  | 'persistent-sdk-stream'
  | 'persistent-daemon'
  | 'managed-acp-subprocess';

export type ProviderProcessConcurrency =
  | 'serial-runs'
  | 'parallel-runs'
  | 'multiplexed-sessions';

export type ProviderHistoryOwnership = 'provider-native' | 'grimoire-projection' | 'none';

export type ProviderCommandDiscovery =
  | 'static'
  | 'active-session'
  | 'ephemeral-process'
  | 'unsupported';

export type ProviderAgentDefinitionInventory = 'native' | 'provider-files' | 'none';

/**
 * A summary label, never the thing UI actions are derived from. Actions read
 * the individual capability fields, because a result capability does not imply
 * spawn, cancellation, status query, or reattachment.
 */
export type ProviderAgentObservation = 'full' | 'aggregate' | 'terminal-only' | 'opaque' | 'none';

export interface ProviderCapabilityDescriptor {
  readonly providerId: ProviderId;
  readonly process: {
    readonly topology: ProviderProcessTopology;
    readonly concurrency: ProviderProcessConcurrency;
  };
  readonly session: {
    readonly resume: CapabilitySupport;
    readonly transcriptHydration: CapabilitySupport;
  };
  readonly history: { readonly ownership: ProviderHistoryOwnership };
  readonly commands: { readonly discovery: ProviderCommandDiscovery };
  readonly mcp: {
    readonly ownership: CapabilitySupport;
    readonly sessionConfiguration: CapabilitySupport;
    readonly perRunSelection: CapabilitySupport;
  };
  readonly agents: {
    readonly definitions: ProviderAgentDefinitionInventory;
    readonly spawnOrigin: readonly ('grimoire' | 'provider-native')[];
    readonly stableIdentity: boolean;
    readonly progressObservation: ProviderAgentObservation;
    readonly resultExtraction: boolean;
    readonly cancellation: boolean;
    readonly statusQuery: boolean;
    readonly reattachment: boolean;
  };
  readonly interactions: {
    readonly approvals: CapabilitySupport;
    readonly questions: CapabilitySupport;
    readonly planMode: CapabilitySupport;
  };
  readonly conversation: {
    readonly fork: CapabilitySupport;
    readonly rewind: CapabilitySupport;
    readonly steering: CapabilitySupport;
    readonly compaction: CapabilitySupport;
  };
  readonly security: { readonly enforcement: SecurityEnforcement };
  /** Workspace-side capability gating. App-level inventory row 1. */
  readonly workspace: Readonly<Record<string, CapabilitySupport>>;
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

/**
 * Workspace and execution take separate context types on purpose.
 *
 * Writing the first real module showed why: a workspace initializes from
 * vault-facing services, while a backend is composed from a request resolver,
 * a process runner, a result sink, and a scheduler. Forcing both through one
 * type would push a union into every provider.
 */
export interface ProviderModule<
  TWorkspaceContext = unknown,
  TExecutionContext = unknown,
  TSettings extends object = Record<string, unknown>,
> {
  readonly manifest: ProviderManifest;
  readonly settings: ProviderSettingsCodec<TSettings>;
  readonly workspace: ProviderWorkspaceContribution<TWorkspaceContext>;
  /** Chat execution. Inventory row 10 — the only row an M2 flip moves. */
  readonly execution: ExecutionBackendFactory<TExecutionContext>;
  readonly auxiliary: ProviderAuxiliaryContributions<TExecutionContext>;
  readonly capabilities: ProviderCapabilityDescriptor;
  readonly features: ProviderFeatureContributions<TSettings>;
}
