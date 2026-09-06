import { agentFidelityFromCapabilities } from '@/core/agents/AgentFidelity';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

/**
 * What the agent domain may assume about a provider, and where it comes from.
 *
 * **Every field is a projection and none is inferred**, which is the property
 * worth holding: a fidelity profile that guessed would let the domain cancel an
 * agent a provider cannot cancel, or wait for a status nothing answers. So the
 * rule is asserted against the descriptor rather than against a copy of today's
 * values — a copy is a second declaration, and the harvest this came from
 * carried one that had already drifted: it expected Grok to observe aggregate
 * progress with a stable identity and Qwen to observe opaquely, and this
 * branch's catalog says `none` for both.
 */
describe('AgentFidelity', () => {
  const modules = builtInProviderCatalog.list();

  it('reads the catalog it is meant to be projecting', () => {
    // Guards every assertion below: an empty catalog satisfies a per-module
    // rule for the same reason a correct one does.
    expect(modules).toHaveLength(9);
  });

  it.each(modules.map(module => [module.manifest.id, module] as const))(
    '%s projects its capabilities and infers nothing',
    (_id, module) => {
      const agents = module.capabilities.agents;

      expect(agentFidelityFromCapabilities(module.capabilities)).toEqual({
        definitions: agents.definitions,
        nativeSpawn: agents.spawnOrigin.includes('provider-native'),
        stableIdentity: agents.stableIdentity,
        observation: agents.progressObservation,
        resultExtraction: agents.resultExtraction,
        cancellation: agents.cancellation,
        statusQuery: agents.statusQuery,
        reattachment: agents.reattachment,
      });
    },
  );

  it('says in one place how much of an agent each provider lets us see', () => {
    // The load-bearing field, printed by being asserted: a provider that
    // quietly changes what it claims to observe changes what the domain is
    // allowed to promise a person about work running out of sight.
    expect(modules.map(module => (
      `${module.manifest.id}: ${agentFidelityFromCapabilities(module.capabilities).observation}`
    // In the catalog's own order, which is the order providers are presented
    // in, so this line reads the way the settings list does.
    ))).toEqual([
      'claude: full',
      'codex: aggregate',
      'opencode: none',
      'grok: none',
      'mimocode: none',
      'kimicode: none',
      'antigravity: none',
      'gemini: none',
      'qwen: none',
    ]);
  });

  it('freezes the profile it answers with', () => {
    // Read by policy decisions and by the UI; a caller that mutated one would
    // change what every later caller is told a provider supports.
    const profile = agentFidelityFromCapabilities(modules[0].capabilities);

    expect(Object.isFrozen(profile)).toBe(true);
  });
});
