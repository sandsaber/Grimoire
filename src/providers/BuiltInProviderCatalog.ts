import { ProviderCatalog } from '../core/providers/ProviderCatalog';
import { antigravityProviderModule } from './antigravity/AntigravityProviderModule';
import { claudeProviderModule } from './claude/ClaudeProviderModule';
import { codexProviderModule } from './codex/CodexProviderModule';
import { commandcodeProviderModule } from './commandcode/CommandcodeProviderModule';
import { devinProviderModule } from './devin/DevinProviderModule';
import { geminiProviderModule } from './gemini/GeminiProviderModule';
import { grokProviderModule } from './grok/GrokProviderModule';
import { kimicodeProviderModule } from './kimicode/KimicodeProviderModule';
import { mimocodeProviderModule } from './mimocode/MimocodeProviderModule';
import { opencodeProviderModule } from './opencode/OpencodeProviderModule';
import { qwenProviderModule } from './qwen/QwenProviderModule';
import { reasonixProviderModule } from './reasonix/ReasonixProviderModule';

/**
 * The eleven built-in provider modules, in no particular order.
 *
 * Presentation order is `manifest.order`, which the catalog sorts by. Listing
 * them here in that order too would give a reader two sources for one fact and
 * a way for the two to disagree.
 */
const BUILT_IN_PROVIDER_MODULES = [
  antigravityProviderModule,
  claudeProviderModule,
  codexProviderModule,
  commandcodeProviderModule,
  devinProviderModule,
  geminiProviderModule,
  grokProviderModule,
  kimicodeProviderModule,
  mimocodeProviderModule,
  opencodeProviderModule,
  qwenProviderModule,
  reasonixProviderModule,
];

/** The sole provider inventory the application runs on. */
export const builtInProviderCatalog = new ProviderCatalog(BUILT_IN_PROVIDER_MODULES);
