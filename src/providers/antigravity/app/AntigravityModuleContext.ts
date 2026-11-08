import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';

import type GrimoirePlugin from '../../../main';
import type {
  ProviderSettingsTabRenderer,
} from '../../../providers/shared/providerHostContracts';
import { createWorkspaceContextSlots } from '../../shared/workspaceContextSlots';
import type { AntigravityWorkspaceContext } from '../AntigravityProviderModule';
import { AntigravityConversationHistoryService } from '../history/AntigravityConversationHistoryService';
import { antigravityChatUIConfig } from '../ui/AntigravityChatUIConfig';
import { maybeGetAntigravityWorkspaceServices } from './AntigravityWorkspaceServices';

/** Workspace services are shared; history ports answer only for the bound tab. */
export function createAntigravityModuleContext(
  plugin: GrimoirePlugin,
  conversation: () => BoundConversation | null = () => null,
  ports: { sessionDropped(): boolean } = { sessionDropped: () => false },
): AntigravityWorkspaceContext {
  const history = new AntigravityConversationHistoryService();
  const workspace = createWorkspaceContextSlots({
    chatUI: antigravityChatUIConfig,
    plugin,
    providerId: 'antigravity',
    services: () => maybeGetAntigravityWorkspaceServices(plugin),
  });

  return {
    hydrateConversation: async () => ({ outcome: 'absent' }),
    deleteConversationSession: async () => undefined,
    resolveSessionId: id => conversation()?.id === id
      ? history.resolveSessionIdForConversation(conversation()) : null,
    isPendingFork: () => false,
    readSessionDropped: id => conversation()?.id === id ? ports.sessionDropped() : null,
    commandsPort: () => workspace.commandsPort(),
    cachedPlanUsage: () => workspace.cachedPlanUsage(),
    listModels: () => workspace.listModels(),
    // The options are forwarded, not dropped. A zero-argument function is
    // assignable to a one-optional-argument signature, so nothing here
    // fails to compile when it silently discards `force` — and the only
    // caller that sets it is the user asking for a rediscovery.
    refreshModels: options => workspace.refreshModels(options),
    refreshPlanUsage: () => workspace.refreshPlanUsage(),
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
