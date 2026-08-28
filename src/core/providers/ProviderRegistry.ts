import type { ChatRuntime } from '../runtime/ChatRuntime';
import { NO_TASK_RESULT_INTERPRETATION } from './noTaskResultInterpretation';
import { providerCatalog } from './ProviderCatalog';
import {
  type CreateChatRuntimeOptions,
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderConversationHistoryService,
  type ProviderId,
  type ProviderRegistration,
  type ProviderSubagentLifecycleAdapter,
  type ProviderTaskResultInterpreter,
} from './types';

/**
 * Registry for chat-facing provider services.
 *
 * Bootstrap concerns (default settings, shared storage, CLI resolution,
 * workspace command/agent services) are composed explicitly in `main.ts`
 * through `src/core/bootstrap/` and `src/providers/<id>/app/`.
 *
 * Which providers exist, what they are called, and what order they appear in
 * are no longer questions this class answers: the catalog owns them, and a
 * registration for a provider the catalog does not hold is refused rather than
 * kept as a second inventory.
 *
 * Neither is model routing. `resolveProviderForModel`, `resolveSettingsProviderId`,
 * `resolveTitleGenerationProviderId` and `getCustomModelIds` were statics here
 * only because they reached a provider's chat UI through this class; they are
 * `modelRouting.ts` now, over the catalog's declarations. Five members left,
 * and the chat-UI row is not one of them.
 */
export class ProviderRegistry {
  private static registrations: Partial<Record<ProviderId, ProviderRegistration>> = {};

  static register(
    providerId: ProviderId,
    registration: ProviderRegistration,
  ): void {
    if (!providerCatalog().get(providerId)) {
      throw new Error(`Provider "${providerId}" is not in the catalog.`);
    }
    this.registrations[providerId] = registration;
  }

  private static getProviderRegistration(providerId: ProviderId): ProviderRegistration {
    const registration = this.registrations[providerId];
    if (!registration) {
      throw new Error(`Provider "${providerId}" is not registered.`);
    }
    return registration;
  }

  static createChatRuntime(options: CreateChatRuntimeOptions): ChatRuntime {
    const providerId = options.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    return this.getProviderRegistration(providerId).createRuntime(options);
  }

  static getConversationHistoryService(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderConversationHistoryService {
    return this.getProviderRegistration(providerId).historyService;
  }

  static getTaskResultInterpreter(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderTaskResultInterpreter {
    return this.getProviderRegistration(providerId).taskResultInterpreter
      ?? NO_TASK_RESULT_INTERPRETATION;
  }

  static getSubagentLifecycleAdapter(
    providerId: ProviderId = DEFAULT_CHAT_PROVIDER_ID,
  ): ProviderSubagentLifecycleAdapter | null {
    return this.getProviderRegistration(providerId).subagentLifecycleAdapter ?? null;
  }
}
