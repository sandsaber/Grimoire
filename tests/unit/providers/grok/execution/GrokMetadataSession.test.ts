import '@/providers';

import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionNotification, AcpSetSessionModelRequest } from '@/providers/acp/types';
import { GrokMetadataSession } from '@/providers/grok/execution/GrokMetadataSession';
import { getGrokProviderSettings, updateGrokProviderSettings } from '@/providers/grok/settings';

/**
 * What Grimoire asks Grok when nobody is having a conversation.
 *
 * Five surfaces need the same two answers — which models exist and what a model
 * can think at, and which commands a session offers — and every one of them got
 * them by constructing a whole chat runtime. This is the isolated session they
 * share instead: opened, read, closed, and bound to no conversation.
 */
describe('Grok metadata session', () => {
  class FakeClient implements ManagedAcpClient {
    initializeCalls = 0;
    closeCalls = 0;
    newSessionError: Error | undefined;
    announceCommands: string[] = [];
    readonly models: AcpSetSessionModelRequest[] = [];
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
          availableModels: [{ id: 'grok-4.6', name: 'Grok 4.6' }],
          currentModelId: 'grok-4.6',
        },
        modes: { availableModes: [{ id: 'ask', name: 'Safe' }], currentModeId: 'ask' },
      };
    }

    async loadSession() {
      return { sessionId: 'metadata-session' };
    }

    async prompt(): Promise<never> {
      throw new Error('A metadata session never prompts.');
    }

    async setMode(): Promise<Record<string, never>> { return {}; }

    async setModel(request: AcpSetSessionModelRequest) {
      this.models.push(request);
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

    async setConfigOption() {
      return { configOptions: [] as never };
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

  function createFake(): { factory: ManagedAcpClientFactory; startupRefs: string[]; client: FakeClient } {
    const startupRefs: string[] = [];
    const client = new FakeClient();
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        return client;
      },
    };
    return { factory, startupRefs, client };
  }

  function createSession(
    fake: ReturnType<typeof createFake>,
    settings: Record<string, unknown> = {},
  ) {
    const session = new GrokMetadataSession({
      clientFactory: fake.factory,
      launch: async () => ({
        startupRef: 'startup-ref',
        cwd: '/vault',
        mcpServers: [],
      }),
      settingsBag: () => settings,
      saveSettings: async () => undefined,
      refreshSelectors: () => undefined,
      workspaceRoot: () => '/vault',
      cliPath: () => '/usr/local/bin/grok',
    });
    return { session, settings };
  }

  it('learns what a session reports, then closes it', async () => {
    const fake = createFake();
    const { session, settings } = createSession(fake);

    await session.discoverMetadata();

    expect(fake.client.initializeCalls).toBe(1);
    expect(fake.startupRefs).toEqual(['startup-ref']);
    // What the session said it has. The vault's list also carries the frontier
    // default this provider ships with, so this asserts the addition rather
    // than the whole list.
    expect(getGrokProviderSettings(settings).discoveredModels)
      .toContainEqual(expect.objectContaining({ rawId: 'grok-4.6' }));
    // Closed, always: a metadata session that outlived its question would be a
    // second Grok process nobody owns.
    expect(fake.client.closeCalls).toBe(1);
  });

  it('asks about a model through the method Grok has for it', async () => {
    const fake = createFake();
    const settings: Record<string, unknown> = {};
    const { session } = createSession(fake, settings);
    // The catalog the vault already has, learned by opening a session once.
    await session.discoverMetadata();

    await expect(session.discoverMetadata({ model: 'grok:grok-4.6' })).resolves.toBe(true);

    // Grok has a dedicated `session/set_model`, where OpenCode sets a config
    // option. Not asserted here: that this does not become the vault's
    // selection. The `seedActiveSelection: false` the call carries mirrors the
    // legacy warmup, but seeding only ever writes an *unset* selection and the
    // session-open sync above has already set one — so no assertion here could
    // tell the flag's presence from its absence, and one that looked like it
    // could would be a test that pins nothing.
    expect(fake.client.models).toEqual([
      { modelId: 'grok-4.6', sessionId: 'metadata-session' },
    ]);
  });

  it('refuses to ask about a model the vault has never discovered', async () => {
    const fake = createFake();
    const settings: Record<string, unknown> = {};
    updateGrokProviderSettings(settings, {
      discoveredModels: [{ label: 'Grok 4.6', rawId: 'grok-4.6' }],
    });
    const { session } = createSession(fake, settings);

    await expect(session.discoverMetadata({ model: 'grok:grok-2-legacy' })).resolves.toBe(false);

    expect(fake.client.models).toEqual([]);
    expect(fake.client.closeCalls).toBe(1);
  });

  it('lists the commands the session announced', async () => {
    const fake = createFake();
    fake.client.announceCommands = ['compact', 'review'];
    const { session } = createSession(fake);

    const commands = await session.listCommands();

    expect(commands.map(command => command.name)).toEqual(['compact', 'review']);
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
    fake.client.newSessionError = new Error('grok refused');
    const { session } = createSession(fake);

    await expect(session.discoverMetadata()).resolves.toBe(false);

    expect(fake.client.closeCalls).toBe(1);
  });
});
