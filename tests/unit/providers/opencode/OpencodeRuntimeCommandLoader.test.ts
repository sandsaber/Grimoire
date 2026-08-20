import { OpencodeRuntimeCommandLoader } from '@/providers/opencode/app/OpencodeRuntimeCommandLoader';

const ANNOUNCED = [{ name: 'review', description: 'Review the diff' }];

function createMockPlugin(): { plugin: any; listCommands: jest.Mock } {
  const listCommands = jest.fn().mockResolvedValue(ANNOUNCED);
  return {
    listCommands,
    plugin: {
      settings: {
        providerConfigs: {
          opencode: {
            enabled: true,
          },
        },
      },
      getOpencodeExecution: () => ({ metadata: { listCommands } }),
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
describe('OpencodeRuntimeCommandLoader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks an isolated session for a blank tab warmup', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const loader = new OpencodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      allowSessionCreation: true,
      conversation: null,
      externalContextPaths: [],
      plugin,
      runtime: null,
    })).resolves.toEqual([
      { id: 'opencode:review', name: 'review', content: '', description: 'Review the diff' },
    ]);

    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('keeps blank tabs cold unless warmup is explicitly requested', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const loader = new OpencodeRuntimeCommandLoader();

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
      providerId: 'opencode',
      getSupportedCommands: jest.fn(),
    };
    const loader = new OpencodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: {
        id: 'conv-opencode',
        messages: [{ id: 'm1' }],
        providerState: {},
        sessionId: null,
      } as any,
      externalContextPaths: [],
      plugin,
      runtime: boundRuntime as any,
    })).resolves.toEqual([
      { id: 'opencode:review', name: 'review', content: '', description: 'Review the diff' },
    ]);

    // The bound tab is left cold on purpose: a session created here is the one
    // its first turn would resume, and that turn never bootstraps the history.
    expect(boundRuntime.getSupportedCommands).not.toHaveBeenCalled();
    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('answers from the session a live tab already holds', async () => {
    const { plugin, listCommands } = createMockPlugin();
    const bound = [{ id: 'opencode:plan', name: 'plan', content: '' }];
    const boundRuntime = {
      providerId: 'opencode',
      getSupportedCommands: jest.fn().mockResolvedValue(bound),
    };
    const loader = new OpencodeRuntimeCommandLoader();

    await expect(loader.loadCommands({
      conversation: {
        id: 'conv-opencode',
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
