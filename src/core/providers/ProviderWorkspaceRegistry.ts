import type GrimoirePlugin from '../../main';
import { HomeFileAdapter } from '../storage/HomeFileAdapter';
import type { ProviderCommandCatalog } from './commands/ProviderCommandCatalog';
import type {
  AgentMentionProvider,
  ProviderCliResolver,
  ProviderId,
  ProviderModelCatalog,
  ProviderPlanUsageProvider,
  ProviderRuntimeCommandLoader,
  ProviderSettingsTabRenderer,
  ProviderWorkspaceCapabilities,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from './types';

/**
 * Registry for provider-owned workspace/bootstrap services.
 *
 * Unlike `ProviderRegistry`, this boundary owns app-level provider services such
 * as command catalogs, mention providers, MCP/plugin/agent managers, and
 * provider-specific storage adaptors.
 */
export class ProviderWorkspaceRegistry {
  private static registrations: Partial<Record<ProviderId, ProviderWorkspaceRegistration>> = {};
  private static services: Partial<Record<ProviderId, ProviderWorkspaceServices>> = {};

  static register(
    providerId: ProviderId,
    registration: ProviderWorkspaceRegistration,
  ): void {
    this.registrations[providerId] = registration;
  }

  private static getWorkspaceRegistration(providerId: ProviderId): ProviderWorkspaceRegistration {
    const registration = this.registrations[providerId];
    if (!registration) {
      throw new Error(`Provider workspace "${providerId}" is not registered.`);
    }
    return registration;
  }

  /**
   * Builds one provider's services, without publishing them.
   *
   * Lifecycle belongs to `ProviderWorkspaceManager`, which decides when to
   * start, what a failure means, and what to release. This registry used to
   * bring every provider up in one loop that awaited each in turn with no
   * `try`: one throw and every provider after it in the iteration order was
   * never built. The fitness test reads this file for the name that loop had,
   * so it is described rather than written.
   */
  static createServices(
    providerId: ProviderId,
    plugin: GrimoirePlugin,
  ): Promise<ProviderWorkspaceServices> {
    const storage = plugin.storage;
    return this.getWorkspaceRegistration(providerId).initialize({
      plugin,
      storage,
      vaultAdapter: storage.getAdapter(),
      homeAdapter: new HomeFileAdapter(),
    });
  }

  static setServices(
    providerId: ProviderId,
    services: ProviderWorkspaceServices | undefined,
  ): void {
    if (services) {
      this.services[providerId] = services;
    } else {
      delete this.services[providerId];
    }
  }

  static clear(): void {
    this.services = {};
  }

  static getServices(
    providerId: ProviderId,
  ): ProviderWorkspaceServices | null {
    return this.services[providerId] ?? null;
  }

  static getCapabilities(providerId: ProviderId): ProviderWorkspaceCapabilities {
    return this.getWorkspaceRegistration(providerId).workspaceCapabilities;
  }

  static requireServices(
    providerId: ProviderId,
  ): ProviderWorkspaceServices {
    const services = this.getServices(providerId);
    if (!services) {
      throw new Error(`Provider workspace "${providerId}" is not initialized.`);
    }
    return services;
  }

  static getCommandCatalog(providerId: ProviderId): ProviderCommandCatalog | null {
    return this.getServices(providerId)?.commandCatalog ?? null;
  }

  static getAgentMentionProvider(providerId: ProviderId): AgentMentionProvider | null {
    return this.getServices(providerId)?.agentMentionProvider ?? null;
  }

  static async refreshAgentMentions(providerId: ProviderId): Promise<void> {
    await this.getServices(providerId)?.refreshAgentMentions?.();
  }

  static getCliResolver(providerId: ProviderId): ProviderCliResolver | null {
    return this.getServices(providerId)?.cliResolver ?? null;
  }

  static getModelCatalog(providerId: ProviderId): ProviderModelCatalog | null {
    return this.getServices(providerId)?.modelCatalog ?? null;
  }

  static getUsageProvider(providerId: ProviderId): ProviderPlanUsageProvider | null {
    return this.getServices(providerId)?.usageProvider ?? null;
  }

  static getRuntimeCommandLoader(providerId: ProviderId): ProviderRuntimeCommandLoader | null {
    return this.getServices(providerId)?.runtimeCommandLoader ?? null;
  }


  static getMcpServerManager(providerId: ProviderId) {
    return this.getServices(providerId)?.mcpServerManager ?? null;
  }

  static getSettingsTabRenderer(providerId: ProviderId): ProviderSettingsTabRenderer | null {
    return this.getServices(providerId)?.settingsTabRenderer ?? null;
  }
}
