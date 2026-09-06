import GrimoirePlugin from '@/main';

/**
 * The plugin's half of the kernel's load/unload contract.
 *
 * `ExecutionKernelHost` serializes start against unload, and that is enough
 * only once the host exists. It does not exist for the whole of
 * `await loadSettings()`, and `onunload` is not withheld until `onload`
 * finishes — so an unload landing in that window found nothing to tell, and the
 * load that followed opened an acceptance gate for a plugin instance that was
 * already gone. The next reload would then put a second registry on the same
 * control store, which is the dual ownership the host was written to prevent.
 */
describe('execution kernel plugin lifecycle', () => {
  function createPlugin(): GrimoirePlugin {
    const plugin = Object.create(GrimoirePlugin.prototype) as GrimoirePlugin;
    Object.assign(plugin, {
      settings: {},
      storage: {
        getAdapter: () => ({ coordinationKey: {} }),
        // The chat path is assembled beside the kernel now, over the plugin's
        // own record store — the one instance a vault has, because the queue
        // that serializes writes to a conversation is held on it.
        sessions: {
          records: {},
          toConversation: () => undefined,
          toSessionMetadata: () => undefined,
        },
      },
      // `onunload` records a debug event and persists tab state; neither needs
      // a real app for this, and both must survive being called first.
      getAllViews: () => [],
      recordDebugLog: () => undefined,
    });
    return plugin;
  }

  function kernelOf(plugin: GrimoirePlugin): unknown {
    return (plugin as unknown as { executionKernelHost: unknown }).executionKernelHost;
  }

  function startKernel(plugin: GrimoirePlugin): Promise<void> {
    return (plugin as unknown as { startExecutionKernel(): Promise<void> }).startExecutionKernel();
  }

  it('assembles the chat path with the kernel, and lets it go first', async () => {
    // One per load, like the kernel, and disposed *before* it: this detaches the
    // surfaces watching runs, and the kernel is what then decides what happens
    // to the runs themselves.
    const plugin = createPlugin();

    expect(() => plugin.getChatExecution()).toThrow('not available before plugin load');
    await startKernel(plugin);
    const chat = plugin.getChatExecution();
    expect(chat).toBeTruthy();

    plugin.onunload();

    expect(() => plugin.getChatExecution()).toThrow('not available before plugin load');
  });

  it('starts no chat path when unload beat the settings load', async () => {
    const plugin = createPlugin();

    plugin.onunload();
    await startKernel(plugin);

    // Nothing to detach and nothing to submit through: a composition built here
    // would outlive the load that never opened.
    expect(() => plugin.getChatExecution()).toThrow('not available before plugin load');
  });

  it('starts no kernel when unload beat the settings load', async () => {
    const plugin = createPlugin();

    plugin.onunload();
    await startKernel(plugin);

    // Not merely un-started: never constructed. A host built here would open a
    // gate nothing is left to close, because the shutdown already ran.
    expect(kernelOf(plugin)).toBeFalsy();
    expect(() => plugin.getExecutionKernel()).toThrow('not available before plugin load');
  });

  it('starts the kernel on the ordinary path', async () => {
    // The other direction, so the guard above cannot pass by refusing always.
    const plugin = createPlugin();

    await startKernel(plugin);

    expect(kernelOf(plugin)).not.toBeNull();
    expect(plugin.getExecutionKernel().registry).toBeDefined();
    await plugin.getExecutionKernel().dispose();
  });
});
