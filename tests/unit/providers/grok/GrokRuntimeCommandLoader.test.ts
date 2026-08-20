import { GrokRuntimeCommandLoader } from '@/providers/grok/app/GrokRuntimeCommandLoader';

const ANNOUNCED = [{ name: 'review', description: 'Review the diff' }];

const LISTED = [{
  id: 'acp:review',
  name: 'review',
  content: '',
  source: 'sdk',
  description: 'Review the diff',
}];

function createMockPlugin(): { plugin: any; listCommands: jest.Mock } {
  const listCommands = jest.fn().mockResolvedValue(ANNOUNCED);
  return {
    listCommands,
    plugin: {
      settings: {
        providerConfigs: {
          grok: {
            enabled: true,
          },
        },
      },
      getGrokExecution: () => ({ metadata: { listCommands } }),
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
describe('GrokRuntimeCommandLoader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks an isolated session for a blank tab warmup', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const loader = new GrokRuntimeCommandLoader();

    await expect(loader.loadCommands({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: null,
    })).resolves.toEqual(LISTED);

    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('keeps blank tabs cold unless warmup is explicitly requested', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const loader = new GrokRuntimeCommandLoader();

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
      providerId: 'grok',
      getSupportedCommands: jest.fn(),
    };
    const loader = new GrokRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: {
        id: 'conv-grok',
        messages: [{ id: 'm1' }],
        providerState: {},
        sessionId: null,
      } as any,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual(LISTED);

    // The bound tab is left cold on purpose: a session created here is the one
    // its first turn would resume, and that turn never bootstraps the history.
    expect(boundRuntime.getSupportedCommands).not.toHaveBeenCalled();
    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('opens the tab anyway when there is no execution to ask', async () => {
    const { plugin } = createMockPlugin();
    plugin.getGrokExecution = () => {
      throw new Error('Grok execution is not available before plugin load.');
    };
    const loader = new GrokRuntimeCommandLoader();

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
      providerId: 'grok',
      // A blank tab: a runtime, and no session for it to answer from.
      getSessionId: () => null,
      getSupportedCommands: jest.fn().mockResolvedValue([]),
    };
    const loader = new GrokRuntimeCommandLoader();

    await expect(loader.loadCommands({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual(LISTED);

    // Asking a runtime with no session returns nothing at all, which is how a
    // fresh tab ends up with an empty command menu until the first message.
    expect(boundRuntime.getSupportedCommands).not.toHaveBeenCalled();
    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('answers from the session a live tab already holds', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const bound = [{ id: 'acp:compact', name: 'compact', content: '' }];
    const boundRuntime = {
      providerId: 'grok',
      getSessionId: () => 'grok-session',
      getSupportedCommands: jest.fn().mockResolvedValue(bound),
    };
    const loader = new GrokRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: {
        id: 'conv-grok',
        messages: [],
        providerState: {},
        sessionId: 'grok-session',
      } as any,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual(bound);

    // No second process for a question the open session already answered.
    expect(listCommands).not.toHaveBeenCalled();
  });
});
