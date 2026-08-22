import { MimocodeRuntimeCommandLoader } from '@/providers/mimocode/app/MimocodeRuntimeCommandLoader';

const ANNOUNCED = [{ name: 'review', description: 'Review the diff' }];

function createMockPlugin(): { plugin: any; listCommands: jest.Mock } {
  const listCommands = jest.fn().mockResolvedValue(ANNOUNCED);
  return {
    listCommands,
    plugin: {
      settings: {
        providerConfigs: {
          mimocode: {
            enabled: true,
          },
        },
      },
      getMimocodeExecution: () => ({ metadata: { listCommands } }),
    },
  };
}

/**
 * Which session answers "what commands do you have".
 *
 * A live tab answers from the session it already holds. Everything else is a
 * question with no session behind it, and asking it on the tab's own runtime is
 * how a conversation with history and no session id gets a session created for
 * it — the one its first turn then resumes, with the history never bootstrapped.
 */
describe('MimocodeRuntimeCommandLoader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks an isolated session for a blank tab warmup', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const loader = new MimocodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: null,
    })).resolves.toEqual([
      { id: 'mimocode:review', name: 'review', content: '', description: 'Review the diff' },
    ]);

    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('keeps blank tabs cold unless warmup is explicitly requested', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const loader = new MimocodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: null,
    })).resolves.toEqual([]);

    expect(listCommands).not.toHaveBeenCalled();
  });

  it('asks the isolated session for a pre-session conversation that has messages', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const boundRuntime = {
      providerId: 'mimocode',
      getSupportedCommands: jest.fn(),
    };
    const loader = new MimocodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: {
        id: 'conv-mimocode',
        messages: [{ id: 'm1' }],
        providerState: {},
        sessionId: null,
      } as any,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual([
      { id: 'mimocode:review', name: 'review', content: '', description: 'Review the diff' },
    ]);

    // The bound tab is left cold on purpose: a session created here is the one
    // its first turn would resume, and that turn never bootstraps the history.
    expect(boundRuntime.getSupportedCommands).not.toHaveBeenCalled();
    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('opens the tab anyway when there is no execution to ask', async () => {
    const { plugin } = createMockPlugin();
    plugin.getMimocodeExecution = () => {
      throw new Error('MiMoCode execution is not available before plugin load.');
    };
    const loader = new MimocodeRuntimeCommandLoader();

    // A tab that cannot list its commands still has to open.
    await expect(loader.loadCommands({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: null,
    })).resolves.toEqual([]);
  });

  it('asks the isolated session for a blank tab whose runtime has none', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const boundRuntime = {
      providerId: 'mimocode',
      // A blank tab: a runtime, and no session for it to answer from.
      getSessionId: () => null,
      getSupportedCommands: jest.fn().mockResolvedValue([]),
    };
    const loader = new MimocodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual([
      { id: 'mimocode:review', name: 'review', content: '', description: 'Review the diff' },
    ]);

    // Asking a runtime with no session returns nothing at all, which is how a
    // fresh tab ends up with an empty command menu until the first message.
    expect(boundRuntime.getSupportedCommands).not.toHaveBeenCalled();
    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('answers from the session a live tab already holds', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const bound = [{ id: 'mimocode:plan', name: 'plan', content: '' }];
    const boundRuntime = {
      providerId: 'mimocode',
      getSessionId: () => 'acp-session-1',
      getSupportedCommands: jest.fn().mockResolvedValue(bound),
    };
    const loader = new MimocodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: {
        id: 'conv-mimocode',
        messages: [],
        providerState: {},
        sessionId: 'acp-session-1',
      } as any,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual(bound);

    // No second process for a question the open session already answered.
    expect(listCommands).not.toHaveBeenCalled();
  });
});
