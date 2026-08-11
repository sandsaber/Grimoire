import type { ProviderCapabilities } from '../../core/providers/types';

export const GROK_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'grok',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  // ACP sessions receive the provider's full enabled MCP set. Per-turn @mention
  // selection is unavailable until ACP exposes a matching session update.
  supportsMcpTools: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
