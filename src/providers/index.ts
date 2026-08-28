import { installProviderCatalog } from '../core/providers/ProviderCatalog';
import type {
  ProviderWorkspaceInitContext,
  ProviderWorkspaceServices,
} from '../core/providers/types';
import type { ProviderId } from '../core/types/provider';
import { antigravityWorkspaceRegistration } from './antigravity/app/AntigravityWorkspaceServices';
import { builtInProviderCatalog } from './BuiltInProviderCatalog';
import { claudeWorkspaceRegistration } from './claude/app/ClaudeWorkspaceServices';
import { codexWorkspaceRegistration } from './codex/app/CodexWorkspaceServices';
import { geminiWorkspaceRegistration } from './gemini/app/GeminiWorkspaceServices';
import { grokWorkspaceRegistration } from './grok/app/GrokWorkspaceServices';
import { kimicodeWorkspaceRegistration } from './kimicode/app/KimicodeWorkspaceServices';
import { mimocodeWorkspaceRegistration } from './mimocode/app/MimocodeWorkspaceServices';
import { opencodeWorkspaceRegistration } from './opencode/app/OpencodeWorkspaceServices';
import { qwenWorkspaceRegistration } from './qwen/app/QwenWorkspaceServices';

/**
 * How each built-in provider builds its workspace services.
 *
 * **A table rather than a registration, because that is all a registration was
 * left holding.** It carried a capability map beside this, duplicated from the
 * module's own descriptor and kept in step by a test; that copy is deleted, and
 * a one-member interface reached through a registry is a lookup with ceremony.
 * `main.ts` drives these through `ProviderWorkspaceManager`, which is what
 * decides when a provider starts, what a failure means, and what is released.
 */
export const builtInWorkspaceInitializers: Readonly<Record<
  ProviderId,
  (context: ProviderWorkspaceInitContext) => Promise<ProviderWorkspaceServices>
>> = {
  antigravity: context => antigravityWorkspaceRegistration.initialize(context),
  claude: context => claudeWorkspaceRegistration.initialize(context),
  codex: context => codexWorkspaceRegistration.initialize(context),
  gemini: context => geminiWorkspaceRegistration.initialize(context),
  grok: context => grokWorkspaceRegistration.initialize(context),
  kimicode: context => kimicodeWorkspaceRegistration.initialize(context),
  mimocode: context => mimocodeWorkspaceRegistration.initialize(context),
  opencode: context => opencodeWorkspaceRegistration.initialize(context),
  qwen: context => qwenWorkspaceRegistration.initialize(context),
};

let builtInProvidersRegistered = false;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  installProviderCatalog(builtInProviderCatalog);
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();
