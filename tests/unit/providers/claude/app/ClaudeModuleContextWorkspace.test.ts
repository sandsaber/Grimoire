import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { createClaudeModuleContext } from '@/providers/claude/app/ClaudeModuleContext';
import { claudeWorkspaceRegistration } from '@/providers/claude/app/ClaudeWorkspaceServices';

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

  function pluginWith(services: Record<string, unknown>): any {
    ProviderWorkspaceRegistry.register('claude', claudeWorkspaceRegistration);
    ProviderWorkspaceRegistry.setServices('claude', services);
    return {
      settings: {},
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/claude',
    };
  }

  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
  });

  it('offers nothing at all where no workspace is registered', async () => {
    ProviderWorkspaceRegistry.clear();
    const context = createClaudeModuleContext(
      { settings: {}, getResolvedProviderCliPath: () => null } as never,
      () => null,
      ports,
    );

    // An unregistered workspace is a provider with nothing to offer, not a
    // provider that fails: the settings surface renders empty rather than
    // throwing where nobody catches it.
    expect(await context.listCommands()).toEqual([]);
    expect(await context.listAgentMentions()).toEqual([]);
    expect(await context.listModels()).toEqual([]);
    expect(await context.loadMcpServers()).toEqual([]);
    await expect(context.saveMcpServers([])).resolves.toBeUndefined();
  });

  it('reads the command catalog the dropdown reads, built-ins included', async () => {
    const plugin = pluginWith({
      commandCatalog: {
        listDropdownEntries: jest.fn(async () => [
          { name: 'compact', description: 'Compact the transcript', source: 'builtin' },
          { name: 'review', source: 'project' },
        ]),
      },
    });
    const context = createClaudeModuleContext(plugin, () => null, ports);

    const commands = await context.listCommands();

    // Built-ins are included on purpose: for Claude a slash command is as much
    // the CLI's own as a vault file, and the composer offers both.
    expect(commands).toEqual([
      { name: 'compact', description: 'Compact the transcript', source: 'built-in' },
      { name: 'review', source: 'project' },
    ]);
  });

  it('asks the mention provider for everything it knows', async () => {
    const searchAgents = jest.fn(() => [
      { id: 'reviewer', name: 'Reviewer', description: 'Reads diffs', source: 'project' },
    ]);
    const plugin = pluginWith({ agentMentionProvider: { searchAgents } });
    const context = createClaudeModuleContext(plugin, () => null, ports);

    expect(await context.listAgentMentions()).toEqual([
      { id: 'reviewer', label: 'Reviewer', description: 'Reads diffs' },
    ]);
    expect(searchAgents).toHaveBeenCalledWith('');
  });

  it('keeps everything about a stored MCP server that the port cannot carry', async () => {
    const stored = [
      {
        name: 'vault',
        config: { command: 'npx', args: ['mcp-vault'] },
        contextSaving: true,
        disabledTools: ['delete'],
        enabled: false,
      },
      { name: 'other', config: { command: 'other' }, contextSaving: false, enabled: true },
    ];
    const save = jest.fn(async () => undefined);
    const plugin = pluginWith({
      mcpStorage: { load: jest.fn(async () => stored), save },
    });
    const context = createClaudeModuleContext(plugin, () => null, ports);

    expect(await context.loadMcpServers()).toEqual([
      { id: 'vault', label: 'vault', enabled: false },
      { id: 'other', label: 'other', enabled: true },
    ]);

    await context.saveMcpServers([{ id: 'vault', label: 'vault', enabled: true }]);

    // The port carries identity and enablement. A save that rebuilt the record
    // from those three fields would drop the command, the args, the
    // context-saving mode and the disabled tools — everything the user
    // configured — on the first toggle of a checkbox.
    expect(save).toHaveBeenCalledWith([
      {
        name: 'vault',
        config: { command: 'npx', args: ['mcp-vault'] },
        contextSaving: true,
        disabledTools: ['delete'],
        enabled: true,
      },
      { name: 'other', config: { command: 'other' }, contextSaving: false, enabled: true },
    ]);
  });

  it('leaves a server the port never mentioned exactly as it was', async () => {
    const stored = [{ name: 'untouched', config: { command: 'x' }, contextSaving: false, enabled: true }];
    const save = jest.fn(async () => undefined);
    const plugin = pluginWith({ mcpStorage: { load: jest.fn(async () => stored), save } });
    const context = createClaudeModuleContext(plugin, () => null, ports);

    await context.saveMcpServers([]);

    // A caller that saves a subset is not a caller that deleted the rest.
    expect(save).toHaveBeenCalledWith(stored);
  });
});
