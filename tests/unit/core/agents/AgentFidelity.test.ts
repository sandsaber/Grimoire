import { agentFidelityFromCapabilities } from '@/core/agents/AgentFidelity';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

describe('AgentFidelity', () => {
  it('maps every provider capability without inferring unsupported agent actions', () => {
    expect(Object.fromEntries(builtInProviderCatalog.list().map(module => [
      module.manifest.id,
      agentFidelityFromCapabilities(module.capabilities),
    ]))).toEqual({
      claude: expect.objectContaining({ observation: 'full', stableIdentity: true }),
      codex: expect.objectContaining({
        observation: 'aggregate',
        stableIdentity: true,
        cancellation: 'unsupported',
        statusQuery: 'unsupported',
        reattachment: 'unsupported',
      }),
      opencode: expect.objectContaining({ observation: 'none', stableIdentity: false }),
      grok: expect.objectContaining({ observation: 'aggregate', stableIdentity: true }),
      mimocode: expect.objectContaining({ observation: 'none', stableIdentity: false }),
      kimicode: expect.objectContaining({ observation: 'none', stableIdentity: false }),
      antigravity: expect.objectContaining({ observation: 'none', stableIdentity: false }),
      gemini: expect.objectContaining({ observation: 'none', stableIdentity: false }),
      qwen: expect.objectContaining({
        observation: 'opaque',
        stableIdentity: false,
        cancellation: 'unsupported',
        statusQuery: 'unsupported',
        reattachment: 'unsupported',
      }),
    });
  });
});
