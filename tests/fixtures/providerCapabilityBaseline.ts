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
  supportsPersistentRuntime: false,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  // Raised on `main` at the image-attachment feature and carried here with it:
  // `agy` has no image flag, so Grimoire writes each attachment to a temp file
  // and names the absolute path in the prompt. The descriptor says the same in
  // its own language — `imageAttachments: 'grimoire'` — so this is a baseline
  // that moved, not a divergence to declare.
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsTurnSteer: false,
  // Declared 'none' because nothing in the print path reads an effort level.
  // `agy` takes no flag for it and the prompt composer ignores it, so the
  // picker changed a settings field and nothing else — a control that promises
  // the model will think harder and does not ask it to. Gemini declares 'none'
  // for the same reason. Restore the tiers when the CLI exposes a flag.
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
  supportsTurnSteer: false,
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
