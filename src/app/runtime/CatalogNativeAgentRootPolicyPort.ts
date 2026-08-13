import type { AgentDispatchPolicyInputs } from '../../core/agents/AgentCoordinator';
import type { ExecutionOwner } from '../../core/execution/ExecutionContracts';
import type { ProviderCatalog } from '../../core/providers/ProviderCatalog';
import type { ProviderId } from '../../core/types/provider';
import type { NativeAgentRootPolicyPort } from './NativeAgentLifecycleBridge';

const FULL_BOUNDARY = Object.freeze({
  granted: ['*'] as readonly string[],
  approvable: [] as readonly string[],
});

const EMPTY_REQUEST = Object.freeze({
  requested: [] as readonly string[],
  approvable: [] as readonly string[],
});

/**
 * Default root policy that grants the intersection-bounded full boundary for
 * native agent dispatch. The effective policy is still intersected by provider,
 * workspace, root, parent, and definition allowances inside the agent
 * coordinator. This adapter resolves the root-level inputs only.
 */
export class CatalogNativeAgentRootPolicyPort implements NativeAgentRootPolicyPort {
  constructor(_catalog: ProviderCatalog) {}

  async resolve(input: {
    readonly providerId: ProviderId;
    readonly owner: ExecutionOwner;
  }): Promise<AgentDispatchPolicyInputs> {
    void input;
    return Object.freeze({
      provider: FULL_BOUNDARY,
      workspace: FULL_BOUNDARY,
      root: FULL_BOUNDARY,
      definition: EMPTY_REQUEST,
    });
  }
}
