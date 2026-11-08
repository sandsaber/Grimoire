import type { ProviderCapabilities } from '@/core/providers/types';

/**
 * The capability record each provider's UI reads, as it stood when the gating
 * moved onto the module descriptors at M3.
 *
 * Copied verbatim from the nine `src/providers/<id>/capabilities.ts` files this
 * commit deletes, and kept here for one reason: the projection from a
 * descriptor is only trustworthy against something it cannot also change.
 * Deriving the expectation from the descriptor would assert that the code
 * equals itself.
 *
 * Editing a value here is declaring a product change. The parity test in
 * `tests/unit/core/runtime/execution/ExecutionAdapterConformance.test.ts`
 * compares every field of every provider against it.
 */

export const ANTIGRAVITY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'antigravity',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  // ACP sends native blocks. The print fallback supplies temporary image files.
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  // The selected model variant carries its thinking level.
  reasoningControl: 'none',
});

export const CLAUDE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'claude',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: true,
  supportsFork: true,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
  planPathPrefix: '/.claude/plans/',
});

export const CODEX_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'codex',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: true,
  supportsProviderCommands: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
});

export const GEMINI_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'gemini',
  supportsPersistentRuntime: true,
  // Resume uses ACP loadSession + Grimoire-persisted messages only; no native
  // transcript store is hydrated yet.
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  // Effort UI is exposed for session discovery, but the runtime only applies
  // model selection until Gemini ACP effort options are wired end-to-end.
  reasoningControl: 'none',
});

export const GROK_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'grok',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: true,
  supportsFork: true,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  // ACP sessions receive the provider's full enabled MCP set. Per-turn @mention
  // selection is unavailable until ACP exposes a matching session update.
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});

export const KIMICODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'kimicode',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});

export const MIMOCODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'mimocode',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});

export const OPENCODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'opencode',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});

export const QWEN_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'qwen',
  supportsPersistentRuntime: true,
  // Resume uses ACP loadSession + Grimoire-persisted messages only; no native
  // transcript store is hydrated yet.
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  // Commands are enabled only after Qwen emits ACP available_commands_update;
  // the runtime otherwise returns an empty command list.
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});

export const DEVIN_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'devin',
  supportsPersistentRuntime: true,
  // Resume uses ACP loadSession + Grimoire-persisted messages only; the
  // replay a `session/load` sends is not read back.
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  // The session announces its own commands on `session/new` (recorded).
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'none',
});

export const REASONIX_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'reasonix',
  supportsPersistentRuntime: true,
  // Resume uses ACP loadSession + Grimoire-persisted messages only; the
  // replay a `session/load` sends is not read back.
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  // The session announces its own commands on `session/new` (recorded).
  supportsProviderCommands: true,
  // `promptCapabilities.image` is false in the recorded handshake.
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  // `_reasonix.io/session/steer` exists and nothing drives it yet.
  supportsTurnSteer: false,
  // Driven, and discovered per session: which levels a model takes is decided
  // by the provider block serving it, so the picker is fed from the session's
  // own `effort` option rather than from a list written here.
  reasoningControl: 'effort',
});
