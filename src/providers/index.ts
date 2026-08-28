import { installProviderCatalog } from '../core/providers/ProviderCatalog';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
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

let builtInProvidersRegistered = false;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  installProviderCatalog(builtInProviderCatalog);
  ProviderWorkspaceRegistry.register('claude', claudeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('codex', codexWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('opencode', opencodeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('grok', grokWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('mimocode', mimocodeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('kimicode', kimicodeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('antigravity', antigravityWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('gemini', geminiWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('qwen', qwenWorkspaceRegistration);
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();
