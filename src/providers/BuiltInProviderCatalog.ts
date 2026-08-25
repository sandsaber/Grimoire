import { ProviderCatalog } from '../core/providers/ProviderCatalog';
import { antigravityProviderModule } from './antigravity/AntigravityProviderModule';
import { claudeProviderModule } from './claude/ClaudeProviderModule';
import { codexProviderModule } from './codex/CodexProviderModule';
import { geminiProviderModule } from './gemini/GeminiProviderModule';
import { grokProviderModule } from './grok/GrokProviderModule';
import { kimicodeProviderModule } from './kimicode/KimicodeProviderModule';
import { mimocodeProviderModule } from './mimocode/MimocodeProviderModule';
import { opencodeProviderModule } from './opencode/OpencodeProviderModule';
import { qwenProviderModule } from './qwen/QwenProviderModule';

/**
 * The nine built-in provider modules, in no particular order.
 *
 * Presentation order is `manifest.order`, which the catalog sorts by. Listing
 * them here in that order too would give a reader two sources for one fact and
 * a way for the two to disagree.
 */
const BUILT_IN_PROVIDER_MODULES = [
  antigravityProviderModule,
  claudeProviderModule,
  codexProviderModule,
  geminiProviderModule,
  grokProviderModule,
  kimicodeProviderModule,
  mimocodeProviderModule,
  opencodeProviderModule,
  qwenProviderModule,
];

/** The sole provider inventory the application runs on. */
export const builtInProviderCatalog = new ProviderCatalog(BUILT_IN_PROVIDER_MODULES);
