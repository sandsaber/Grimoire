import type { ProviderCapabilities } from '../../core/providers/types';

export const ANTIGRAVITY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'antigravity',
  supportsPersistentRuntime: false,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: false,
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
