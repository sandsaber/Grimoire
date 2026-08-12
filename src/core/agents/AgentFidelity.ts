import type {
  CapabilitySupport,
  ProviderAgentObservation,
  ProviderCapabilityDescriptor,
} from '../providers/ProviderModule';
import type { AgentObservationFidelity } from './AgentContracts';

export interface AgentFidelityProfile {
  readonly definitionInventory: 'native' | 'provider-files' | 'none';
  readonly nativeSpawn: boolean;
  readonly stableIdentity: boolean;
  readonly observation: AgentObservationFidelity;
  readonly resultExtraction: CapabilitySupport;
  readonly cancellation: CapabilitySupport;
  readonly statusQuery: CapabilitySupport;
  readonly reattachment: CapabilitySupport;
}

export function agentFidelityFromCapabilities(
  descriptor: ProviderCapabilityDescriptor,
): AgentFidelityProfile {
  const agents = descriptor.agents;
  return Object.freeze({
    definitionInventory: agents.definitionInventory,
    nativeSpawn: agents.spawnOrigins.includes('provider-native'),
    stableIdentity: agents.stableIdentity,
    observation: normalizeObservation(agents.observation),
    resultExtraction: agents.resultExtraction,
    cancellation: agents.cancellation,
    statusQuery: agents.statusQuery,
    reattachment: agents.reattachment,
  });
}

function normalizeObservation(observation: ProviderAgentObservation): AgentObservationFidelity {
  return observation;
}
