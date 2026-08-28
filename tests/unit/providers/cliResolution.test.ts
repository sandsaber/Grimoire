import '@/providers';

import { execPath } from 'node:process';

import { providerCatalog } from '@/core/providers/ProviderCatalog';

/**
 * Where each provider's CLI is, asked of the declaration.
 *
 * This was `ProviderWorkspaceSlots.cliResolution`, an async
 * `resolve(): Promise<ProviderCliResolution>` taking no settings — and neither
 * half fitted. All nine implementations answer synchronously from a memo, and
 * `getResolvedProviderCliPath` has 33 call sites of which none awaits. More
 * fundamentally, a CLI path is what a workspace is *created* with: the process
 * the workspace wraps is launched with it, so a port reachable only once the
 * workspace exists cannot answer at launch, which is when it is asked.
 *
 * The assertions here are deliberately machine-independent. What a resolver
 * discovers on `PATH` is whatever this machine has installed, so what is pinned
 * is that a *configured* path wins — which is the half a user controls, and the
 * half a settings-blind port could not have read.
 */
describe('provider CLI resolution', () => {
  const catalog = providerCatalog();

  it.each(catalog.ids())('%s declares where to find its CLI', (providerId) => {
    expect(catalog.declarations(providerId).cli).toBeDefined();
  });

  it.each(catalog.ids())('%s takes the configured path from the settings it is given', (providerId) => {
    // `execPath` because a resolver checks that a configured path exists before
    // trusting it, and the node binary running this test always does.
    const resolved = catalog.declarations(providerId).cli?.resolve({
      providerConfigs: { [providerId]: { cliPath: execPath } },
    });

    expect(resolved).toBe(execPath);
  });
});
