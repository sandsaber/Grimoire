import { createAcpMcpServerSource } from '@/providers/acp/app/AcpMcpServerSource';

function createAdapter(files: Record<string, string>) {
  return {
    exists: async (path: string) => path in files,
    read: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    write: async () => {},
  };
}

const CONFIG_PATH = '.grimoire/mcp/opencode.json';

describe('createAcpMcpServerSource', () => {
  it('converts enabled stdio servers for the ACP session', async () => {
    const source = createAcpMcpServerSource(createAdapter({
      [CONFIG_PATH]: JSON.stringify({
        mcpServers: {
          notes: { command: '/usr/bin/notes-mcp', args: ['--vault', '/v'] },
        },
      }),
    }));

    await expect(source.load('opencode')).resolves.toEqual([
      { name: 'notes', command: '/usr/bin/notes-mcp', args: ['--vault', '/v'], env: undefined },
    ]);
  });

  it('reads each provider from its own configuration file', async () => {
    const source = createAcpMcpServerSource(createAdapter({
      [CONFIG_PATH]: JSON.stringify({ mcpServers: { a: { command: '/a' } } }),
    }));

    // A provider without a file gets no servers rather than another provider's.
    await expect(source.load('grok')).resolves.toEqual([]);
  });

  it('returns no servers when the configuration is absent', async () => {
    const source = createAcpMcpServerSource(createAdapter({}));

    await expect(source.load('opencode')).resolves.toEqual([]);
  });

  it('survives an unreadable configuration instead of failing the turn', async () => {
    const source = createAcpMcpServerSource({
      exists: async () => true,
      read: async () => { throw new Error('unreadable'); },
      write: async () => {},
    });

    // MCP is additive: refusing to send a message because an optional tool
    // list could not be read would be worse than sending it without them.
    // AcpMcpStorage already contains read and parse failures, so the wrapper's
    // own guard is a backstop rather than the primary path.
    await expect(source.load('opencode')).resolves.toEqual([]);
  });

  it('skips servers that are explicitly disabled', async () => {
    const source = createAcpMcpServerSource(createAdapter({
      [CONFIG_PATH]: JSON.stringify({
        mcpServers: { off: { command: '/off' }, on: { command: '/on' } },
        _grimoire: { servers: { off: { enabled: false } } },
      }),
    }));

    const servers = await source.load('opencode');
    expect(servers.map(server => server.name)).toEqual(['on']);
  });

  it('reflects configuration changed between turns', async () => {
    const files: Record<string, string> = {
      [CONFIG_PATH]: JSON.stringify({ mcpServers: { a: { command: '/a' } } }),
    };
    const source = createAcpMcpServerSource(createAdapter(files));

    await expect(source.load('opencode')).resolves.toHaveLength(1);
    files[CONFIG_PATH] = JSON.stringify({ mcpServers: {} });
    // Nothing is cached, so a server disabled between messages takes effect.
    await expect(source.load('opencode')).resolves.toEqual([]);
  });
});
