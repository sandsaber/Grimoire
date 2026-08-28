import type { ExecutionBackendFactory } from '../execution/ExecutionBackendDescriptor';
import type { Conversation, SlashCommand } from '../types';
import type { ManagedMcpServer } from '../types/mcp';
import type { ProviderId } from '../types/provider';
import type { ProviderCommandEntry } from './commands/ProviderCommandEntry';
import type {
  ProviderRuntimeCommandLoaderContext,
  ProviderSubagentLifecycleAdapter,
  ProviderTaskResultInterpreter,
} from './types';

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

export interface ProviderSettingsCodec<TSettings extends object = Record<string, unknown>>
  extends ProviderSettingsReconciliation {
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

}

/**
 * Normalization on load, on environment change, and on model change. Inventory
 * row 9.
 *
 * **Three operations, not one method with a reason.** The slot this replaces
 * was `reconcile(settings: TSettings, reason)` over
 * `'load' | 'environment-change' | 'model-change'` — and the row it faces has
 * three separate methods that the host calls from three different places, in a
 * fixed order, with no implementation reading any reason at all. The enum was
 * vocabulary invented while writing the contract, like the `toggle` reasoning
 * kind M3 found: a word nothing uses is a word nothing checks. Folding the
 * three into one would also have merged the two the host runs *in sequence* on
 * an environment change, which are two different repairs.
 *
 * **And the settings are the app's, not `TSettings`.** Every implementation
 * computes its environment hash from `getRuntimeEnvironmentText`, which joins
 * the shared environment scope with the provider's, and two of them read and
 * write the top-level `model`. A provider-scoped record disowns every shared
 * variable: a user who sets `XAI_API_KEY` in the shared scope would stop
 * invalidating Grok's model cache. This is the third row to want the whole
 * record — see `ProviderScopedSettings`.
 *
 * The settings are mutated in place, which is what nine implementations do and
 * what the host's projection dance is built on; a contract documenting the
 * opposite would be worse than one admitting the shape it has.
 */
export interface ProviderSettingsReconciliation {
  /**
   * What an invalidation clears, for the providers that have one.
   *
   * **Not the same answer for all nine, and the difference is data loss.**
   * Claude's `providerState` holds subagent transcripts and a fork source, and
   * its reconciler clears the session id alone — so `session` keeps the opaque
   * state. Every other provider that invalidates keeps a native handle to a
   * session the *old environment* created there — a Codex thread id, an
   * OpenCode database path, a Grok session directory — so `session-and-state`
   * clears both. Clearing both for everyone loses Claude's subagent data;
   * clearing neither strands the other five on handles that resolve to nothing.
   *
   * Absent where the provider invalidates nothing at all, which is three of the
   * nine: Gemini and Qwen have no reconciliation written, and Antigravity
   * starts a fresh process per run and has no session to lose.
   */
  readonly invalidates?: ProviderSessionInvalidationScope;

  /**
   * Discovery state this provider must drop when its environment changes.
   *
   * Optional, and absent means there is none: four providers cache a model
   * catalogue keyed to the environment that produced it, and five do not.
   */
  clearDiscoveryState?(settings: ProviderScopedSettings): boolean;

  /**
   * Re-derives the environment hash, and says whether the sessions this
   * provider already has are now unusable.
   *
   * `invalidatesSessions` is a boolean rather than a list of conversations: the
   * host owns the conversation list, and a module handed one would be a module
   * editing the host's state. What the host clears is the session binding —
   * `sessionId` and the opaque `providerState` — for the conversations of this
   * provider that have one.
   */
  reconcileEnvironment(settings: ProviderScopedSettings): ProviderSettingsReconcileOutcome;

  /** Normalizes model ids whose variant suffix the visibility settings no longer allow. */
  normalizeModelVariants(settings: ProviderScopedSettings): boolean;

  /**
   * Lifts this provider's settings out of a record written before providers had
   * their own configs, into the record being built from it.
   *
   * **Absent for six of the nine, and the list cannot grow.** The stored shape
   * this migrates only ever held Claude, Codex and OpenCode at the top level; a
   * provider added later was never written that way, so migrating it would move
   * a field that never existed. The knowledge is a provider's own — Claude's
   * reader falls back to `settings.claudeCliPathsByHost`, an on-disk name no
   * neutral caller can be expected to know — which is why the host used to
   * import three providers' accessors to do it.
   */
  adoptLegacyTopLevelFields?(
    legacy: Record<string, unknown>,
    into: Record<string, unknown>,
  ): void;
}

export interface ProviderSettingsReconcileOutcome {
  readonly changed: boolean;
  /** Whether the reconciliation makes this provider's existing sessions unusable. */
  readonly invalidatesSessions: boolean;
}

/** What an environment change takes with the session, for one provider. */
export type ProviderSessionInvalidationScope = 'session' | 'session-and-state';

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
  /** Reading and deleting a provider's stored transcript. Half of inventory row 14. */
  readonly transcripts?: ProviderTranscriptPort;
}

/**
 * What a conversation's session binding means to this provider.
 *
 * Every member is a pure function of the conversation. `providerState` stays
 * opaque to core, which is why the two that build one return a record rather
 * than a `Partial<Conversation>`: the host writes it back to the field it came
 * from without reading inside it.
 */
export interface ProviderConversationStatePort {
  /**
   * The provider-native session id this conversation resumes from, if any.
   *
   * Takes a nullable conversation because the fork path asks before one is
   * bound, and all nine implementations already answer `null` for it.
   */
  resolveSessionId(conversation: Conversation | null): string | null;
  /** Whether this conversation is a fork whose session has not been created yet. */
  isPendingFork(conversation: Conversation): boolean;
  /** The opaque state a forked conversation starts from. */
  forkState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown>;
  /**
   * The opaque state to save with this conversation, where the provider adds
   * any of its own. Absent means the conversation's existing state is written
   * back unchanged, which is what eight of the nine do.
   */
  persistedState?(conversation: Conversation): Record<string, unknown> | undefined;
}

/**
 * A provider's stored transcript, which is the half of history that is I/O.
 *
 * Distinct from `ProviderRuntimePorts.history`, which answers for the one
 * conversation a runtime is bound to. This is asked about any conversation the
 * workspace has, which is why it takes one.
 */
export interface ProviderTranscriptPort {
  /** Loads a conversation's transcript from the provider, and says what happened. */
  hydrate(conversation: Conversation, vaultPath: string | null): Promise<ProviderHistoryHydration>;
  deleteSession(conversation: Conversation, vaultPath: string | null): Promise<void>;
}

/**
 * A provider's slash commands and skills, as the vault holds them.
 *
 * **Seven operations, not one.** The slot was `list()` against a row that also
 * *writes*: the settings hub saves and deletes vault entries through it, the
 * tab manager hands it the commands a live session reported, and it knows where
 * a new entry goes when the user names no path. An eighth — the dropdown's
 * trigger characters — was never a service at all and is
 * `ProviderDeclarations.commandDropdown` now.
 *
 * Entries rather than descriptors, because every consumer but one reads fields
 * a descriptor does not have: which file an entry lives in, whether it can be
 * edited, whether it can be deleted. The one that did read descriptors —
 * `getSupportedCommands` on the adapter — was already served by a mapping the
 * shared slot performed over these same entries.
 */
export interface ProviderCommandsPort {
  /** What the composer's dropdown lists: vault entries and runtime ones together. */
  listDropdownEntries(
    options: { readonly includeBuiltIns: boolean },
  ): Promise<readonly ProviderCommandEntry[]>;
  /** Only what lives in the vault, which is the half the settings hub can edit. */
  listVaultEntries(): Promise<readonly ProviderCommandEntry[]>;
  saveVaultEntry(entry: ProviderCommandEntry): Promise<void>;
  deleteVaultEntry(entry: ProviderCommandEntry): Promise<void>;
  /**
   * Where a new vault entry is written when the user names no path.
   *
   * Optional: a provider whose entries all live in one root has nowhere else to
   * put one, and answering a path it does not own would write there.
   */
  defaultVaultStoragePath?(): string | null;
  /** Hands the catalog the commands a live session has just reported. */
  setRuntimeCommands(commands: SlashCommand[]): void;
  refresh(): Promise<void>;
}

/**
 * The characters that open a command list, and the prefixes that classify it.
 *
 * Restated here rather than imported from
 * `core/providers/commands/ProviderCommandCatalog`: that type carries the
 * provider id, which a declaration reached *by* provider id does not need to
 * repeat, and a field a module can set to a different value than the id it is
 * registered under is a field that will eventually disagree with it.
 */
export interface ProviderCommandDropdown {
  readonly triggerChars: readonly string[];
  readonly builtInPrefix: string;
  readonly skillPrefix: string;
  readonly commandPrefix: string;
}

export interface ProviderCommandDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly source: 'built-in' | 'project' | 'user' | 'session';
}

/**
 * The agents a provider offers to `@`-mention.
 *
 * **Listing, not searching.** The row this replaces was `searchAgents(query)`,
 * and all five implementations were the same case-insensitive substring filter
 * over name, id and description — generic matching, not provider knowledge.
 * Four of the five set `id` to the agent's own name, so the one filter that
 * looked different (Claude's, which also matches on id) is the same answer for
 * every provider that is not Claude. The host filters once; a provider says
 * what it has.
 */
export interface ProviderAgentMentionsPort {
  list(): Promise<readonly ProviderAgentMention[]>;
  refresh(): Promise<void>;
}

export interface ProviderAgentMention {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /**
   * Where the definition came from. The mention dropdown shows it beside the
   * name, so a user can tell a vault agent from one a plugin installed.
   *
   * Absent from the first version of this slot, which had a row returning it on
   * every result and a UI reading it — the kind of field that is only missed
   * once something renders a list with a blank column.
   */
  readonly source: ProviderAgentMentionSource;
}

/** Matches `AgentDefinition['source']`, which every provider already reports. */
export type ProviderAgentMentionSource = 'builtin' | 'global' | 'plugin' | 'vault';

/**
 * Where this provider's CLI is, given the settings it should be found under.
 *
 * **Synchronous, and it takes the settings** — the slot this replaces was
 * `resolve(): Promise<ProviderCliResolution>`, taking nothing and answering
 * later, and neither half fits. All nine implementations answer synchronously
 * from a memo keyed on what they read; `getResolvedProviderCliPath` has 33 call
 * sites and not one awaits, several of them in paths the module contract
 * requires to be synchronous. And every one reads
 * `getRuntimeEnvironmentText`, which joins the shared environment scope with
 * the provider's — so a settings-less port would have to hold a plugin to find
 * out where to look.
 *
 * **A declaration, not a workspace service.** A CLI path is what a workspace is
 * *created* with: the process the workspace wraps is launched with it, so a
 * port only reachable once the workspace exists is a port nothing can use at
 * launch. This is the second row to turn out that way; the command dropdown was
 * the first.
 *
 * The record it answered — `{ executable, source, diagnostics }` — is gone with
 * it. No implementation produced a source or a diagnostic; all nine answer a
 * path or nothing, and `unavailable` and `null` were the same answer written
 * twice.
 */
export interface ProviderCliResolutionPort {
  resolve(settings: ProviderScopedSettings): string | null;
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

/**
 * Plan and usage, as the provider reports it.
 *
 * **Two reads, not one.** The first version had a single
 * `read(): Promise<...>`, and the indicator this serves shows the snapshot it
 * already holds the moment a tab paints, then refreshes behind it. One method
 * makes every paint either a network call or permanently stale, and which of
 * those it becomes is decided by whoever writes the implementation.
 *
 * There is no `isAvailable`. All nine providers had one and all nine answered
 * `settings.enabled`, which is the question the catalog decides — so a port
 * that asked it again would be a second inventory of the same fact.
 */
export interface ProviderUsagePort {
  /** The snapshot already held, if any. Never fetches. */
  cached(): ProviderUsageSnapshot | null;
  /** Fetches a fresh snapshot, answering `null` when the provider has none. */
  refresh(): Promise<ProviderUsageSnapshot | null>;
}

/**
 * **Not one window flattened.** The first version was
 * `{ label, usedFraction?, resetsAt? }` — a single quota — and the providers
 * that have quotas report several at once: a Codex user on a five-hour and a
 * weekly window would have seen one of them, with no way to tell which. Plans
 * billed by amount report `spend` and no window at all.
 */
export interface ProviderUsageSnapshot {
  /** The plan's name, in the provider's own words. */
  readonly plan: string;
  /** Quota windows, in the order the provider reports them. */
  readonly windows?: readonly ProviderUsageWindow[];
  /** Amount spent, for plans billed that way rather than by quota. */
  readonly spend?: string;
  readonly note?: string;
  /** When the provider last answered, in epoch milliseconds. */
  readonly updatedAt?: number;
}

export interface ProviderUsageWindow {
  readonly label: string;
  readonly pct: number;
  /**
   * `false` where the provider reports a window whose percentage it does not
   * know. Absent means known, so a window that simply has no percentage and one
   * whose percentage is genuinely zero stay distinguishable.
   */
  readonly pctKnown?: boolean;
  readonly reset: string;
}

export interface ProviderRuntimeCommandsPort {
  listForSession(sessionId: string): Promise<readonly ProviderCommandDescriptor[]>;
  /**
   * Whether this provider can be asked for commands at all.
   *
   * Absent where the provider has no discovery beyond the open session — five
   * of the nine. The four that have one are the managed ACP CLIs, which
   * announce their commands when a session opens and can be asked in an
   * isolated process when there is no session to ask in.
   */
  isAvailable?(settings: Record<string, unknown>): boolean;
  /**
   * The commands a tab can offer, given what the *host* knows about it.
   *
   * **Every input is the host's**: whether opening a session is allowed, which
   * conversation the tab is on, and the tab's runtime. That is what makes this
   * a slot rather than something reachable only through a registry — the
   * context named a plugin until the provider's metadata call moved into a
   * closure its own workspace services build it with.
   */
  loadCommands?(context: ProviderRuntimeCommandLoaderContext): Promise<SlashCommand[]>;
}


/**
 * Grimoire-owned MCP configuration.
 *
 * **Storage, and only storage.** The first version had `start(serverId)` and
 * `stop(serverId)`, and nothing in the product starts or stops an MCP server: a
 * server is a record with an `enabled` flag that the provider's own CLI
 * launches. Those two existed only in this contract and in the nine contexts
 * that stubbed them — invented operations every provider would have had to
 * implement as a lie.
 *
 * The second version added `tryParseClipboardConfig`, on the reasoning that a
 * user pasting a server config had no slot. It had none because it is not a
 * provider question: `McpConfigParser.tryParseClipboardConfig` is one shared
 * function, the settings UI imports it directly, and **no provider implements
 * the member**. It was the same mistake as `start`/`stop` made in the opposite
 * direction — a slot invented from a feature rather than from nine
 * implementations — and it is gone.
 *
 * **`ManagedMcpServer`, not a flattened record.** It answered
 * `{ id, label, enabled }`, and the consumer — `McpSettingsManager`, which
 * every provider's settings tab constructs over this same storage — loads the
 * list, edits a server's command, args and disabled tools, adds one, deletes
 * one, and writes the whole list back. A three-field record cannot survive that
 * round trip: `saveServers` could not have added a server it was handed.
 */
export interface ProviderMcpPort {
  load(): Promise<readonly ManagedMcpServer[]>;
  save(servers: readonly ManagedMcpServer[]): Promise<void>;
  /**
   * What the workspace holds right now, without going to disk.
   *
   * **Synchronous because its readers are.** The mention dropdown asks which
   * servers save to context as it builds its candidates, and the composer's
   * server selector asks which are enabled as it prunes — both while drawing,
   * and both *later* than whenever they were handed this port. A snapshot taken
   * when a tab was built is stale by the time either reads it, which is why
   * these are members rather than a value.
   *
   * Absent where the provider has no Grimoire-owned MCP at all: Codex and
   * Antigravity, whose configuration is the CLI's own.
   */
  servers?(): readonly ManagedMcpServer[];
  /** Of those, the ones whose output is saved into the conversation's context. */
  contextSavingServers?(): readonly ManagedMcpServer[];
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
/**
 * No longer generic over the provider's settings: the one member that was —
 * the chat UI contribution — takes the app settings record now, because what it
 * reads is not only the provider's own config.
 */
export interface ProviderDeclarations {
  readonly providerId: ProviderId;
  /** Provider-preloaded context file names. Inventory row 5. */
  readonly context?: ProviderContextPort;
  /**
   * Chat UI configuration. Inventory row 8 — one row, a wide object, split into
   * named members so a migrated config cannot quietly lose the model picker.
   */
  readonly chatUI: ProviderChatUiContribution;
  /**
   * How this provider's slash commands are typed. Half of workspace row 1.
   *
   * **A declaration, because all nine implementations are constants.**
   * `getDropdownConfig()` is a method on the command catalog — a *workspace*
   * service, built lazily and reached asynchronously — and every one of the
   * nine returns a frozen literal that reads nothing. Three of its consumers
   * are synchronous (the composer's dropdown in `TabManager` and `tabSettings`,
   * and the inline-edit modal), so leaving it there would have made a tab
   * build a provider's whole workspace to learn which character opens a
   * command list, and show no commands at all until it had.
   *
   * Absent means the provider surfaces no command dropdown. Antigravity is the
   * one: it contributes no command catalog either.
   */
  readonly commandDropdown?: ProviderCommandDropdown;
  /**
   * Where this provider's CLI is. Workspace row 3, which is not workspace work.
   *
   * Absent where the provider has no CLI to find.
   */
  readonly cli?: ProviderCliResolutionPort;
  /**
   * What a conversation's session binding means to this provider. Half of
   * inventory row 14.
   *
   * **A declaration, because all four members are pure functions of the
   * conversation they are handed.** None of the nine reads a plugin, touches a
   * file, or awaits anything: they read the session id and the opaque
   * `providerState` off a conversation and answer, or build a record to put
   * back. And their consumers are synchronous — `SessionStorage` derives the
   * state to persist inside a save, and two `hasStartedConversation` predicates
   * ask whether a conversation has a session while a tab paints.
   *
   * The other half of the row — reading and deleting the provider's stored
   * transcript — is genuinely workspace work, and is `transcripts` there. Third
   * row this milestone to split on the same question: *which of its consumers
   * are synchronous, and why?*
   */
  readonly conversationState?: ProviderConversationStatePort;
  /** Provider task and tool result interpretation. Inventory row 15. */
  readonly taskResults?: ProviderTaskResultPort;
  /**
   * How this provider reads the result of an *asynchronous* task — a
   * different question from `taskResults`, which reads a tool call that has
   * already returned. Inventory row 15's other half.
   *
   * **A declaration, because the one implementation reads nothing but its
   * argument**, and both consumers are synchronous: a tab hands it to the
   * subagent manager while the tab is being built, and again when the tab
   * changes provider. Absent means the provider has no async task protocol,
   * which is the answer for eight of the nine — `run_in_background` is a
   * parameter of Claude's Task tool.
   */
  readonly asyncTaskResults?: ProviderTaskResultInterpreter;
  /**
   * How this provider's subagent spawn, wait and close tools are recognized
   * and read. Inventory row 16's lifecycle half — `nativeAgents` above is the
   * naming half, and Codex fills both from the same adapter.
   *
   * A declaration for the same two reasons: every member is a pure function
   * of the tool call it is handed, and its consumer resolves an adapter while
   * a subagent block renders. Absent for the seven providers that surface no
   * subagent lifecycle at all.
   */
  readonly subagentLifecycle?: ProviderSubagentLifecycleAdapter;
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

/**
 * The settings a presentation member is asked about.
 *
 * **The whole record, not the provider's own decoded settings.** The slot took
 * `TSettings` and every one of the twenty members it faces takes the app
 * settings and scopes them itself — because what they read is not only the
 * provider's config. A model's ownership depends on environment variables, and
 * the environment a provider runs under is the shared scope joined with its
 * own; a settings-blind port disowns every environment model, and a
 * provider-scoped one disowns every shared one.
 *
 * Three rows in a row have wanted this — the settings reconciler, the plan
 * usage provider and this one — which is why it is named rather than repeated.
 */
export type ProviderScopedSettings = Record<string, unknown>;

/**
 * Everything a provider decides about how its chat controls look and behave.
 *
 * **Twenty members, not three.** The first version had a model presentation, a
 * static `{id,label}[]` of permission toggles and an icon string, against a row
 * with twenty methods — so the entire reasoning group, the service-tier toggle,
 * the mode selector and its apply hook, bang-bash enablement, model options,
 * custom model ids, variant normalization and metadata preparation had nowhere
 * to go. Twenty-three consumers read this row; the slot covered three of them.
 *
 * Grouped rather than flattened, because the toolbar reads them in groups: a
 * provider either has a reasoning control or it does not, and a provider with
 * none should say so by leaving the group out rather than by answering `[]` to
 * four separate questions.
 */

export interface ProviderChatUiContribution {
  readonly models: ProviderModelPresentation;
  /**
   * The reasoning control, where the provider has one.
   *
   * Absent is a real statement: Gemini and Antigravity declare
   * `reasoningControl: { kind: 'none' }`, and a toolbar that drew a reasoning
   * row for them would offer tiers their runtime cannot apply. The first
   * version of the delegation decided this from whether the config *had* a
   * `getReasoningOptions` method — which every config has, because it is a
   * required member — so the group was present for all nine.
   */
  readonly reasoning?: ProviderReasoningPresentation;
  /** The permission-mode toggle, where the provider exposes one. */
  readonly permissionMode?: ProviderPermissionModePresentation;
  // `serviceTier` and `modeSelector` below are absent for every provider today.
  // That is the contract working: a slot with no filler is a provider saying it
  // has none, which is a different thing from a slot filled with a control that
  // can never render an option.
  /** The fast/standard toggle, where the provider has service tiers. */
  readonly serviceTier?: ProviderServiceTierPresentation;
  /** A provider-owned selector beside the model picker, where there is one. */
  readonly modeSelector?: ProviderModeSelectorPresentation;
  /** Whether this provider offers the shared bang-bash input mode. */
  bangBashEnabled(settings: ProviderScopedSettings): boolean;
  /**
   * The provider's icon, drawn beside its model names.
   *
   * Structured rather than a string: the row returns a viewBox and a small tree
   * of paths, and a string could carry neither without the host parsing markup
   * a provider handed it.
   *
   * **Asked, not held.** A module is built when its file is imported, and a
   * provider that resolves its icon through anything the application composes
   * would run that at import time — which is how this first went in, and what
   * the two providers whose icons reach the catalog reported immediately.
   */
  icon(): ProviderChatIcon | null;
}

/**
 * A provider's icon, as the provider draws it.
 *
 * Restated here rather than guessed: the first version of this had a composite
 * icon as a flat list of paths, and what a provider returns is a small tree —
 * groups with their own attributes, holding paths with theirs. A flattened
 * version would have dropped the group transforms two providers rely on, and
 * nothing would have failed until an icon rendered wrong.
 */
export type ProviderChatIcon =
  // `kind` is optional on the path variant, as it is on the row: a provider
  // that writes only a viewBox and a path is writing a path icon, and
  // requiring the tag here would have made this restatement reject values the
  // product already produces.
  | { readonly kind?: 'path'; readonly viewBox: string; readonly path: string }
  | { readonly kind: 'composite'; readonly viewBox: string; readonly children: readonly ProviderChatIconChild[] };

export type ProviderChatIconChild =
  | { readonly tag: 'path'; readonly attributes: Readonly<Record<string, string>> }
  | {
    readonly tag: 'g';
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: readonly { readonly tag: 'path'; readonly attributes: Readonly<Record<string, string>> }[];
  };

export interface ProviderReasoningPresentation {
  /**
   * Whether this model's reasoning is chosen from named tiers rather than a
   * token budget. The two render differently, which is why it is asked per
   * model rather than declared once per provider.
   */
  isTiered(modelId: string, settings: ProviderScopedSettings): boolean;
  options(modelId: string, settings: ProviderScopedSettings): readonly ProviderReasoningTier[];
  defaultValue(modelId: string, settings: ProviderScopedSettings): string;
  /** Applied when the toolbar changes the selection, where the provider cares. */
  apply?(modelId: string, value: string, settings: ProviderScopedSettings): void;
}

/**
 * One reasoning tier, or one token budget.
 *
 * Named `ProviderReasoningTier` rather than `ProviderReasoningOption`: the
 * latter already exists in `types.ts`, in the same folder, with a different
 * shape — and two same-named exports beside each other is an import that
 * silently loses fields.
 */
export interface ProviderReasoningTier extends ProviderModelOption {
  /** Token budget, for the providers whose reasoning is bought rather than tiered. */
  readonly tokens?: number;
}

export interface ProviderPermissionModePresentation {
  toggle(): ProviderPermissionModeToggle | null;
  /**
   * This provider's current mode in the shared vocabulary.
   *
   * Optional, and the two providers with the richest permission models are
   * exactly the two that do not have it: Claude and Codex publish a toggle and
   * read their mode from their own settings. A required member delegating to a
   * hook they do not implement answers `null` for them — indistinguishable from
   * "no mode set", which is the failure this contract's own rule forbids.
   */
  resolve?(settings: ProviderScopedSettings): string | null;
  /** Applied when the toolbar changes the mode, for the providers that take it. */
  apply?(value: string, settings: ProviderScopedSettings): void;
}

export interface ProviderPermissionModeToggle {
  readonly inactiveValue: string;
  readonly inactiveLabel: string;
  readonly inactiveDescription?: string;
  readonly activeValue: string;
  readonly activeLabel: string;
  readonly activeDescription?: string;
  readonly planValue?: string;
  readonly planLabel?: string;
  readonly planDescription?: string;
}

export interface ProviderServiceTierPresentation {
  toggle(settings: ProviderScopedSettings): ProviderServiceTierToggle | null;
}

export interface ProviderServiceTierToggle {
  readonly inactiveValue: string;
  readonly inactiveLabel: string;
  readonly activeValue: string;
  readonly activeLabel: string;
  readonly description?: string;
}

export interface ProviderModeSelectorPresentation {
  selector(settings: ProviderScopedSettings): ProviderModeSelector | null;
  apply(value: string, settings: ProviderScopedSettings): void;
}

export interface ProviderModeSelector {
  readonly label: string;
  readonly value: string;
  readonly activeValue?: string;
  readonly options: readonly ProviderModelOption[];
}

/**
 * Model ownership and labelling.
 *
 * Each method takes the provider's decoded settings, because a user-configured
 * or environment-supplied model is owned by the provider just as much as a
 * built-in one, and a settings-blind port would disown every custom model.
 * Providers that need no settings can ignore the argument.
 */
export interface ProviderModelPresentation {
  ownsModel(modelId: string, settings: ProviderScopedSettings): boolean;
  /**
   * The window this model has, honouring a per-model override the user set.
   *
   * The overrides are the host's — one map for every provider — so they are
   * passed rather than read.
   *
   * **Always a number, including for a model this provider does not own.** Six
   * providers answer a constant and three answer their own default; none looks
   * at whether it owns the id. This said `number | undefined` and taught that
   * `undefined` meant "not mine", which no implementation can produce — ask
   * `ownsModel` for that.
   */
  contextWindow(
    modelId: string,
    settings: ProviderScopedSettings,
    customLimits?: Readonly<Record<string, number>>,
  ): number;
  /**
   * What the picker lists for this provider, each option carrying its own label.
   *
   * There was a `label(modelId, settings)` beside this, and the row has no such
   * member: the picker reads labels off the options it is drawing. Deriving one
   * by searching the options answers the raw id for any model not currently
   * listed — an alias-labelled model the user has hidden, for instance — which
   * is worse than not offering the question.
   */
  options(settings: ProviderScopedSettings): readonly ProviderModelOption[];
  /**
   * The model the app ships selected, when this provider is the default one.
   *
   * Reachable without settings and without a workspace, which is the point: it
   * is read while the settings defaults are being *built*, so anything that
   * wants settings first cannot answer it. Absent for the eight providers that
   * `DEFAULT_CHAT_PROVIDER_ID` is not.
   */
  readonly primaryModel?: string;

  /**
   * Whether this is a model the provider ships, rather than one a user
   * configured or an environment variable introduced. Read when two providers
   * claim the same id, to prefer the one that owns it outright.
   */
  isBuiltIn(modelId: string): boolean;
  /** The model id with any variant suffix the visibility settings disallow removed. */
  normalizeVariant(modelId: string, settings: ProviderScopedSettings): string;
  /** Model ids this provider recognizes in a set of environment variables. */
  customModelIds(environment: Readonly<Record<string, string>>): ReadonlySet<string>;
  /**
   * Writes the settings a model change implies, into the record it is given.
   *
   * **A mutation, and the name says so.** This was `defaultsFor` returning "a
   * patch rather than a mutation", which is what the shape *should* be — a
   * caller cannot see what a model change touched, and two providers writing
   * the same field is invisible. But every implementation writes in place
   * (`applyModelDefaults` sets the effort default and the last-model tracking),
   * and a contract that documents the opposite of what nine providers do is
   * worse than one that admits the shape it has. Changing it is a change to
   * those nine, recorded in the slot-fit audit rather than claimed here.
   */
  applyDefaults(modelId: string, settings: ProviderScopedSettings): void;
  /**
   * Provider-owned discovery after a model is selected, where there is any.
   *
   * The only member that takes a host handle, and the only asynchronous one:
   * it reaches provider services to learn about a model the user just picked.
   */
  prepareMetadata?(modelId: string, settings: ProviderScopedSettings, host: unknown): Promise<void>;
}

/**
 * One entry in the model picker.
 *
 * Every field the picker draws, including the two that only matter when a
 * dropdown mixes providers: it reads `providerIcon` and `providerId` off each
 * option to put the right mark beside it. The first version of this type left
 * both out while the delegation passed them through at runtime — a declared
 * type disagreeing with its own value, where the loss appears only once a
 * consumer trusts the type.
 */
export interface ProviderModelOption {
  readonly value: string;
  readonly label: string;
  /** A shorter label, for controls too narrow for the full one. */
  readonly buttonLabel?: string;
  readonly description?: string;
  /** A heading to group this option under, where a picker separates them. */
  readonly group?: string;
  /** Which provider owns this option, where one dropdown mixes several. */
  readonly providerId?: string;
  /** This option's own mark, overriding the provider's. */
  readonly providerIcon?: ProviderChatIcon;
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

/**
 * **Why this is still built from a tab and not at the persistence barrier.**
 *
 * Every implementation takes its `conversationId` from the input rather than
 * from a bound conversation, which reads as though a conversation-scoped caller
 * could build one. Three cannot. OpenCode, MiMoCode and Kimi Code resolve a
 * database path, and Grok a session directory, through a context that reads
 * *the tab's last launch first* and the conversation's stored state only as a
 * fallback — so a caller without the tab writes the previous turn's path over
 * the one this turn established, silently, for exactly the providers whose
 * resume depends on it.
 *
 * The shape that closes it is the one `nativeSessionRef` already has:
 * `ExecutionSessionSnapshot` grows the provider's own state, the backend
 * reports it as it learns it, and the registry copies it into the session
 * record on every accepted envelope the way it copies the session ref today.
 * That is a control-record schema change plus three backends learning to report
 * what they resolve, which is a milestone rather than a move.
 */

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
  | 'environment';

/**
 * What Grimoire may do with one kind of workspace resource.
 *
 * **Two axes, because the settings surface reads them separately.** The first
 * version of this slot was a single `CapabilitySupport` per key — `'native'` or
 * `'grimoire'`, a statement about *who owns* the resource — and no consumer
 * asks that. What they ask is whether a list can be shown and whether it can be
 * written, and the two differ: Codex's MCP is `inventory: 'none'` with
 * `manager: 'guidance'`, meaning Grimoire cannot list its servers but does point
 * the user at where to set them up. One value cannot say that.
 *
 * The map also lost three keys — `cliResolution`, `models`, `usage`. They were
 * ownership statements with no consumer, and there is no honest
 * inventory-or-manager answer for them: a model is discovered, not listed from a
 * vault, and Grimoire's model settings are not a manager for the provider's
 * catalogue. A key nothing produces and nothing reads is a key that will be
 * filled by guessing.
 */
export interface ProviderWorkspaceCapability {
  /** Whether Grimoire can list what exists, and whether it may write it. */
  readonly inventory: 'managed' | 'readonly' | 'none';
  /** Whether Grimoire offers a manager for it, or only points at the provider's. */
  readonly manager: 'managed' | 'guidance' | 'none';
  /** How a live session's own commands are discovered, where that applies. */
  readonly runtimeCommandDiscovery?: 'active-session-only' | 'ephemeral' | 'none';
}

/** Absent means unsupported here too, so a provider declares only what it has. */
export type ProviderWorkspaceCapabilityMap = Readonly<
  Partial<Record<ProviderWorkspaceCapabilityKey, ProviderWorkspaceCapability>>
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
  readonly declarations: ProviderDeclarations;
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
