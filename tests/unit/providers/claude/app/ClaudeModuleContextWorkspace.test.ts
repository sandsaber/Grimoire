import { createClaudeModuleContext } from '@/providers/claude/app/ClaudeModuleContext';

/**
 * Claude's workspace half, which threw by name until this checkpoint.
 *
 * The module declared every one of these slots and filled them from a context
 * where ten of them were `notWired(...)`. Nothing caught it: the slot existed,
 * the module declared it, `workspace.initialize` filled it, and calling it
 * raised. These are the answers now, read from the services that were already
 * serving the same questions through the legacy registration.
 */
describe('Claude module context workspace slots', () => {
  const ports = {
    executionSessionId: () => null,
    rewind: async () => ({ canRewind: false, error: 'not running' }),
  };

  function pluginWith(services: Record<string, unknown> | null): any {
    // Off the plugin's composition root, which is where a provider's services
    // live: the static registry that used to hold them is deleted.
    return {
      settings: {},
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/claude',
      getApplicationRuntimeOrNull: () => ({ workspaceServicesFor: () => services }),
    };
  }

  it('offers nothing at all where no workspace is registered', async () => {
    const context = createClaudeModuleContext(
      pluginWith(null),
      () => null,
      ports,
    );

    // An unregistered workspace is a provider with nothing to offer, not a
    // provider that fails: the settings surface renders empty rather than
    // throwing where nobody catches it.
    expect(await context.commandsPort().listDropdownEntries({ includeBuiltIns: false })).toEqual([]);
    expect(await context.listAgentMentions()).toEqual([]);
    expect(await context.listModels()).toEqual([]);
    expect(await context.mcpPort().load()).toEqual([]);
  });

  it('reaches the registered catalog on every call', async () => {
    // Identity, not shape: the tab manager gives a live session's commands to
    // this port and the settings hub lists them back, so a wrapper here would
    // be a second object whose `setRuntimeCommands` writes where nothing reads.
    const commandCatalog = { listDropdownEntries: jest.fn(async () => []) };
    const context = createClaudeModuleContext(pluginWith({ commandCatalog }), () => null, ports);

    await context.commandsPort().listDropdownEntries({ includeBuiltIns: false });

    expect(commandCatalog.listDropdownEntries).toHaveBeenCalledWith({ includeBuiltIns: false });
  });

  it('asks the mention provider for everything it knows', async () => {
    const searchAgents = jest.fn(() => [
      { id: 'reviewer', name: 'Reviewer', description: 'Reads diffs', source: 'vault' as const },
    ]);
    const plugin = pluginWith({ agentMentionProvider: { searchAgents } });
    const context = createClaudeModuleContext(plugin, () => null, ports);

    expect(await context.listAgentMentions()).toEqual([
      { id: 'reviewer', label: 'Reviewer', description: 'Reads diffs', source: 'vault' },
    ]);
    expect(searchAgents).toHaveBeenCalledWith('');
  });

  it('reaches the registered MCP storage on every call', async () => {
    // **The two tests this replaces existed because the port could not carry a
    // server.** It answered `{ id, label, enabled }`, so a save had to reload
    // the stored list and merge three fields back into it — reconstruction the
    // shared slot performed, and which would have dropped a server's command,
    // args, context-saving mode and disabled tools the moment anything wrote a
    // rebuilt record instead. The port carries `ManagedMcpServer` now, so there
    // is nothing to reconstruct and nothing to lose.
    const mcpStorage = { load: jest.fn(async () => []), save: jest.fn(async () => undefined) };
    const context = createClaudeModuleContext(pluginWith({ mcpStorage }), () => null, ports);

    await context.mcpPort().save([]);

    expect(mcpStorage.save).toHaveBeenCalledWith([]);
  });
});
