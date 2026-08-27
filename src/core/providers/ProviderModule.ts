import type { ExecutionBackendFactory } from '../execution/ExecutionBackendDescriptor';
import type { ProviderId } from '../types/provider';

/**
 * The contract a built-in provider contributes to the application.
 *
 * Every row of `docs/provider-contribution-inventory.md` has a typed slot here,
 * even where the consumer does not move until M3 or M5, because a contribution
 * with nowhere to go is a contribution silently dropped at a cutover.
 *
 * Two rules keep it honest:
 *
 * - **no bare `object` slots.** A reserved name is not a contract;
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
   * Settings fields whose change invalidates a backend generation.
   *
   * Declared as data rather than as a predicate the core calls blindly. Note
   * that these are *settings* field names; the environment variable names a
   * provider owns are `environmentKeyPrefixes`, which is a different question
   * and was mapped onto this slot by mistake in the first inventory.
   */
  readonly runtimeInputKeys: readonly string[];

  /**
   * Environment variable name prefixes this provider owns. Inventory row 7.
   *
   * Prefixes rather than the regular expressions this replaces: every one of
   * the nine was `/^PREFIX_/i` written nine different times, and a contract
   * that accepts an arbitrary expression is a contract where the core runs
   * provider-supplied code over every key a user types into their environment
   * settings. Matching is case-insensitive, on the whole prefix.
   */
  readonly environmentKeyPrefixes: readonly string[];

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
   * A boolean rather than a list of conversation ids: `reconcile` receives
   * settings, not the conversation list, so the ids are unknowable from inside
   * the module. The host owns conversations and applies this to its own list,
   * which is what the legacy reconciler does when it walks every conversation
   * of the provider.
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
 * mandatory: shipping init without dispose is app-level inventory row 3.
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
 * condition. The host supplies the real surface at M5, with the settings tab
 * rework this slot is waiting on.
 */
export interface ProviderSettingsPresentationPort<THost = unknown> {
  render(host: THost): void;
}

// ---------------------------------------------------------------------------
// Feature contributions — inventory rows 5, 8, 14, 15, 16
// ---------------------------------------------------------------------------

/**
 * What a provider declares about itself, independent of any running session.
 *
 * Split from the runtime ports at M3, because the single `features(context)`
 * factory was two contracts wearing one name. Every one of these is a
 * module-level constant in all nine providers and reads nothing from a context;
 * the ports that genuinely need one are `ProviderRuntimePorts`, and the
 * presentation adapter — the only consumer of that factory — asks for exactly
 * those two and nothing here.
 *
 * Keeping them behind a factory made them unreachable without a plugin, which
 * is what stopped the UI-facing rows from moving off the legacy registration.
 */
export interface ProviderDeclarations<TSettings extends object = Record<string, unknown>> {
  readonly providerId: ProviderId;
  /** Provider-preloaded context file names. Inventory row 5. */
  readonly context?: ProviderContextPort;
  /**
   * Chat UI configuration. Inventory row 8 — one row, a wide object, split into
   * named members so a migrated config cannot quietly lose the model picker.
   */
  readonly chatUI: ProviderChatUiContribution<TSettings>;
  /** Provider task and tool result interpretation. Inventory row 15. */
  readonly taskResults?: ProviderTaskResultPort;
  /** Subagent tool-name recognition and display parsing. Inventory row 16. */
  readonly nativeAgents?: ProviderNativeAgentPort;
  /**
   * How much of a provider a tab primes before anything is sent. Workspace row 7.
   *
   * **A declaration rather than a policy, because every implementation was a
   * constant.** The contribution this replaces was `resolveMode(context)` over
   * a context carrying the conversation, the plugin, the runtime and the tab's
   * lifecycle state — and all eight providers that had one returned the same
   * value unconditionally and read none of it. The slot before that was worse:
   * `shouldKeepWarm(): boolean`, which cannot express three modes, and every
   * module filled it with a stub answering `false`.
   *
   * `commands` warms provider-owned command discovery without priming the bound
   * tab runtime; `runtime` primes the runtime itself; `none` warms nothing.
   */
  readonly warmup: ProviderWarmupMode;
}

/** What a tab primes before a turn: nothing, commands only, or the runtime. */
export type ProviderWarmupMode = 'none' | 'commands' | 'runtime';

/**
 * The ports that only mean something for a running conversation.
 *
 * Both are answered against the conversation the context is bound to, and both
 * answer `null`, `absent` or nothing at all for any other — deliberately: a
 * lookup across the workspace would answer for a conversation this runtime does
 * not serve. That is why they cannot be reached from a catalog, and why the
 * workspace-global history service the feature layer uses is a different
 * contract with the same subject.
 */
export interface ProviderRuntimePorts {
  readonly providerId: ProviderId;
  /** Hydration, fork state, session resolution, deletion. Inventory row 14. */
  readonly history?: ProviderHistoryPort;
  /**
   * Transcript rewind. Adapter contract member 20.
   *
   * A slot the first version lacked. Fork, steering, and compaction are runs
   * and travel through the execution backend as requests; rewind is not a run —
   * it edits the transcript and can restore files — so it had nowhere to land,
   * and `capabilities.conversation.rewind` could say `native` with no way for
   * the host to perform it. Only Claude declares it today.
   */
  readonly rewind?: ProviderRewindPort;
}

export interface ProviderContextPort {
  preloadedFileNames(): readonly string[];
}

export interface ProviderChatUiContribution<TSettings extends object = Record<string, unknown>> {
  readonly modelPresentation: ProviderModelPresentation<TSettings>;
  readonly permissionToggles: readonly ProviderPermissionToggle[];
  readonly icon: string;
}

/**
 * Model ownership and labelling.
 *
 * Each method takes the provider's decoded settings, because a user-configured
 * or environment-supplied model is owned by the provider just as much as a
 * built-in one, and a settings-blind port would disown every custom model.
 * Providers that need no settings can ignore the argument.
 */
export interface ProviderModelPresentation<TSettings extends object = Record<string, unknown>> {
  ownsModel(modelId: string, settings: TSettings): boolean;
  label(modelId: string, settings: TSettings): string;
  contextWindow(modelId: string, settings: TSettings): number | undefined;
}

/**
 * The third kind is `token-budget` because that is the product's word for it.
 *
 * This union said `toggle` until M3 — a word invented while writing the
 * contract, for a control the legacy capability record had already named. No
 * provider declares either one today, which is exactly why it went unnoticed:
 * a vocabulary nothing uses is a vocabulary nothing checks.
 */
export type ProviderReasoningControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'effort'; readonly tiers: readonly string[] }
  | { readonly kind: 'token-budget' };

export interface ProviderPermissionToggle {
  readonly id: string;
  readonly label: string;
}

export interface ProviderHistoryPort {
  hydrate(conversationId: string): Promise<ProviderHistoryHydration>;
  deleteSession(conversationId: string): Promise<void>;
  resolveSessionId(conversationId: string): string | null;
  isPendingFork(conversationId: string): boolean;
  /**
   * The patch a finished turn makes to the conversation's session binding.
   *
   * Adapter contract row 29, which mapped to "a history port producing the
   * conversation patch" — a port method that did not exist. Deliberately not
   * `Partial<Conversation>`: that is a feature type, and `providerState` stays
   * opaque to core, which is the whole reason this returns two named fields
   * instead of a bag the adapter would be tempted to read.
   */
  buildSessionPatch(input: ProviderSessionPatchInput): ProviderSessionPatch;
}

export interface ProviderSessionPatchInput {
  readonly conversationId: string;
  readonly sessionInvalidated: boolean;
  /** The provider-native session id observed on the run, when there was one. */
  readonly nativeSessionRef: string | null;
}

export interface ProviderSessionPatch {
  readonly sessionId: string | null;
  /** Opaque provider state; core stores and returns it without reading it. */
  readonly providerState?: unknown;
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

export interface ProviderRewindPort {
  rewind(input: ProviderRewindRequest): Promise<ProviderRewindOutcome>;
}

export interface ProviderRewindRequest {
  readonly executionSessionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  /** Same vocabulary as the neutral `ChatRewindMode` this replaces. */
  readonly mode: 'conversation' | 'code-and-conversation';
}

/**
 * Deliberately not `ChatRewindResult`.
 *
 * That type reports `canRewind`, which conflates "the rewind happened" with
 * "a rewind would be possible" — the legacy call sites have to read `error` to
 * tell the two apart. An outcome that says which one occurred is the whole
 * reason for restating it here.
 */
export type ProviderRewindOutcome =
  | {
    readonly outcome: 'rewound';
    readonly filesChanged: readonly string[];
    readonly insertions?: number;
    readonly deletions?: number;
  }
  | { readonly outcome: 'unavailable'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string };

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
  readonly commands: {
    readonly discovery: ProviderCommandDiscovery;
    /**
     * Whether Grimoire surfaces commands in the chat input for this provider.
     *
     * Split from `discovery` for the same reason `mcp` is three fields: what a
     * provider *can* do and what the UI *asks for* are different statements,
     * and Codex is where they differ — it registers a command catalog and can
     * list skills through a short-lived app-server, while `TabManager` never
     * requests them. Collapsing the two would have flipped that on at the first
     * Codex flip, silently.
     */
    readonly chatSurface: CapabilitySupport;
    /**
     * Whether Grimoire loads the commands the provider's own session announces.
     *
     * A third field because Gemini answers the two questions differently: its
     * vault `.gemini/commands/**` reach the input dropdown, while the twenty
     * commands its ACP session announces are dropped. One field could say
     * either, and whichever it said would be wrong about the other — which is
     * what blocked the capability gating from moving onto this descriptor until
     * the two were separated.
     */
    readonly sessionCommands: CapabilitySupport;
  };
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
  /**
   * What a turn may carry in.
   *
   * Added while writing the adapter, which has to answer `getCapabilities()`
   * with the record the UI reads today: these two had no source in the
   * descriptor, so the adapter would have had to invent them or drop them —
   * and dropping them silently disables the image button and instruction mode.
   */
  readonly input: {
    readonly imageAttachments: CapabilitySupport;
    readonly instructionMode: CapabilitySupport;
  };
  readonly interactions: {
    readonly approvals: CapabilitySupport;
    readonly questions: CapabilitySupport;
    readonly planMode: CapabilitySupport;
    /** Vault prefix where the provider writes plan files, when it writes them. */
    readonly planArtifactPrefix?: string;
  };
  readonly conversation: {
    readonly fork: CapabilitySupport;
    readonly rewind: CapabilitySupport;
    readonly steering: CapabilitySupport;
    readonly compaction: CapabilitySupport;
  };
  readonly security: { readonly enforcement: SecurityEnforcement };
  /**
   * Whether the provider takes a reasoning instruction, and in what vocabulary.
   *
   * A capability rather than a chat-UI detail, and it sat in both until M3: the
   * legacy capability record and the module's chat-UI contribution each carried
   * it, with only the legacy one live. One statement, one home — the picker is
   * what presentation does with it.
   */
  readonly reasoningControl: ProviderReasoningControl;
  /** Workspace-side capability gating. App-level inventory row 1. */
  readonly workspace: ProviderWorkspaceCapabilityMap;
}

/**
 * The workspace surfaces a provider can claim.
 *
 * This is the one capability field whose keys are data rather than
 * declarations, and a free-form record made every one of them unverifiable: a
 * typo — `model`, `cliResolutions` — reads as "unsupported", and the settings
 * tab silently loses a section with nothing failing. Naming the keys turns that
 * into a compile error, which is why the catalog does not re-check them at
 * runtime; a compile-time union needs no runtime guard.
 */
export type ProviderWorkspaceCapabilityKey =
  | 'skills'
  | 'commands'
  | 'agents'
  | 'mcp'
  | 'cliResolution'
  | 'models'
  | 'usage'
  | 'environment';

/** Absent means unsupported here too, so a provider declares only what it has. */
export type ProviderWorkspaceCapabilityMap = Readonly<
  Partial<Record<ProviderWorkspaceCapabilityKey, CapabilitySupport>>
>;

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
  readonly capabilities: ProviderCapabilityDescriptor;
  /** What the provider declares about itself, reachable without a plugin. */
  readonly declarations: ProviderDeclarations<TSettings>;
  /**
   * A factory over the same context the workspace initializes from.
   *
   * It was a plain object at first, which made every context-dependent port
   * unfillable: history hydration, session deletion, and rewind all need
   * vault-facing services, so a static object could carry only the chat UI.
   * Antigravity did not notice, having none of them; Codex and Claude both have
   * real history services that would have been dropped at their flip — the
   * exact loss this migration exists to prevent. Synchronous on purpose: these
   * are ports, and constructing a port must not do work.
   *
   * It carried the static declarations too until M3, which made them
   * unreachable without a plugin and kept every UI-facing row on the legacy
   * registration. They are `declarations` now.
   */
  runtimePorts(context: TWorkspaceContext): ProviderRuntimePorts;
}
