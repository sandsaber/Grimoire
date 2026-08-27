import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { createGeminiModuleContext } from '@/providers/gemini/app/GeminiModuleContext';
import { createGrokModuleContext } from '@/providers/grok/app/GrokModuleContext';
import { createKimicodeModuleContext } from '@/providers/kimicode/app/KimicodeModuleContext';
import { createMimocodeModuleContext } from '@/providers/mimocode/app/MimocodeModuleContext';
import { createOpencodeModuleContext } from '@/providers/opencode/app/OpencodeModuleContext';
import { createQwenModuleContext } from '@/providers/qwen/app/QwenModuleContext';

/**
 * Each provider's workspace slots, reaching each provider's own services.
 *
 * The implementation behind them is shared, which is the point — nine copies of
 * nine questions is what this migration keeps deleting. The risk a shared
 * implementation creates is the opposite one: a provider wired to *another*
 * provider's services accessor, which would list Kimi Code's MCP servers under
 * Grok and be invisible to any test that only checked the shape of the answer.
 *
 * So every provider is registered with a marker only it could return.
 */
describe('provider workspace context slots', () => {
  interface Wiring {
    readonly build: (plugin: never) => {
      listCommands(): Promise<readonly unknown[]>;
      listModels(): Promise<readonly unknown[]>;
      loadMcpServers(): Promise<readonly { id: string }[]>;
      cachedPlanUsage(): unknown;
    };
    readonly providerId: string;
  }

  const ports = { sessionCommands: () => [], sessionPaths: () => ({}) } as never;

  const WIRINGS: readonly Wiring[] = [
    { build: p => createGeminiModuleContext(p, () => null), providerId: 'gemini' },
    { build: p => createGrokModuleContext(p, () => null, ports), providerId: 'grok' },
    { build: p => createKimicodeModuleContext(p, () => null, ports), providerId: 'kimicode' },
    { build: p => createMimocodeModuleContext(p, () => null, ports), providerId: 'mimocode' },
    { build: p => createOpencodeModuleContext(p, () => null, ports), providerId: 'opencode' },
    { build: p => createQwenModuleContext(p, () => null, ports), providerId: 'qwen' },
  ];

  function plugin(): never {
    return { getResolvedProviderCliPath: () => null, settings: {} } as never;
  }

  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
  });

  it.each(WIRINGS)('$providerId reads its own workspace services', async ({ build, providerId }) => {
    for (const wiring of WIRINGS) {
      ProviderWorkspaceRegistry.setServices(wiring.providerId, {
        mcpStorage: {
          load: async () => [{
            config: { command: 'x' },
            contextSaving: false,
            enabled: true,
            name: `${wiring.providerId}-server`,
          }],
          save: async () => undefined,
        },
      });
    }

    const servers = await build(plugin()).loadMcpServers();

    // The marker is the provider's own id: a context wired to a neighbour's
    // accessor returns the neighbour's server, and every other assertion about
    // this answer would still pass.
    expect(servers.map(server => server.id)).toEqual([`${providerId}-server`]);
  });

  it('asks the catalog for the dropdown list, without built-ins', async () => {
    const listDropdownEntries = jest.fn(async () => []);
    ProviderWorkspaceRegistry.setServices('grok', {
      commandCatalog: { listDropdownEntries },
    } as never);

    await createGrokModuleContext(plugin(), () => null, ports).listCommands();

    // Every caller in the product asks for `false`, and only one of the nine
    // catalogs reads the flag at all. Asking for `true` here would have made
    // this slot report a list no dropdown shows.
    expect(listDropdownEntries).toHaveBeenCalledWith({ includeBuiltIns: false });
  });

  it('names where a command came from, in all four of the slot\'s words', async () => {
    ProviderWorkspaceRegistry.setServices('grok', {
      commandCatalog: {
        listDropdownEntries: async () => [
          { name: 'compact', scope: 'builtin', source: 'builtin' },
          { name: 'review', scope: 'vault', source: 'plugin' },
          { name: 'mine', scope: 'user', source: 'user' },
          { name: 'announced', scope: 'runtime', source: 'sdk' },
          { name: 'internal', scope: 'system', source: 'builtin' },
        ],
      },
    } as never);

    const commands = await createGrokModuleContext(plugin(), () => null, ports).listCommands();

    // The slot has four words and the first version of this mapping used two:
    // it read the entry's *provenance* and sent everything that was not
    // `builtin` to `project`, so a command the user wrote and one the live
    // session announced were reported as the same kind of thing.
    expect(commands).toEqual([
      { name: 'compact', source: 'built-in' },
      { name: 'review', source: 'project' },
      { name: 'mine', source: 'user' },
      { name: 'announced', source: 'session' },
      { name: 'internal', source: 'built-in' },
    ]);
  });

  it('reports no plan for a provider the user has switched off', async () => {
    const getCachedUsage = jest.fn(() => ({ plan: 'Pro' }));
    ProviderWorkspaceRegistry.setServices('grok', {
      usageProvider: { getCachedUsage, isAvailable: () => false },
    } as never);

    const usage = createGrokModuleContext(plugin(), () => null, ports).cachedPlanUsage();

    // Asked on every read rather than once when the port was built: enablement
    // changes while a workspace stays initialized, and a provider switched off
    // would otherwise keep reporting the plan it had.
    expect(usage).toBeNull();
    expect(getCachedUsage).not.toHaveBeenCalled();
  });

  it('reports the plan a provider that is on has cached', async () => {
    ProviderWorkspaceRegistry.setServices('grok', {
      usageProvider: { getCachedUsage: () => ({ plan: 'Pro' }), isAvailable: () => true },
    } as never);

    const usage = createGrokModuleContext(plugin(), () => null, ports).cachedPlanUsage();

    expect(usage).toEqual({ plan: 'Pro' });
  });

  it.each(WIRINGS)('$providerId offers nothing before its workspace is registered', async ({ build }) => {
    const context = build(plugin());

    expect(await context.listCommands()).toEqual([]);
    expect(await context.listModels()).toEqual([]);
    expect(await context.loadMcpServers()).toEqual([]);
    expect(context.cachedPlanUsage()).toBeNull();
  });
});
