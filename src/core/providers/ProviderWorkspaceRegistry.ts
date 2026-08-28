import type {
  ProviderId,
  ProviderWorkspaceServices,
} from './types';

/**
 * Where a provider's workspace services are, once something has built them.
 *
 * **Holding, and nothing else now.** It had four accessors over the services —
 * agent mentions, the command loader, the MCP manager, the settings tab — and
 * every one of them is a module slot; it had a registration table, and that is
 * the providers' own. What is left is the reason it exists at all: these
 * services are a per-provider singleton built asynchronously, while a module
 * context is per tab, so something has to hold the one instance between them.
 *
 * That is the last thing to move, and it is not a row: it is two lifecycles —
 * this and `ProviderWorkspaceContribution` — both claiming to own a provider's
 * workspace.
 */
export class ProviderWorkspaceRegistry {
  private static services: Partial<Record<ProviderId, ProviderWorkspaceServices>> = {};

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



}
