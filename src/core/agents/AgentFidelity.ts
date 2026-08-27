import type {
  ProviderAgentDefinitionInventory,
  ProviderAgentObservation,
  ProviderCapabilityDescriptor,
} from '../providers/ProviderModule';
import type { AgentObservationFidelity } from './AgentContracts';

/**
 * What the agent domain may assume about a provider, read from its capabilities.
 *
 * A projection rather than a second declaration: every field here comes from
 * `ProviderCapabilityDescriptor.agents`, so a provider that gains or loses an
 * agent capability changes this by changing the one place it is declared.
 *
 * **Reconciled from the v1 harvest rather than copied.** That version read
 * `definitionInventory`, `spawnOrigins`, `observation` and four
 * `CapabilitySupport` values; M3's catalog renamed the first three and narrowed
 * the last four to booleans. Keeping the harvest's names would have meant a
 * second vocabulary for the same facts, which is how a descriptor and the thing
 * that reads it start disagreeing.
 */

export interface AgentFidelityProfile {
  readonly definitions: ProviderAgentDefinitionInventory;
  /** Whether the provider can start an agent of its own accord. */
  readonly nativeSpawn: boolean;
  /** Whether an agent keeps one id across the turns it runs in. */
  readonly stableIdentity: boolean;
  readonly observation: AgentObservationFidelity;
  readonly resultExtraction: boolean;
  readonly cancellation: boolean;
  readonly statusQuery: boolean;
  readonly reattachment: boolean;
}

export function agentFidelityFromCapabilities(
  descriptor: ProviderCapabilityDescriptor,
): AgentFidelityProfile {
  const agents = descriptor.agents;
  return Object.freeze({
    definitions: agents.definitions,
    nativeSpawn: agents.spawnOrigin.includes('provider-native'),
    stableIdentity: agents.stableIdentity,
    observation: normalizeObservation(agents.progressObservation),
    resultExtraction: agents.resultExtraction,
    cancellation: agents.cancellation,
    statusQuery: agents.statusQuery,
    reattachment: agents.reattachment,
  });
}

/**
 * The descriptor's word for how much of an agent's progress is visible, as the
 * agent domain's own.
 *
 * They are the same union today, and the conversion exists so they can stop
 * being: the descriptor answers what a provider *reports*, and fidelity is what
 * the domain may *rely on*, which is the narrower question the moment any
 * provider reports something it cannot sustain.
 */
function normalizeObservation(observation: ProviderAgentObservation): AgentObservationFidelity {
  return observation;
}
