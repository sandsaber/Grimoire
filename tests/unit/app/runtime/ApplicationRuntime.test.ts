import {
  ApplicationRuntime,
  ApplicationRuntimeAdmissionError,
  type ApplicationRuntimeOptions,
} from '@/app/runtime/ApplicationRuntime';

describe('ApplicationRuntime', () => {
  it('keeps admission closed until every startup recovery phase completes in order', async () => {
    const calls: string[] = [];
    const gates = Array.from({ length: 8 }, () => deferred<void>());
    const options = createOptions(calls, gates);
    const runtime = new ApplicationRuntime(options);

    const startup = runtime.start();
    expect(runtime.state).toBe('starting');
    expect(() => runtime.loadConversation('conversation-1'))
      .toThrow(ApplicationRuntimeAdmissionError);

    const expected = [
      'migration',
      'backends',
      'lifecycle',
      'interaction-presentations',
      'settings',
      'shell',
      'auxiliary',
      'agents',
    ];
    for (let index = 0; index < gates.length; index += 1) {
      await flushPromises();
      expect(calls).toEqual(expected.slice(0, index + 1));
      gates[index]?.resolve();
    }
    await startup;
    expect(runtime.state).toBe('accepting');
    await expect(runtime.loadConversation('conversation-1')).resolves.toMatchObject({
      conversationId: 'conversation-1',
    });
  });

  it('closes admission before shutdown and keeps projections attached through classification', async () => {
    const calls: string[] = [];
    const options = createOptions(calls);
    const runtime = new ApplicationRuntime(options);
    await runtime.start();
    calls.length = 0;

    await runtime.shutdown();

    expect(runtime.state).toBe('stopped');
    expect(calls).toEqual([
      'lifecycle-shutdown',
      'agent-idle',
      'chat-idle',
      'shell-idle',
      'auxiliary-idle',
      'chat-dispose',
      'shell-dispose',
      'auxiliary-dispose',
      'agent-dispose',
      'projection-dispose',
      'request-dispose',
      'backend-dispose',
      'workspace-dispose',
    ]);
    expect(() => runtime.loadConversation('conversation-1'))
      .toThrow(ApplicationRuntimeAdmissionError);
  });

  it('shares concurrent startup and shutdown tasks', async () => {
    const options = createOptions([]);
    const runtime = new ApplicationRuntime(options);
    const firstStart = runtime.start();
    const secondStart = runtime.start();
    expect(secondStart).toBe(firstStart);
    await firstStart;

    const firstStop = runtime.shutdown();
    const secondStop = runtime.shutdown();
    expect(secondStop).toBe(firstStop);
    await firstStop;
  });

  it('runs complete cleanup and never admits commands after pre-lifecycle recovery failure', async () => {
    const calls: string[] = [];
    const options = createOptions(calls);
    options.migration.migrate = async () => {
      calls.push('migration');
      throw new Error('migration failed');
    };
    const runtime = new ApplicationRuntime(options);

    await expect(runtime.start()).rejects.toThrow('migration failed');
    expect(runtime.state).toBe('failed');
    expect(calls).toEqual([
      'migration',
      'agent-idle',
      'chat-idle',
      'shell-idle',
      'auxiliary-idle',
      'chat-dispose',
      'shell-dispose',
      'auxiliary-dispose',
      'agent-dispose',
      'projection-dispose',
      'request-dispose',
      'backend-dispose',
      'workspace-dispose',
    ]);
    expect(() => runtime.submitChatTurn({} as never))
      .toThrow(ApplicationRuntimeAdmissionError);
  });

  it('joins in-flight startup before shutdown without ever opening admission', async () => {
    const calls: string[] = [];
    const gates = Array.from({ length: 8 }, () => deferred<void>());
    const runtime = new ApplicationRuntime(createOptions(calls, gates));

    const startup = runtime.start();
    await flushPromises();
    const shutdown = runtime.shutdown();
    expect(runtime.state).toBe('stopping');
    expect(() => runtime.loadConversation('conversation-1'))
      .toThrow(ApplicationRuntimeAdmissionError);

    for (const gate of gates) {
      gate.resolve();
      await flushPromises();
    }
    await expect(startup).resolves.toBeUndefined();
    await expect(shutdown).resolves.toBeUndefined();
    expect(runtime.state).toBe('stopped');
    expect(calls).toEqual([
      'migration',
      'backends',
      'lifecycle',
      'interaction-presentations',
      'settings',
      'shell',
      'auxiliary',
      'agents',
      'lifecycle-shutdown',
      'agent-idle',
      'chat-idle',
      'shell-idle',
      'auxiliary-idle',
      'chat-dispose',
      'shell-dispose',
      'auxiliary-dispose',
      'agent-dispose',
      'projection-dispose',
      'request-dispose',
      'backend-dispose',
      'workspace-dispose',
    ]);
  });

  it('continues bounded ownership cleanup after a projection drain failure', async () => {
    const calls: string[] = [];
    const options = createOptions(calls);
    let agentIdleAttempt = 0;
    options.agents.waitForIdle = async () => {
      calls.push('agent-idle');
      if (++agentIdleAttempt === 1) throw new Error('agent projection failed');
    };
    const runtime = new ApplicationRuntime(options);
    await runtime.start();
    calls.length = 0;

    await expect(runtime.shutdown()).rejects.toThrow('cleanup failed');
    expect(runtime.state).toBe('failed');
    expect(calls).toEqual([
      'lifecycle-shutdown',
      'agent-idle',
      'chat-idle',
      'shell-idle',
      'auxiliary-idle',
      'chat-dispose',
      'shell-dispose',
      'auxiliary-dispose',
      'agent-dispose',
      'projection-dispose',
      'request-dispose',
      'backend-dispose',
      'workspace-dispose',
    ]);

    await expect(runtime.shutdown()).resolves.toBeUndefined();
    expect(runtime.state).toBe('stopped');
  });

  it('cleans every started owner when startup recovery fails after lifecycle start', async () => {
    const calls: string[] = [];
    const options = createOptions(calls);
    options.settings.recoverPending = async () => {
      calls.push('settings');
      throw new Error('settings recovery failed');
    };
    const runtime = new ApplicationRuntime(options);

    await expect(runtime.start()).rejects.toThrow('settings recovery failed');
    expect(runtime.state).toBe('failed');
    expect(calls).toEqual([
      'migration',
      'backends',
      'lifecycle',
      'interaction-presentations',
      'settings',
      'lifecycle-shutdown',
      'agent-idle',
      'chat-idle',
      'shell-idle',
      'auxiliary-idle',
      'chat-dispose',
      'shell-dispose',
      'auxiliary-dispose',
      'agent-dispose',
      'projection-dispose',
      'request-dispose',
      'backend-dispose',
      'workspace-dispose',
    ]);
  });
});

function createOptions(
  calls: string[],
  gates: readonly Deferred<void>[] = [],
): ApplicationRuntimeOptions {
  const phase = (name: string, index: number) => async () => {
    calls.push(name);
    await gates[index]?.promise;
  };
  return {
    migration: { migrate: phase('migration', 0) },
    backends: {
      initialize: phase('backends', 1),
      dispose: async () => { calls.push('backend-dispose'); },
    },
    lifecycle: {
      start: phase('lifecycle', 2),
      shutdown: async () => { calls.push('lifecycle-shutdown'); },
    },
    interactionPresentations: { recover: phase('interaction-presentations', 3) },
    settings: { recoverPending: phase('settings', 4) },
    chat: {
      createConversation: async () => undefined,
      registerRequestRef: () => 'req-test',
      loadConversation: async conversationId => ({ conversationId } as never),
      attach: async () => () => undefined,
      submitTurn: async () => ({} as never),
      cancelActive: async () => undefined,
      resolveInteraction: async () => undefined,
      waitForIdle: async () => { calls.push('chat-idle'); },
      dispose: () => { calls.push('chat-dispose'); },
    },
    shell: {
      recover: phase('shell', 5),
      waitForIdle: async () => { calls.push('shell-idle'); },
      dispose: () => { calls.push('shell-dispose'); },
    },
    auxiliary: {
      recover: phase('auxiliary', 6),
      waitForIdle: async () => { calls.push('auxiliary-idle'); },
      dispose: () => { calls.push('auxiliary-dispose'); },
    },
    work: {
      recoverDispatchBindings: phase('work-dispatch-bindings', 8),
      recoverAll: phase('work', 10) as never,
    },
    agents: {
      recover: async () => {
        calls.push('agents');
        await gates[7]?.promise;
      },
      waitForIdle: async () => { calls.push('agent-idle'); },
      dispose: () => { calls.push('agent-dispose'); },
    },
    projections: { dispose: () => { calls.push('projection-dispose'); } },
    requests: { dispose: () => { calls.push('request-dispose'); } },
    workspaces: { dispose: async () => { calls.push('workspace-dispose'); } },
    nextShutdownCheckpointId: () => `sd-${'1'.repeat(32)}`,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
