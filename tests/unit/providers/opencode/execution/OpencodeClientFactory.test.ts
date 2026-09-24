import { OpencodeClientFactory, scopedV2Config } from '@/providers/opencode/execution/OpencodeClientFactory';

const mockLaunches: Array<Record<string, any>> = [];
const mockTerminate = jest.fn().mockResolvedValue('confirmed');
const mockLegacy = { close: jest.fn().mockResolvedValue('confirmed') };
const mockNative = { close: jest.fn().mockResolvedValue('confirmed') };
const mockNativeOptions = jest.fn();
let mockVersion = 'opencode v2.0.16';
let mockAddress = 'http://127.0.0.1:3210';
jest.mock('@/providers/opencode/execution/OpencodeV2Client', () => ({
  OpencodeV2Client: jest.fn().mockImplementation(options => { mockNativeOptions(options); return mockNative; }),
}));
jest.mock('@/providers/acp/execution/AcpManagedClientAdapter', () => ({
  AcpManagedClientAdapterFactory: jest.fn().mockImplementation(() => ({ create: async () => mockLegacy })),
}));
jest.mock('@/app/execution/acp/NodeManagedAcpProcessLauncher', () => ({
  NodeManagedAcpProcessLauncher: class {
    constructor(private readonly resolver: { resolve: (ref: string) => Promise<Record<string, any>> }) {}
    async launch(ref: string) {
      const { PassThrough } = require('node:stream');
      const invocation = await this.resolver.resolve(ref);
      mockLaunches.push(invocation);
      const input = new PassThrough();
      input.end(`${invocation.arguments[0] === '--version' ? mockVersion : JSON.stringify({ url: mockAddress })}\n`);
      return { input, output: new PassThrough(), onClose: () => () => undefined, terminate: mockTerminate };
    }
    async dispose() { return 'confirmed'; }
  },
}));

const artifact = {
  agent: {
    'grimoire-full-access': { mode: 'primary', prompt: 'Managed prompt', permission: { question: 'allow' } },
    'grimoire-safe': { mode: 'primary', prompt: 'Managed prompt', permission: { bash: 'ask', edit: 'ask' } },
    plan: { prompt: 'Managed prompt' },
  },
};

function factory() {
  return new OpencodeClientFactory({ clientInfo: { name: 'test', version: '1' } }, {
    resolve: async () => ({ executable: '/cli/opencode', arguments: ['acp'], cwd: '/vault',
      environment: { OPENCODE_CONFIG_CONTENT: JSON.stringify(artifact) } }),
  });
}

describe('OpenCode client selection', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockLaunches.length = 0;
    mockVersion = 'opencode v2.0.16'; mockAddress = 'http://127.0.0.1:3210';
  });

  it('keeps V1 on the existing ACP adapter', async () => {
    mockVersion = '1.18.32';
    const owner = factory();
    const client = await owner.create({ startupRef: 'launch', signal: new AbortController().signal, requestPermission: jest.fn() });
    expect(client).toBe(mockLegacy);
    expect(mockNativeOptions).not.toHaveBeenCalled();
    expect(mockLaunches).toHaveLength(1);
    await client.close();
    await owner.dispose();
  });

  it('uses an authenticated loopback server for V2 and requires both managed chat modes', async () => {
    const owner = factory();
    const client = await owner.create({ startupRef: 'launch', signal: new AbortController().signal, requestPermission: jest.fn() });
    expect(client).toBe(mockNative);
    expect(mockLaunches[1].arguments).toEqual(['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0']);
    expect(mockLaunches[1].environment.OPENCODE_PASSWORD).toHaveLength(43);
    expect(mockNativeOptions).toHaveBeenCalledWith(expect.objectContaining({ requiredAgents: ['grimoire-full-access', 'grimoire-safe'] }));
    expect(JSON.parse(mockLaunches[1].environment.OPENCODE_CONFIG_CONTENT).agent['grimoire-safe'].permission)
      .toMatchObject({ bash: 'ask', edit: 'ask', external_directory: 'deny' });
    await client.close();
    await owner.dispose();
  });

  it('rejects a non-loopback address before handing it the generated credential', async () => {
    mockAddress = 'https://external.example';
    await expect(factory().create({ startupRef: 'launch', signal: new AbortController().signal, requestPermission: jest.fn() }))
      .rejects.toThrow('local loopback');
    expect(mockNativeOptions).not.toHaveBeenCalled();
    expect(mockTerminate).toHaveBeenCalledTimes(2);
  });

  it('preserves native inline settings while enforcing the managed Safe boundary', () => {
    const result = JSON.parse(scopedV2Config(artifact, JSON.stringify({
      model: 'custom/model', agents: { custom: { system: 'Custom prompt' } },
    }), ['grimoire-full-access', 'grimoire-safe']));
    expect(result.model).toBe('custom/model');
    expect(result.agents.custom).toEqual({ system: 'Custom prompt' });
    expect(result.agents['grimoire-safe'].permissions).toEqual(expect.arrayContaining([
      { action: 'shell', resource: '*', effect: 'ask' },
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'external_directory', resource: '*', effect: 'deny' },
    ]));
    expect(artifact.agent['grimoire-safe'].permission).toEqual({ bash: 'ask', edit: 'ask' });
  });

  it('does not echo malformed inline configuration in an error', () => {
    expect(() => scopedV2Config(artifact, '{"key":"private-test-value" invalid}', []))
      .toThrow('OpenCode inline configuration must be a JSON object.');
  });
});
