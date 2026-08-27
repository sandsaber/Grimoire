import { ProviderWorkspaceHolder } from '@/app/execution/ProviderWorkspaceHolder';

/**
 * A provider's workspace, built once and released once.
 *
 * Codex had these four behaviours written out and the other eight had none of
 * them, because nothing initialized their workspace at all. What the holder has
 * to get right is what a composition would otherwise get wrong eight separate
 * ways: two callers arriving together, a build that fails, an unload that
 * arrives mid-build, and the `dispose` half the contract makes mandatory.
 */
describe('ProviderWorkspaceHolder', () => {
  function contribution(initialize: jest.Mock, dispose = jest.fn(async () => undefined)) {
    return { dispose, initialize, providerId: 'codex' } as never;
  }

  it('builds nothing until something asks', () => {
    const initialize = jest.fn(async () => ({}));
    new ProviderWorkspaceHolder(contribution(initialize), () => ({}));

    // A provider the user never opens costs nothing. Initialization was eager
    // for the one provider that had it, because a synchronous `createRuntime`
    // needed the slots to already exist.
    expect(initialize).not.toHaveBeenCalled();
  });

  it('builds once however many callers arrive together', async () => {
    const initialize = jest.fn(async () => ({ commands: { list: async () => [] } }));
    const holder = new ProviderWorkspaceHolder(contribution(initialize), () => ({}));

    const [first, second] = await Promise.all([holder.resolve(), holder.resolve()]);

    // Two callers racing must share one initialization: a provider that opened
    // a handle twice has one nobody will dispose.
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('lets the next question retry a build that failed', async () => {
    const initialize = jest.fn()
      .mockRejectedValueOnce(new Error('CLI not found'))
      .mockResolvedValueOnce({ models: { list: async () => [], refresh: async () => [] } });
    const holder = new ProviderWorkspaceHolder(contribution(initialize), () => ({}));

    await expect(holder.resolve()).rejects.toThrow('CLI not found');
    await expect(holder.resolve()).resolves.toBeDefined();

    // A failed build is not cached, which is what makes a transient failure
    // transient: the user fixes the CLI path and the next question works.
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('reports what was built to a caller that cannot wait, and nothing before', async () => {
    const slots = { usage: { read: async () => null } };
    const holder = new ProviderWorkspaceHolder(contribution(jest.fn(async () => slots)), () => ({}));

    expect(holder.peek()).toBeUndefined();
    await holder.resolve();
    expect(holder.peek()).toBe(slots);
  });

  it('releases what it built', async () => {
    const slots = { usage: { read: async () => null } };
    const dispose = jest.fn(async () => undefined);
    const holder = new ProviderWorkspaceHolder(
      contribution(jest.fn(async () => slots), dispose),
      () => ({}),
    );

    await holder.resolve();
    await holder.dispose();

    expect(dispose).toHaveBeenCalledWith(slots);
    expect(holder.peek()).toBeUndefined();
  });

  it('releases nothing when nothing was built', async () => {
    const dispose = jest.fn(async () => undefined);
    const holder = new ProviderWorkspaceHolder(
      contribution(jest.fn(async () => ({})), dispose),
      () => ({}),
    );

    await holder.dispose();

    expect(dispose).not.toHaveBeenCalled();
  });

  it('aborts a build the unload overtakes rather than waiting for it', async () => {
    let seen: AbortSignal | undefined;
    const initialize = jest.fn(async (_context: unknown, signal: AbortSignal) => {
      seen = signal;
      return new Promise<Record<string, never>>(() => undefined);
    });
    const holder = new ProviderWorkspaceHolder(contribution(initialize as never), () => ({}));

    void holder.resolve();
    await holder.dispose();

    // Awaiting the initialization would make unload wait on a provider that may
    // never answer; the signal is how the contribution is told to stop.
    expect(seen?.aborted).toBe(true);
  });
});
