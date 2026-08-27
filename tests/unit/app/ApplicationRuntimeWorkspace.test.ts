import '@/providers';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { ApplicationRuntime } from '@/app/ApplicationRuntime';
import { providerCatalog } from '@/core/providers/ProviderCatalog';

/**
 * The one call a consumer will reach a provider's workspace through.
 *
 * Until this existed, `workspace.initialize` was called for exactly one
 * provider and no consumer could reach the slots at all — which is why every
 * workspace row was blocked regardless of whether its slot fitted.
 */
describe('ApplicationRuntime workspace lookup', () => {
  function runtime(): ApplicationRuntime {
    return new ApplicationRuntime({
      adapter: createDurableInMemoryVaultAdapter(),
      defaultProviderId: 'codex',
      plugin: {
        app: { vault: { adapter: { basePath: '/vault' } } },
        getActiveEnvironmentVariables: () => '',
        getResolvedProviderCliPath: () => null,
        recordDebugLog: () => undefined,
        settings: {},
      } as never,
      report: () => undefined,
      resolveTitleProviderId: () => 'codex',
      sessions: {
        records: {} as never,
        toConversation: (() => null) as never,
        toSessionMetadata: (() => null) as never,
      },
    });
  }

  it('answers for every provider the catalog holds', async () => {
    const app = runtime();

    // Every one, not the one that happened to be wired, and asserted on the
    // slots rather than on the object: a provider missing from the switch
    // answers with an empty workspace, which is `defined` and would have let
    // this pass while every UI surface rendered as though the provider had
    // nothing to offer.
    for (const providerId of providerCatalog().ids()) {
      const workspace = await app.workspaceFor(providerId);
      expect(Object.keys(workspace)).not.toEqual([]);
    }

    app.dispose();
  });

  it('gives every caller the same workspace for one provider', async () => {
    const app = runtime();

    const [first, second] = await Promise.all([
      app.workspaceFor('codex'),
      app.workspaceFor('codex'),
    ]);

    expect(first).toBe(second);
    app.dispose();
  });

  it('reads a provider this build does not compose as one with nothing to offer', async () => {
    const app = runtime();

    // Not a throw: the catalog validates ids, so an id with no composition is
    // an id this build does not compose, which is the same statement as a
    // provider with no workspace.
    await expect(app.workspaceFor('nonesuch')).resolves.toEqual({});

    app.dispose();
  });
});
