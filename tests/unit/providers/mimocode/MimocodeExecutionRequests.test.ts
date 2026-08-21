import { createHash } from 'node:crypto';

import type { ManagedMcpServer } from '@/core/types';
import type { AcpContentBlock } from '@/providers/acp/types';
import {
  MimocodeExecutionRequests,
  type MimocodeInvocationEnvironment,
} from '@/providers/mimocode/execution/MimocodeExecutionRequests';

/**
 * The three reference spaces one MiMoCode turn passes through.
 *
 * The kernel is never handed a prompt, a command line or an environment — it
 * carries opaque references and hands them back when it dispatches, spawns and
 * configures. What this store must get right is that the reference given back
 * resolves to the same turn, and that nothing outlives the turn it belonged to.
 */
describe('MimocodeExecutionRequests', () => {
  const prompt: readonly AcpContentBlock[] = [{ type: 'text', text: 'Reply with exactly: ok' }];

  function createStore(overrides: Partial<MimocodeInvocationEnvironment> = {}): {
    store: MimocodeExecutionRequests;
    environments: (string | undefined)[];
  } {
    const environments: (string | undefined)[] = [];
    let next = 0;
    const store = new MimocodeExecutionRequests(
      () => `ref-${++next}`,
      async databasePath => {
        environments.push(databasePath);
        return {
          executable: '/usr/local/bin/mimo',
          cwd: '/vault',
          environment: { MIMOCODE_DB: databasePath ?? '/default/mimo.db' },
          launchKey: 'launch-key-1',
          mcpServers: [] as readonly ManagedMcpServer[],
          databasePath: databasePath ?? '/default/mimo.db',
          ...overrides,
        };
      },
    );
    return { store, environments };
  }

  it('resolves a turn into the launch and the prompt the backend dispatches', async () => {
    const { store } = createStore();
    const requestRef = store.reference({
      prompt,
      messageId: 'message-1',
      dynamic: { modeId: 'plan', modelId: 'xiaomi/mimo-v2.5-pro-ultraspeed' },
    });

    const invocation = await store.resolve(requestRef);

    expect(invocation).toEqual({
      startupRef: expect.any(String),
      restartFingerprint: createHash('sha256').update('launch-key-1').digest('hex'),
      cwd: '/vault',
      prompt: [...prompt],
      mcpServers: [],
      messageId: 'message-1',
      dynamicRef: expect.any(String),
    });
    await expect(store.resolveLaunch(invocation.startupRef)).resolves.toEqual({
      executable: '/usr/local/bin/mimo',
      // The one subcommand this provider is spoken to through; the recorded
      // handshake is `mimo acp` and nothing else is on the command line.
      arguments: ['acp'],
      cwd: '/vault',
      environment: { MIMOCODE_DB: '/default/mimo.db' },
    });
    await expect(store.resolveDynamic(invocation.dynamicRef ?? '')).resolves.toEqual({
      modeId: 'plan',
      modelId: 'xiaomi/mimo-v2.5-pro-ultraspeed',
    });
  });

  it('mints no dynamic reference for a turn that configures nothing', async () => {
    const { store } = createStore();

    const invocation = await store.resolve(store.reference({ prompt }));

    expect(invocation.dynamicRef).toBeUndefined();
    expect(invocation.messageId).toBeUndefined();
  });

  it('carries the conversation own database into the launch, and reports what it resolved to', async () => {
    const { store, environments } = createStore();
    const resolved: (string | null)[] = [];

    await store.resolve(store.reference({
      prompt,
      databasePath: '/vault/.mimo/one.db',
      onLaunchResolved: path => resolved.push(path),
    }));

    // A session created against one database cannot be loaded from another, so
    // a turn launched without its conversation's path resumes nothing.
    expect(environments).toEqual(['/vault/.mimo/one.db']);
    expect(resolved).toEqual(['/vault/.mimo/one.db']);
  });

  it('holds a prompt no longer than the dispatch that needed it', async () => {
    const { store } = createStore();
    const requestRef = store.reference({ prompt });

    await store.resolve(requestRef);

    // Retention nobody asked for, of the most sensitive thing this handles.
    await expect(store.resolve(requestRef)).rejects.toThrow('Unknown MiMoCode request reference.');
  });

  it('refuses a reference it never minted rather than guessing', async () => {
    const { store } = createStore();

    await expect(store.resolve('ref-nonsense'))
      .rejects.toThrow('Unknown MiMoCode request reference.');
    await expect(store.resolveLaunch('ref-nonsense'))
      .rejects.toThrow('Unknown MiMoCode startup reference.');
    await expect(store.resolveDynamic('ref-nonsense'))
      .rejects.toThrow('Unknown MiMoCode dynamic configuration reference.');
  });

  it('holds a launch that belongs to no turn', async () => {
    const { store } = createStore();

    // The metadata session: an isolated process opened to ask what models and
    // commands exist, which has no prompt behind it to resolve into one.
    const startupRef = store.referenceLaunch({
      executable: '/usr/local/bin/mimo',
      arguments: ['acp'],
      cwd: '/vault',
      environment: {},
    });

    await expect(store.resolveLaunch(startupRef)).resolves.toEqual(expect.objectContaining({
      arguments: ['acp'],
    }));
  });

  it('restarts the process when the launch key changes, and not when it does not', async () => {
    const { store } = createStore();
    const first = await store.resolve(store.reference({ prompt }));
    const second = await store.resolve(store.reference({ prompt }));
    const { store: other } = createStore({ launchKey: 'launch-key-2' });
    const third = await other.resolve(other.reference({ prompt }));

    expect(second.restartFingerprint).toBe(first.restartFingerprint);
    expect(third.restartFingerprint).not.toBe(first.restartFingerprint);
    // Hashed rather than carried: the launch key holds the environment text and
    // the system prompt key, and the fingerprint travels into a control record.
    expect(third.restartFingerprint).not.toContain('launch-key-2');
  });

  it('stays bounded when turns are composed and never dispatched', () => {
    let next = 0;
    const store = new MimocodeExecutionRequests(
      () => `ref-${++next}`,
      async () => ({
        executable: '/usr/local/bin/mimo',
        cwd: '/vault',
        environment: {},
        launchKey: 'launch-key-1',
        mcpServers: [],
        databasePath: null,
      }),
      2,
    );
    const first = store.reference({ prompt });
    store.reference({ prompt });
    store.reference({ prompt });

    // An unbounded map of prompts is a leak; the oldest goes first.
    return expect(store.resolve(first)).rejects.toThrow('Unknown MiMoCode request reference.');
  });

  it('drops everything it is holding when the composition goes away', async () => {
    const { store } = createStore();
    const requestRef = store.reference({ prompt });
    const startupRef = store.referenceLaunch({
      executable: '/usr/local/bin/mimo',
      arguments: ['acp'],
      cwd: '/vault',
      environment: {},
    });

    store.dispose();

    await expect(store.resolve(requestRef)).rejects.toThrow('Unknown MiMoCode request reference.');
    await expect(store.resolveLaunch(startupRef)).rejects.toThrow('Unknown MiMoCode startup reference.');
  });
});
