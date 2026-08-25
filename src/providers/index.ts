import { installProviderCatalog } from '../core/providers/ProviderCatalog';
import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import { antigravityWorkspaceRegistration } from './antigravity/app/AntigravityWorkspaceServices';
import { antigravityProviderRegistration } from './antigravity/registration';
import { builtInProviderCatalog } from './BuiltInProviderCatalog';
import { claudeWorkspaceRegistration } from './claude/app/ClaudeWorkspaceServices';
import { claudeProviderRegistration } from './claude/registration';
import { codexWorkspaceRegistration } from './codex/app/CodexWorkspaceServices';
import { codexProviderRegistration } from './codex/registration';
import { geminiWorkspaceRegistration } from './gemini/app/GeminiWorkspaceServices';
import { geminiProviderRegistration } from './gemini/registration';
import { grokWorkspaceRegistration } from './grok/app/GrokWorkspaceServices';
import { grokProviderRegistration } from './grok/registration';
import { kimicodeWorkspaceRegistration } from './kimicode/app/KimicodeWorkspaceServices';
import { kimicodeProviderRegistration } from './kimicode/registration';
import { mimocodeWorkspaceRegistration } from './mimocode/app/MimocodeWorkspaceServices';
import { mimocodeProviderRegistration } from './mimocode/registration';
import { opencodeWorkspaceRegistration } from './opencode/app/OpencodeWorkspaceServices';
import { opencodeProviderRegistration } from './opencode/registration';
import { qwenWorkspaceRegistration } from './qwen/app/QwenWorkspaceServices';
import { qwenProviderRegistration } from './qwen/registration';

let builtInProvidersRegistered = false;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  installProviderCatalog(builtInProviderCatalog);
  ProviderRegistry.register('claude', claudeProviderRegistration);
  ProviderRegistry.register('codex', codexProviderRegistration);
  ProviderRegistry.register('opencode', opencodeProviderRegistration);
  ProviderRegistry.register('grok', grokProviderRegistration);
  ProviderRegistry.register('mimocode', mimocodeProviderRegistration);
  ProviderRegistry.register('kimicode', kimicodeProviderRegistration);
  ProviderRegistry.register('antigravity', antigravityProviderRegistration);
  ProviderRegistry.register('gemini', geminiProviderRegistration);
  ProviderRegistry.register('qwen', qwenProviderRegistration);
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
