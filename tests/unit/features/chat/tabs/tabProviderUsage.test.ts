import {
  getProviderUsageSnapshot,
  refreshProviderUsageSnapshot,
  summarizePlanUsage,
} from '@/features/chat/tabs/tabProviderUI';

/**
 * The plan a provider reports, on the two paths the indicator uses.
 *
 * This row moved from `ProviderWorkspaceRegistry.getUsageProvider` to the
 * module's `usage` port with **no test failing** — because nothing covered it
 * at all. A row that can move without breaking a test is a row nobody was
 * watching, so these are the assertions that were missing rather than the ones
 * that were adjusted.
 */
describe('provider plan usage', () => {
  function pluginWith(usage: unknown, built = true): never {
    const workspace = { usage };
    return {
      builtWorkspaceFor: () => (built ? workspace : null),
      getApplicationRuntimeOrNull() {
        return {
          builtWorkspaceFor: () => (built ? workspace : null),
          workspaceFor: async () => workspace,
        };
      },
      recordDebugLog: () => undefined,
      settings: {},
    } as never;
  }

  describe('the cached read, which happens while a tab paints', () => {
    it('reads what the provider already holds', () => {
      const plugin = pluginWith({
        cached: () => ({ plan: 'Max', windows: [{ label: '5h', pct: 40, reset: '2h' }] }),
        refresh: async () => null,
      });

      expect(getProviderUsageSnapshot(plugin, 'claude')).toEqual({
        plan: 'Max',
        windows: [{ label: '5h', pct: 40, reset: '2h' }],
      });
    });

    it('builds no workspace of its own', () => {
      const workspaceFor = jest.fn();
      const plugin = {
        getApplicationRuntimeOrNull: () => ({ builtWorkspaceFor: () => null, workspaceFor }),
      } as never;

      expect(getProviderUsageSnapshot(plugin, 'claude')).toBeNull();
      // This is the paint path. Building a workspace here would make the first
      // paint after a reload wait on whatever a provider does at startup.
      expect(workspaceFor).not.toHaveBeenCalled();
    });

    it('answers nothing when the application has no runtime', () => {
      expect(getProviderUsageSnapshot({ getApplicationRuntimeOrNull: () => null } as never, 'claude'))
        .toBeNull();
    });
  });

  describe('the refreshing read, which builds the workspace', () => {
    it('asks the provider and returns what it answered', async () => {
      const refresh = jest.fn(async () => ({ plan: 'Pro', spend: '$12.40' }));
      const plugin = pluginWith({ cached: () => null, refresh });

      await expect(refreshProviderUsageSnapshot(plugin, 'codex'))
        .resolves.toEqual({ plan: 'Pro', spend: '$12.40' });
      expect(refresh).toHaveBeenCalled();
    });

    it('falls back to the cached read for a provider with no usage port', async () => {
      const plugin = pluginWith(undefined);

      // Absent means unsupported: a provider that contributes no usage port is
      // one with no plan to report, not one that failed.
      await expect(refreshProviderUsageSnapshot(plugin, 'qwen')).resolves.toBeNull();
    });

    it('lets a refusal reach the caller rather than reporting no plan', async () => {
      const plugin = pluginWith({
        cached: () => null,
        refresh: async () => { throw new Error('rate limited'); },
      });

      // A failed refresh is not "this plan has no usage": the toolbar keeps the
      // snapshot it had and retries, which it cannot do if the failure is
      // flattened into `null`.
      await expect(refreshProviderUsageSnapshot(plugin, 'codex')).rejects.toThrow('rate limited');
    });
  });

  describe('what the debug log records', () => {
    it('names a plan with several windows as a quota plan, and keeps every window', () => {
      expect(summarizePlanUsage({
        plan: 'Max',
        windows: [
          { label: '5h', pct: 40, reset: '2h' },
          { label: 'week', pct: 80, pctKnown: false, reset: '3d' },
        ],
      })).toEqual({
        hasSpend: false,
        plan: 'Max',
        usageKind: 'quota',
        windowCount: 2,
        windows: [
          { label: '5h', pct: 40, reset: '2h' },
          { label: 'week', pct: 80, pctKnown: false, reset: '3d' },
        ],
      });
    });

    it('separates a spend plan, a quota plan, and one that is both', () => {
      const window = { label: '5h', pct: 10, reset: '1h' };

      expect(summarizePlanUsage({ plan: 'Pay as you go', spend: '$3' }).usageKind).toBe('spend');
      expect(summarizePlanUsage({ plan: 'Max', windows: [window] }).usageKind).toBe('quota');
      expect(summarizePlanUsage({ plan: 'Team', spend: '$3', windows: [window] }).usageKind)
        .toBe('hybrid');
      expect(summarizePlanUsage(null)).toEqual({ usageKind: 'none' });
    });
  });
});
