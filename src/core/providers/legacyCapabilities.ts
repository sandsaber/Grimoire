import type { CapabilitySupport,ProviderCapabilityDescriptor } from './ProviderModule';
import type { ProviderCapabilities } from './types';

/**
 * Projects the descriptor onto the capability record the UI reads.
 *
 * The descriptor is the declaration; this is the shape the chat feature has
 * always consumed, kept until the UI reads capability fields directly. Every
 * field is derived from something the descriptor states, so a missing answer is
 * a missing descriptor field rather than an invented default.
 *
 * It took a `reasoningControl` argument until M3, because the descriptor had no
 * such field and the caller passed the legacy record's — which made the one
 * field the projection could not check the one field it copied.
 */
export function toLegacyCapabilities(
  descriptor: ProviderCapabilityDescriptor,
): Readonly<ProviderCapabilities> {
  const supported = (support: CapabilitySupport): boolean => support !== 'unsupported';
  return Object.freeze({
    providerId: descriptor.providerId,
    supportsPersistentRuntime: descriptor.process.topology !== 'process-per-run',
    supportsNativeHistory: descriptor.history.ownership === 'provider-native',
    supportsPlanMode: supported(descriptor.interactions.planMode),
    supportsRewind: supported(descriptor.conversation.rewind),
    supportsFork: supported(descriptor.conversation.fork),
    // From `sessionCommands`, which is the only one of the three command fields
    // this boolean has ever gated: `getSdkCommands` returns before it reaches a
    // catalog when this is false. Mapping from `discovery` would have turned
    // Codex's on at its flip; mapping from `chatSurface` would have turned
    // Gemini's session commands on here.
    supportsProviderCommands: supported(descriptor.commands.sessionCommands),
    supportsImageAttachments: supported(descriptor.input.imageAttachments),
    supportsInstructionMode: supported(descriptor.input.instructionMode),
    // The boolean the UI reads gates the per-run server selector and nothing
    // else, which is why it maps from that field rather than from ownership —
    // OpenCode owns Grimoire-managed MCP and still has no selector.
    supportsMcpTools: supported(descriptor.mcp.perRunSelection),
    supportsTurnSteer: supported(descriptor.conversation.steering),
    reasoningControl: descriptor.reasoningControl.kind,
    ...(descriptor.interactions.planArtifactPrefix
      ? { planPathPrefix: descriptor.interactions.planArtifactPrefix }
      : {}),
  });
}
