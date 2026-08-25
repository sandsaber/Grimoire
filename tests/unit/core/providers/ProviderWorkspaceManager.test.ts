import {
  type ProviderWorkspaceContribution,
  type ProviderWorkspaceFailure,
  ProviderWorkspaceManager,
} from '@/core/providers/ProviderWorkspaceManager';

interface TestWorkspace {
  readonly providerId: string;
  disposed: boolean;
}

/** A contribution whose initialize resolves when the test says so. */
function deferredContribution(providerId: string) {
  let settle: ((workspace: TestWorkspace) => void) | undefined;
  let fail: ((error: unknown) => void) | undefined;
  const workspaces: TestWorkspace[] = [];
  let starts = 0;
  const contribution: ProviderWorkspaceContribution<TestWorkspace> = {
    initialize: signal => {
      starts += 1;
      return new Promise<TestWorkspace>((resolve, reject) => {
        settle = workspace => resolve(workspace);
        fail = reject;
        void signal;
      });
    },
    dispose: async workspace => {
      workspace.disposed = true;
    },
  };
  return {
    contribution,
    workspaces,
    get starts() {
      return starts;
    },
    ready(): TestWorkspace {
      const workspace = { providerId, disposed: false };
      workspaces.push(workspace);
      settle?.(workspace);
      return workspace;
    },
    reject(error: unknown): void {
      fail?.(error);
    },
  };
}

function immediateContribution(providerId: string): {
  contribution: ProviderWorkspaceContribution<TestWorkspace>;
  workspaces: TestWorkspace[];
} {
  const workspaces: TestWorkspace[] = [];
  return {
    workspaces,
    contribution: {
      initialize: async () => {
        const workspace = { providerId, disposed: false };
        workspaces.push(workspace);
        return workspace;
      },
      dispose: async workspace => {
        workspace.disposed = true;
      },
    },
  };
}

function createManager(
  contributions: Record<string, ProviderWorkspaceContribution<TestWorkspace> | null>,
) {
  const published: Record<string, TestWorkspace | null> = {};
  const failures: ProviderWorkspaceFailure[] = [];
  const manager = new ProviderWorkspaceManager<TestWorkspace>({
    contribution: providerId => contributions[providerId] ?? null,
    publish: (providerId, workspace) => {
      published[providerId] = workspace;
    },
    reportFailure: failure => {
      failures.push(failure);
    },
  });
  return { manager, published, failures };
}

describe('ProviderWorkspaceManager', () => {
  describe('initialization', () => {
    it('publishes a workspace once it is ready', async () => {
      const one = immediateContribution('one');
      const { manager, published } = createManager({ one: one.contribution });

      await expect(manager.initialize('one')).resolves.toBe(true);

      expect(published.one).toBe(one.workspaces[0]);
      expect(manager.stateOf('one')).toBe('ready');
    });

    it('says nothing is ready for a provider with no workspace at all', async () => {
      const { manager, published } = createManager({ one: null });

      await expect(manager.initialize('one')).resolves.toBe(false);

      expect(published).toEqual({});
      expect(manager.stateOf('one')).toBe('uninitialized');
    });

    it('joins an attempt already in flight instead of starting a second', async () => {
      const one = deferredContribution('one');
      const { manager } = createManager({ one: one.contribution });

      const first = manager.initialize('one');
      const second = manager.initialize('one');
      one.ready();

      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
      expect(one.starts).toBe(1);
    });

    it('does nothing on a second call once a workspace is ready', async () => {
      const one = immediateContribution('one');
      const { manager } = createManager({ one: one.contribution });

      await manager.initialize('one');
      await manager.initialize('one');

      expect(one.workspaces).toHaveLength(1);
    });
  });

  describe('failure isolation', () => {
    it('initializes every other provider when one fails', async () => {
      const first = immediateContribution('first');
      const third = immediateContribution('third');
      const { manager, published, failures } = createManager({
        first: first.contribution,
        second: {
          initialize: async () => {
            throw new Error('no CLI on this machine');
          },
          dispose: async () => {},
        },
        third: third.contribution,
      });

      // The loop this replaces awaited each initializer in turn with no `try`,
      // so a provider that threw took every provider after it with it — and
      // which ones those were depended on iteration order.
      await expect(manager.initializeAll(['first', 'second', 'third'])).resolves.toBeUndefined();

      expect(manager.stateOf('first')).toBe('ready');
      expect(manager.stateOf('second')).toBe('failed');
      expect(manager.stateOf('third')).toBe('ready');
      expect(published.third).toBe(third.workspaces[0]);
      expect(failures).toEqual([
        { providerId: 'second', phase: 'initialize', error: expect.any(Error) },
      ]);
    });

    it('withdraws whatever was published for a provider that fails', async () => {
      const one = deferredContribution('one');
      const { manager, published } = createManager({ one: one.contribution });

      const attempt = manager.initialize('one');
      one.reject(new Error('failed'));
      await attempt;

      expect(published.one).toBeNull();
    });

    it('retries a failed provider on the next request', async () => {
      let attempts = 0;
      const workspace: TestWorkspace = { providerId: 'one', disposed: false };
      const { manager, published } = createManager({
        one: {
          initialize: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error('not yet');
            }
            return workspace;
          },
          dispose: async () => {},
        },
      });

      await expect(manager.initialize('one')).resolves.toBe(false);
      await expect(manager.initialize('one')).resolves.toBe(true);

      expect(published.one).toBe(workspace);
      expect(manager.stateOf('one')).toBe('ready');
    });
  });

  describe('teardown', () => {
    it('disposes every ready workspace and withdraws it', async () => {
      const one = immediateContribution('one');
      const two = immediateContribution('two');
      const { manager, published } = createManager({
        one: one.contribution,
        two: two.contribution,
      });
      await manager.initializeAll(['one', 'two']);

      await manager.disposeAll();

      expect(one.workspaces[0].disposed).toBe(true);
      expect(two.workspaces[0].disposed).toBe(true);
      expect(published).toEqual({ one: null, two: null });
      expect(manager.stateOf('one')).toBe('disposed');
    });

    it('disposes a workspace that arrives after teardown started', async () => {
      // The reload case: an initializer that outruns unload used to publish
      // into a static map the next load then read.
      const one = deferredContribution('one');
      const { manager, published } = createManager({ one: one.contribution });
      const attempt = manager.initialize('one');

      const teardown = manager.disposeAll();
      const workspace = one.ready();
      await Promise.all([attempt, teardown]);

      expect(workspace.disposed).toBe(true);
      expect(published.one).toBeNull();
    });

    it('keeps disposing after one provider throws on the way out', async () => {
      const two = immediateContribution('two');
      const { manager, failures } = createManager({
        one: {
          initialize: async () => ({ providerId: 'one', disposed: false }),
          dispose: async () => {
            throw new Error('release failed');
          },
        },
        two: two.contribution,
      });
      await manager.initializeAll(['one', 'two']);

      await expect(manager.disposeAll()).resolves.toBeUndefined();

      expect(two.workspaces[0].disposed).toBe(true);
      expect(failures).toEqual([
        { providerId: 'one', phase: 'dispose', error: expect.any(Error) },
      ]);
    });

    it('admits nothing once it is closed', async () => {
      const one = immediateContribution('one');
      const { manager } = createManager({ one: one.contribution });
      await manager.disposeAll();

      await expect(manager.initialize('one')).resolves.toBe(false);

      expect(one.workspaces).toEqual([]);
    });

    it('is safe to close twice', async () => {
      const one = immediateContribution('one');
      const { manager } = createManager({ one: one.contribution });
      await manager.initialize('one');

      await manager.disposeAll();
      await manager.disposeAll();

      expect(one.workspaces[0].disposed).toBe(true);
    });
  });
});
