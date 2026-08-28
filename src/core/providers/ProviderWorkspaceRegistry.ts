import type {
  ProviderId,
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
   * This provider's workspace contribution.
   *
   * The registry used to *build* the services too, which meant taking a plugin
   * to assemble the context the contribution's `initialize` wants — the last
   * reason anything in `src/core/providers` named the plugin type. Building it
   * is the application's job and its one caller already holds a plugin, so what
   * is left here is the holding.
   *
   * Lifecycle belongs to `ProviderWorkspaceManager`, which decides when to
   * start, what a failure means, and what to release. An earlier version brought
   * every provider up in one loop that awaited each in turn with no `try`: one
   * throw and every provider after it in the iteration order was never built.
   * The fitness test reads this file for the name that loop had, so it is
   * described rather than written.
   */
  static contributionFor(providerId: ProviderId): ProviderWorkspaceRegistration {
    return this.getWorkspaceRegistration(providerId);
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

  static requireServices(
    providerId: ProviderId,
  ): ProviderWorkspaceServices {
    const services = this.getServices(providerId);
    if (!services) {
      throw new Error(`Provider workspace "${providerId}" is not initialized.`);
    }
    return services;
  }


  static getMcpServerManager(providerId: ProviderId) {
    return this.getServices(providerId)?.mcpServerManager ?? null;
  }

}
