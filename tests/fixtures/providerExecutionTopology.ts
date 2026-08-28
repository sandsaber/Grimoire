import {
  ANTIGRAVITY_PROVIDER_CAPABILITIES,
  CLAUDE_PROVIDER_CAPABILITIES,
  CODEX_PROVIDER_CAPABILITIES,
  GEMINI_PROVIDER_CAPABILITIES,
  GROK_PROVIDER_CAPABILITIES,
  KIMICODE_PROVIDER_CAPABILITIES,
  MIMOCODE_PROVIDER_CAPABILITIES,
  OPENCODE_PROVIDER_CAPABILITIES,
  QWEN_PROVIDER_CAPABILITIES,
} from '@test/fixtures/providerCapabilityBaseline';

/**
 * Per-provider execution topology and shared-resource inventory.
 *
 * Source of truth for `docs/provider-capability-topology.md`, and the input the
 * M2 flip's auxiliary-contention check verifies against mechanically. It is a
 * fixture rather than prose because "we checked that the auxiliary path does
 * not share the chat session" has to be a comparison against something, not a
 * recollection.
 *
 * Every claim here is read off the code cited in `evidence`. When a provider's
 * runtime changes, this record moves with it or the fitness test fails.
 *
 * It is also the single machine-readable capability record the M2 flip smoke
 * matrix reads: `capabilities` re-exports each provider's own declaration, so
 * "exercise every capability the provider declares" has one place to read
 * rather than a fixture for topology and a separate hunt through each
 * provider's own capabilities module.
 */
import type { ProviderCapabilities } from '@/core/providers/types';

export type ProcessTopology =
  /** One short-lived process per run, no reusable session. */
  | 'process-per-run'
  /** One long-lived daemon multiplexing threads or turns. */
  | 'persistent-daemon'
  /** One long-lived in-process SDK stream. */
  | 'persistent-sdk-stream'
  /** A managed subprocess speaking ACP, with a session established over it. */
  | 'managed-acp-subprocess';

export type SessionBoundary =
  | 'none'
  | 'native-thread'
  | 'native-sdk-session'
  | 'acp-session';

export type ResumeSupport =
  /** The provider can resume its own session by id. */
  | 'native'
  /** No native resume; the prompt or history is reconstructed by Grimoire. */
  | 'reconstructed'
  | 'none';

export type AuxiliaryExecution =
  /** Auxiliary services exist and run on their own process or session. */
  | 'isolated'
  /**
   * The same isolation, owned by the execution kernel rather than by a runner
   * of the provider's own.
   *
   * Distinguished because what proves the isolation is different: a dedicated
   * runner proves it by existing, while a composition that serves both paths
   * has to show the auxiliary launch being built separately — and **what that
   * looks like is the provider's**, which is why the lines to look for are
   * recorded per provider in `auxiliaryWiring` rather than assumed. The ACP
   * providers isolate with their own client factory and filesystem policy;
   * Codex has neither, and isolates on the thread it starts.
   */
  | 'kernel-isolated'
  /**
   * The provider contributes no auxiliary source, so it has no auxiliary
   * execution at all.
   *
   * It was `'noop'` and proved by a file named `*NoopServices.ts`: three
   * providers shipped three classes each that answered every auxiliary request
   * with the same refusal. The absence is the contribution now, and what proves
   * it is the application's own source map — a provider that is not in it
   * cannot run auxiliary work, which no file can accidentally stop being true
   * of.
   */
  | 'absent';

export interface SharedResource {
  /** What both paths touch. */
  resource: string;
  /** `read-only` and `partitioned` are safe; `contended` is a flip blocker. */
  sharing: 'read-only' | 'partitioned' | 'contended';
  /** Why the sharing is safe, or what makes it dangerous. */
  note: string;
}

export interface ProviderExecutionTopology {
  providerId: string;
  topology: ProcessTopology;
  sessionBoundary: SessionBoundary;
  resume: ResumeSupport;
  /** How more than one concurrent turn is served, in the provider's own terms. */
  concurrency: string;
  auxiliary: AuxiliaryExecution;
  /**
   * Module that owns auxiliary execution: a dedicated runner, the provider's
   * composition, or — for a provider with none — the application composition
   * whose source map leaves it out.
   */
  auxiliaryOwner: string;
  /**
   * Resources the chat path and the auxiliary path both touch.
   * A `contended` entry is a stop condition for that provider's flip.
   */
  sharedResources: SharedResource[];
  /**
   * The record the UI reads, re-exported so the M2 smoke matrix has one place
   * to read it. The module's `ProviderCapabilityDescriptor` is the declaration;
   * this points at the M3 baseline the projection is checked against.
   */
  capabilities: Readonly<ProviderCapabilities>;
  /**
   * A literal string that must appear in `auxiliaryOwner`, proving the
   * isolation claim rather than pattern-matching around it.
   *
   * An `absent` provider proves something different — that it contributes no
   * auxiliary source at all — so there the owner's own source map is read and
   * this line only says which claim is being made.
   */
  isolationEvidence: string;
  /**
   * The lines that prove this provider's auxiliary launch is its own.
   *
   * Literal strings, read out of `auxiliaryOwner`. Required for a
   * `kernel-isolated` provider, because there the same object serves both paths
   * and "not the chat runtime" proves nothing. What they say differs by
   * provider on purpose: an ACP composition is proven by the client factory it
   * wires the auxiliary path to, and Codex by the parameters its auxiliary
   * thread is started with.
   */
  auxiliaryWiring?: readonly string[];
  /** Modules the claims above were read from. */
  evidence: string[];
}

const MANAGED_ACP_SHARED_RESOURCES = (providerId: string): SharedResource[] => [
  {
    resource: `.grimoire/${providerId}/ launch artifacts and managed home`,
    sharing: 'partitioned',
    note: `chat writes under \`${providerId}\`, auxiliary under \`${providerId}/auxiliary/<purpose>\`, so the two never share a managed home`,
  },
  {
    resource: 'ACP subprocess and JSON-RPC transport',
    sharing: 'partitioned',
    note: 'the auxiliary runner owns its own subprocess, transport, and session id; nothing is borrowed from the chat runtime',
  },
  {
    resource: 'provider CLI binary and its user-level configuration',
    sharing: 'read-only',
    note: 'both paths resolve and launch the same binary; neither writes its configuration',
  },
];

export const PROVIDER_EXECUTION_TOPOLOGY: ProviderExecutionTopology[] = [
  {
    providerId: 'antigravity',
    topology: 'process-per-run',
    sessionBoundary: 'none',
    resume: 'reconstructed',
    concurrency: 'one process per run; concurrent turns are concurrent processes',
    auxiliary: 'absent',
    auxiliaryOwner: 'src/app/ApplicationRuntime.ts',
    sharedResources: [
      {
        resource: 'auxiliary execution',
        sharing: 'partitioned',
        note: 'no auxiliary execution exists: title, refine, and inline edit are registered as no-ops, so contention is impossible by construction',
      },
    ],
    capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
    isolationEvidence: 'Absent means unsupported',
    evidence: [
      'src/providers/antigravity/execution/AntigravityExecutionBackend.ts',
    ],
  },
  {
    providerId: 'claude',
    topology: 'persistent-sdk-stream',
    sessionBoundary: 'native-sdk-session',
    resume: 'native',
    concurrency: 'one SDK query stream per conversation runtime',
    auxiliary: 'isolated',
    auxiliaryOwner: 'src/providers/claude/runtime/claudeColdStartQuery.ts',
    sharedResources: [
      {
        resource: 'Claude SDK session files',
        sharing: 'partitioned',
        note: 'auxiliary queries run cold with `persistSession: false`, so they never write a session the chat path reads',
      },
      {
        resource: '.claude/ project configuration and permissions',
        sharing: 'read-only',
        note: 'both paths read the same project settings; neither mutates them during a turn',
      },
    ],
    capabilities: CLAUDE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'persistSession',
    evidence: [
      'src/providers/claude/execution/ClaudeExecutionBackend.ts',
      'src/providers/claude/runtime/claudeColdStartQuery.ts',
      'src/providers/claude/auxiliary/ClaudeAuxQueryRunner.ts',
    ],
  },
  {
    providerId: 'codex',
    topology: 'persistent-daemon',
    sessionBoundary: 'native-thread',
    resume: 'native',
    concurrency: 'one app-server process multiplexing threads and turns',
    // Auxiliary work on the kernel, and the last provider to get there. Not
    // built like the ACP compositions: there is no client factory to separate
    // and no filesystem to contain, so the isolation is on the thread.
    auxiliary: 'kernel-isolated',
    auxiliaryOwner: 'src/providers/codex/execution/CodexExecutionComposition.ts',
    sharedResources: [
      {
        resource: 'Codex app-server process',
        sharing: 'partitioned',
        note: 'the auxiliary query launches a connection of its own per retained conversation; a chat daemon is never borrowed',
      },
      {
        resource: 'Codex session JSONL directory',
        sharing: 'partitioned',
        note: 'auxiliary threads are separate threads and are started with `persistExtendedHistory: false`, so they are not written where the chat path reads',
      },
      {
        resource: 'codex CLI binary and user configuration',
        sharing: 'read-only',
        note: 'resolved identically by both paths, written by neither',
      },
    ],
    capabilities: CODEX_PROVIDER_CAPABILITIES,
    isolationEvidence: 'approvalPolicy: \'never\'',
    auxiliaryWiring: [
      // What makes an unattended Codex turn safe, all three on `thread/start`:
      // it cannot approve, it cannot write, and it is not recorded where the
      // conversation's own transcript is read from.
      "approvalPolicy: 'never'",
      "sandbox: 'read-only'",
      'persistExtendedHistory: false',
    ],
    evidence: [
      'src/providers/codex/execution/CodexExecutionBackend.ts',
      'src/providers/codex/execution/CodexAuxiliaryQuery.ts',
      'src/providers/codex/runtime/CodexAppServerProcess.ts',
    ],
  },
  {
    providerId: 'gemini',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'absent',
    auxiliaryOwner: 'src/app/ApplicationRuntime.ts',
    sharedResources: [
      {
        resource: 'auxiliary execution',
        sharing: 'partitioned',
        note: 'registered as no-ops; no auxiliary process or session exists',
      },
    ],
    capabilities: GEMINI_PROVIDER_CAPABILITIES,
    isolationEvidence: 'Absent means unsupported',
    evidence: [
      'src/providers/gemini/execution/GeminiExecutionBackend.ts',
    ],
  },
  {
    providerId: 'grok',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime, with provider extensions',
    // Auxiliary work on the kernel, like the three OpenCode forks — but not
    // built the way they are: there is no managed agent to run as here, so the
    // launch carries the policy and the client carries what may be read.
    auxiliary: 'kernel-isolated',
    auxiliaryOwner: 'src/providers/grok/execution/GrokExecutionComposition.ts',
    sharedResources: [
      ...MANAGED_ACP_SHARED_RESOURCES('grok'),
      {
        resource: 'GROK_HOME managed home directory',
        sharing: 'partitioned',
        note: 'derived from the artifacts subdirectory, so the auxiliary purpose gets its own home',
      },
    ],
    capabilities: GROK_PROVIDER_CAPABILITIES,
    isolationEvidence: 'grok/auxiliary/',
    auxiliaryWiring: [
      // **The wiring, not the presence.** Read as a line rather than as two
      // names in a file, because the failure this guards against is the
      // auxiliary path being pointed at the chat factory while both methods
      // still exist and both still read correctly on their own.
      'this.auxiliaryClientFactory ??= this.injectedClientFactory ?? this.createAuxiliaryFactory()',
      'AuxiliaryFileSystem(',
    ],
    evidence: [
      'src/providers/grok/execution/GrokExecutionBackend.ts',
      'src/providers/acp/execution/ManagedAcpAuxiliaryQuery.ts',
      'src/providers/grok/execution/GrokAuxiliaryFileSystem.ts',
      'src/providers/grok/runtime/GrokLaunchArtifacts.ts',
      'src/providers/grok/runtime/GrokPaths.ts',
    ],
  },
  {
    providerId: 'kimicode',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    // The third fork of the same CLI, and the third auxiliary path on the
    // kernel: these three do not diverge.
    auxiliary: 'kernel-isolated',
    auxiliaryOwner: 'src/providers/kimicode/execution/KimicodeExecutionComposition.ts',
    sharedResources: MANAGED_ACP_SHARED_RESOURCES('kimicode'),
    capabilities: KIMICODE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'kimicode/auxiliary/',
    auxiliaryWiring: [
      // **The wiring, not the presence.** Read as a line rather than as two
      // names in a file, because the failure this guards against is the
      // auxiliary path being pointed at the chat factory while both methods
      // still exist and both still read correctly on their own.
      'this.auxiliaryClientFactory ??= this.injectedClientFactory ?? this.createAuxiliaryFactory()',
      'AuxiliaryFileSystem(',
    ],
    evidence: [
      'src/providers/kimicode/execution/KimicodeExecutionBackend.ts',
      'src/providers/acp/execution/ManagedAcpAuxiliaryQuery.ts',
      'src/providers/kimicode/execution/KimicodeAuxiliaryFileSystem.ts',
      'src/providers/kimicode/runtime/KimicodeAuxiliaryAgents.ts',
      'src/providers/kimicode/runtime/KimicodeLaunchArtifacts.ts',
    ],
  },
  {
    providerId: 'mimocode',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    // Auxiliary work on the kernel, like OpenCode's and for the same reason:
    // these two do not diverge. The owner is the composition, which decides the
    // launch — its own artifacts per purpose, its own agent, its own factory.
    auxiliary: 'kernel-isolated',
    auxiliaryOwner: 'src/providers/mimocode/execution/MimocodeExecutionComposition.ts',
    sharedResources: MANAGED_ACP_SHARED_RESOURCES('mimocode'),
    capabilities: MIMOCODE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'mimocode/auxiliary/',
    auxiliaryWiring: [
      // **The wiring, not the presence.** Read as a line rather than as two
      // names in a file, because the failure this guards against is the
      // auxiliary path being pointed at the chat factory while both methods
      // still exist and both still read correctly on their own.
      'this.auxiliaryClientFactory ??= this.injectedClientFactory ?? this.createAuxiliaryFactory()',
      'AuxiliaryFileSystem(',
    ],
    evidence: [
      'src/providers/mimocode/execution/MimocodeExecutionBackend.ts',
      'src/providers/acp/execution/ManagedAcpAuxiliaryQuery.ts',
      'src/providers/mimocode/execution/MimocodeAuxiliaryFileSystem.ts',
      'src/providers/mimocode/runtime/MimocodeAuxiliaryAgents.ts',
      'src/providers/mimocode/runtime/MimocodeLaunchArtifacts.ts',
    ],
  },
  {
    providerId: 'opencode',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    // The first provider whose auxiliary work runs on the kernel. The owner is
    // the composition, because that is what decides the launch: its own
    // artifacts directory per purpose, its own agent, and its own client
    // factory — the one an auxiliary turn is contained by whatever the chat is
    // set to.
    auxiliary: 'kernel-isolated',
    auxiliaryOwner: 'src/providers/opencode/execution/OpencodeExecutionComposition.ts',
    sharedResources: MANAGED_ACP_SHARED_RESOURCES('opencode'),
    capabilities: OPENCODE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'opencode/auxiliary/',
    auxiliaryWiring: [
      // **The wiring, not the presence.** Read as a line rather than as two
      // names in a file, because the failure this guards against is the
      // auxiliary path being pointed at the chat factory while both methods
      // still exist and both still read correctly on their own.
      'this.auxiliaryClientFactory ??= this.injectedClientFactory ?? this.createAuxiliaryFactory()',
      'AuxiliaryFileSystem(',
    ],
    evidence: [
      'src/providers/opencode/execution/OpencodeExecutionBackend.ts',
      'src/providers/acp/execution/ManagedAcpAuxiliaryQuery.ts',
      'src/providers/opencode/execution/OpencodeAuxiliaryFileSystem.ts',
      'src/providers/opencode/runtime/OpencodeAuxiliaryAgents.ts',
      'src/providers/opencode/runtime/OpencodeLaunchArtifacts.ts',
    ],
  },
  {
    providerId: 'qwen',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'absent',
    auxiliaryOwner: 'src/app/ApplicationRuntime.ts',
    sharedResources: [
      {
        resource: 'auxiliary execution',
        sharing: 'partitioned',
        note: 'registered as no-ops; no auxiliary process or session exists',
      },
    ],
    capabilities: QWEN_PROVIDER_CAPABILITIES,
    isolationEvidence: 'Absent means unsupported',
    evidence: [
      'src/providers/qwen/execution/QwenExecutionBackend.ts',
    ],
  },
];
