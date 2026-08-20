import { OpencodeMetadataSession } from '@/app/execution/opencode/OpencodeMetadataSession';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionNotification, AcpSetSessionConfigOptionRequest } from '@/providers/acp/types';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';

/**
 * What Grimoire asks OpenCode when nobody is having a conversation.
 *
 * Four surfaces need the same two answers — which models exist and which
 * commands a session offers — and every one of them used to get them by
 * constructing a whole chat runtime. This is the isolated session they share
 * instead: opened, read, closed, and bound to no conversation.
 */
describe('OpenCode metadata session', () => {
  interface Fake {
    readonly factory: ManagedAcpClientFactory;
    readonly startupRefs: string[];
    readonly configOptions: AcpSetSessionConfigOptionRequest[];
    readonly closes: number[];
    readonly client: FakeClient;
  }

  class FakeClient implements ManagedAcpClient {
    initializeCalls = 0;
    closeCalls = 0;
    newSessionError: Error | undefined;
    announceCommands: string[] = [];
    readonly configOptions: AcpSetSessionConfigOptionRequest[] = [];
    private notify: ((notification: AcpSessionNotification) => void) | undefined;

    async initialize(): Promise<void> {
      this.initializeCalls += 1;
    }

    async newSession() {
      if (this.newSessionError) {
        throw this.newSessionError;
      }
      queueMicrotask(() => {
        if (this.announceCommands.length > 0) {
          this.notify?.({
            sessionId: 'metadata-session',
            update: {
              sessionUpdate: 'available_commands_update',
              availableCommands: this.announceCommands.map(name => ({ name, description: name })),
            },
          } as unknown as AcpSessionNotification);
        }
      });
      return {
        sessionId: 'metadata-session',
        models: {
          availableModels: [{ id: 'opencode/big-pickle', name: 'Big Pickle' }],
          currentModelId: 'opencode/big-pickle',
        },
        modes: { availableModes: [{ id: 'build', name: 'Build' }], currentModeId: 'build' },
      };
    }

    async loadSession() {
      return { sessionId: 'metadata-session' };
    }

    async prompt(): Promise<never> {
      throw new Error('A metadata session never prompts.');
    }

    async setConfigOption(request: AcpSetSessionConfigOptionRequest) {
      this.configOptions.push(request);
      return {
        configOptions: [{
          category: 'thought_level',
          currentValue: 'high',
          id: 'effort',
          name: 'Effort',
          options: [{ name: 'Low', value: 'low' }, { name: 'High', value: 'high' }],
          type: 'select',
        }] as never,
      };
    }

    cancel(): void {}

    onSessionNotification(listener: (notification: AcpSessionNotification) => void) {
      this.notify = listener;
      return () => { this.notify = undefined; };
    }

    onConnectionLost() {
      return () => undefined;
    }

    async close(): Promise<'confirmed'> {
      this.closeCalls += 1;
      return 'confirmed';
    }
  }

  function createFake(): Fake {
    const startupRefs: string[] = [];
    const closes: number[] = [];
    const client = new FakeClient();
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        return client;
      },
    };
    return { factory, startupRefs, closes, client, configOptions: client.configOptions };
  }

  function createSession(fake: Fake, overrides: Partial<{
    settings: Record<string, unknown>;
    saved: number;
  }> = {}) {
    const settings: Record<string, unknown> = overrides.settings ?? {};
    let saved = 0;
    let refreshed = 0;
    const session = new OpencodeMetadataSession({
      clientFactory: fake.factory,
      launch: async () => ({
        startupRef: 'startup-ref',
        cwd: '/vault',
        mcpServers: [],
      }),
      settingsBag: () => settings,
      saveSettings: async () => { saved += 1; },
      refreshSelectors: () => { refreshed += 1; },
    });
    return { session, settings, saved: () => saved, refreshed: () => refreshed };
  }

  it('learns what a session reports, then closes it', async () => {
    const fake = createFake();
    const { session, settings } = createSession(fake);

    await session.discoverMetadata();

    expect(fake.client.initializeCalls).toBe(1);
    expect(fake.startupRefs).toEqual(['startup-ref']);
    // The vault learns its models by opening a session and being told; nothing
    // else answers that question. Discovery is held beside the settings rather
    // than in them, which is why it is read through the provider accessor.
    expect(getOpencodeProviderSettings(settings).discoveredModels)
      .toEqual([expect.objectContaining({ rawId: 'opencode/big-pickle' })]);
    // Closed, always: a metadata session that outlived its question would be a
    // second OpenCode process nobody owns.
    expect(fake.client.closeCalls).toBe(1);
  });

  it('sets the model it was asked about and keeps what the session answered', async () => {
    const fake = createFake();
    const { session, settings } = createSession(fake);

    await session.discoverMetadata({ rawModelId: 'opencode/big-pickle' });

    expect(fake.configOptions).toEqual([expect.objectContaining({
      configId: 'model',
      sessionId: 'metadata-session',
      value: 'opencode/big-pickle',
    })]);
    // The thinking levels a model offers are reported in the reply to setting
    // it, and by nothing else.
    expect(getOpencodeProviderSettings(settings).thinkingOptionsByModel)
      .toEqual({ 'opencode/big-pickle': [
        expect.objectContaining({ value: 'low' }),
        expect.objectContaining({ value: 'high' }),
      ] });
  });

  it('lists the commands the session announced', async () => {
    const fake = createFake();
    fake.client.announceCommands = ['brainstorming', 'review'];
    const { session } = createSession(fake);

    const commands = await session.listCommands();

    expect(commands.map(command => command.name)).toEqual(['brainstorming', 'review']);
    expect(fake.client.closeCalls).toBe(1);
  });

  it('answers nothing rather than waiting for a session that announces no commands', async () => {
    const fake = createFake();
    const { session } = createSession(fake);

    await expect(session.listCommands()).resolves.toEqual([]);
    expect(fake.client.closeCalls).toBe(1);
  });

  it('closes the process even when the session could not be created', async () => {
    const fake = createFake();
    fake.client.newSessionError = new Error('opencode refused');
    const { session } = createSession(fake);

    await expect(session.discoverMetadata()).resolves.toBe(false);

    expect(fake.client.closeCalls).toBe(1);
  });
});
