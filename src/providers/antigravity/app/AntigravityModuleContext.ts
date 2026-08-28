import type GrimoirePlugin from '../../../main';
import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';
import { createWorkspaceContextSlots } from '../../shared/workspaceContextSlots';
import type { AntigravityWorkspaceContext } from '../AntigravityProviderModule';
import { antigravityChatUIConfig } from '../ui/AntigravityChatUIConfig';
import { maybeGetAntigravityWorkspaceServices } from './AntigravityWorkspaceServices';

/**
 * The module's context over the running plugin.
 *
 * The smallest of the nine, and the last to get one: Antigravity runs in print
 * mode, so it has no conversation to bind to, no history to hydrate and no
 * session to resolve — three slots and nothing else. Its workspace contribution
 * was built inline in the module until now, which is why it was the one
 * provider with no context at all.
 */
export function createAntigravityModuleContext(
  plugin: GrimoirePlugin,
): AntigravityWorkspaceContext {
  const workspace = createWorkspaceContextSlots({
    chatUI: antigravityChatUIConfig,
    plugin,
    providerId: 'antigravity',
    services: () => maybeGetAntigravityWorkspaceServices(plugin),
  });

  return {
    listModels: () => workspace.listModels(),
    refreshModels: () => workspace.refreshModels(),
    renderSettingsTab: host => {
      const rendered = host as {
        container: HTMLElement;
        context: Parameters<ProviderSettingsTabRenderer['render']>[1];
      };
      maybeGetAntigravityWorkspaceServices(plugin)?.settingsTabRenderer
        ?.render(rendered.container, rendered.context);
    },
  };
}
