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
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '@/providers/antigravity/capabilities';
import { CLAUDE_PROVIDER_CAPABILITIES } from '@/providers/claude/capabilities';
import { CODEX_PROVIDER_CAPABILITIES } from '@/providers/codex/capabilities';
import { GEMINI_PROVIDER_CAPABILITIES } from '@/providers/gemini/capabilities';
import { GROK_PROVIDER_CAPABILITIES } from '@/providers/grok/capabilities';
import { KIMICODE_PROVIDER_CAPABILITIES } from '@/providers/kimicode/capabilities';
import { MIMOCODE_PROVIDER_CAPABILITIES } from '@/providers/mimocode/capabilities';
import { OPENCODE_PROVIDER_CAPABILITIES } from '@/providers/opencode/capabilities';
import { QWEN_PROVIDER_CAPABILITIES } from '@/providers/qwen/capabilities';

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
  /** Auxiliary services are registered but do nothing. */
  | 'noop';

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
  /** Module that owns auxiliary execution: a dedicated runner, or the noop services. */
  auxiliaryOwner: string;
  /**
   * Resources the chat path and the auxiliary path both touch.
   * A `contended` entry is a stop condition for that provider's flip.
   */
  sharedResources: SharedResource[];
  /**
   * The provider's own capability declaration, re-exported so the M2 smoke
   * matrix has one record to read. `capabilities.ts` stays canonical: this is a
   * reference, never a copy.
   */
  capabilities: Readonly<ProviderCapabilities>;
  /**
   * A literal string that must appear in `auxiliaryOwner`, proving the
   * isolation claim rather than pattern-matching around it.
   */
  isolationEvidence: string;
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
    auxiliary: 'noop',
    auxiliaryOwner: 'src/providers/antigravity/auxiliary/AntigravityNoopServices.ts',
    sharedResources: [
      {
        resource: 'auxiliary execution',
        sharing: 'partitioned',
        note: 'no auxiliary execution exists: title, refine, and inline edit are registered as no-ops, so contention is impossible by construction',
      },
    ],
    capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
    isolationEvidence: 'TitleGenerationService',
    evidence: [
      'src/providers/antigravity/execution/AntigravityExecutionBackend.ts',
      'src/providers/antigravity/auxiliary/AntigravityNoopServices.ts',
      'src/providers/antigravity/capabilities.ts',
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
      'src/providers/claude/runtime/ClaudeChatRuntime.ts',
      'src/providers/claude/runtime/claudeColdStartQuery.ts',
      'src/providers/claude/auxiliary/ClaudeTitleGenerationService.ts',
    ],
  },
  {
    providerId: 'codex',
    topology: 'persistent-daemon',
    sessionBoundary: 'native-thread',
    resume: 'native',
    concurrency: 'one app-server process multiplexing threads and turns',
    auxiliary: 'isolated',
    auxiliaryOwner: 'src/providers/codex/runtime/CodexAuxQueryRunner.ts',
    sharedResources: [
      {
        resource: 'Codex app-server process',
        sharing: 'partitioned',
        note: 'the auxiliary runner starts and owns its own app-server process and thread, documented at the class it lives on',
      },
      {
        resource: 'Codex session JSONL directory',
        sharing: 'partitioned',
        note: 'auxiliary threads are separate threads; the chat thread id is never reused',
      },
      {
        resource: 'codex CLI binary and user configuration',
        sharing: 'read-only',
        note: 'resolved identically by both paths, written by neither',
      },
    ],
    capabilities: CODEX_PROVIDER_CAPABILITIES,
    isolationEvidence: 'Manages its own process lifecycle',
    evidence: [
      'src/providers/codex/execution/CodexExecutionBackend.ts',
      'src/providers/codex/runtime/CodexAuxQueryRunner.ts',
      'src/providers/codex/runtime/CodexAppServerProcess.ts',
    ],
  },
  {
    providerId: 'gemini',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'noop',
    auxiliaryOwner: 'src/providers/gemini/auxiliary/GeminiNoopServices.ts',
    sharedResources: [
      {
        resource: 'auxiliary execution',
        sharing: 'partitioned',
        note: 'registered as no-ops; no auxiliary process or session exists',
      },
    ],
    capabilities: GEMINI_PROVIDER_CAPABILITIES,
    isolationEvidence: 'TitleGenerationService',
    evidence: [
      'src/providers/gemini/runtime/GeminiChatRuntime.ts',
      'src/providers/gemini/auxiliary/GeminiNoopServices.ts',
      'src/providers/gemini/capabilities.ts',
    ],
  },
  {
    providerId: 'grok',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime, with provider extensions',
    auxiliary: 'isolated',
    auxiliaryOwner: 'src/providers/grok/runtime/GrokAuxQueryRunner.ts',
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
    evidence: [
      'src/providers/grok/runtime/GrokChatRuntime.ts',
      'src/providers/grok/runtime/GrokAuxQueryRunner.ts',
      'src/providers/grok/runtime/GrokPaths.ts',
    ],
  },
  {
    providerId: 'kimicode',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'isolated',
    auxiliaryOwner: 'src/providers/kimicode/runtime/KimicodeAuxQueryRunner.ts',
    sharedResources: MANAGED_ACP_SHARED_RESOURCES('kimicode'),
    capabilities: KIMICODE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'kimicode/auxiliary/',
    evidence: [
      'src/providers/kimicode/runtime/KimicodeChatRuntime.ts',
      'src/providers/kimicode/runtime/KimicodeAuxQueryRunner.ts',
      'src/providers/kimicode/runtime/KimicodeLaunchArtifacts.ts',
    ],
  },
  {
    providerId: 'mimocode',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'isolated',
    auxiliaryOwner: 'src/providers/mimocode/runtime/MimocodeAuxQueryRunner.ts',
    sharedResources: MANAGED_ACP_SHARED_RESOURCES('mimocode'),
    capabilities: MIMOCODE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'mimocode/auxiliary/',
    evidence: [
      'src/providers/mimocode/runtime/MimocodeChatRuntime.ts',
      'src/providers/mimocode/runtime/MimocodeAuxQueryRunner.ts',
      'src/providers/mimocode/runtime/MimocodeLaunchArtifacts.ts',
    ],
  },
  {
    providerId: 'opencode',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'isolated',
    auxiliaryOwner: 'src/providers/opencode/runtime/OpencodeAuxQueryRunner.ts',
    sharedResources: MANAGED_ACP_SHARED_RESOURCES('opencode'),
    capabilities: OPENCODE_PROVIDER_CAPABILITIES,
    isolationEvidence: 'opencode/auxiliary/',
    evidence: [
      'src/providers/opencode/runtime/OpencodeChatRuntime.ts',
      'src/providers/opencode/runtime/OpencodeAuxQueryRunner.ts',
      'src/providers/opencode/runtime/OpencodeLaunchArtifacts.ts',
    ],
  },
  {
    providerId: 'qwen',
    topology: 'managed-acp-subprocess',
    sessionBoundary: 'acp-session',
    resume: 'native',
    concurrency: 'one ACP session per conversation runtime',
    auxiliary: 'noop',
    auxiliaryOwner: 'src/providers/qwen/auxiliary/QwenNoopServices.ts',
    sharedResources: [
      {
        resource: 'auxiliary execution',
        sharing: 'partitioned',
        note: 'registered as no-ops; no auxiliary process or session exists',
      },
    ],
    capabilities: QWEN_PROVIDER_CAPABILITIES,
    isolationEvidence: 'TitleGenerationService',
    evidence: [
      'src/providers/qwen/runtime/QwenChatRuntime.ts',
      'src/providers/qwen/auxiliary/QwenNoopServices.ts',
      'src/providers/qwen/capabilities.ts',
    ],
  },
];
