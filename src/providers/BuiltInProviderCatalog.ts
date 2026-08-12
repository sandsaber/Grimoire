import { ProviderCatalog } from '@/core/providers/ProviderCatalog';

import { antigravityProviderModule } from './antigravity/AntigravityProviderModule';
import { claudeProviderModule } from './claude/ClaudeProviderModule';
import { codexProviderModule } from './codex/CodexProviderModule';
import { geminiProviderModule } from './gemini/GeminiProviderModule';
import { grokProviderModule } from './grok/GrokProviderModule';
import { kimicodeProviderModule } from './kimicode/KimicodeProviderModule';
import { mimocodeProviderModule } from './mimocode/MimocodeProviderModule';
import { opencodeProviderModule } from './opencode/OpencodeProviderModule';
import { qwenProviderModule } from './qwen/QwenProviderModule';

const BUILT_IN_PROVIDER_MODULES = Object.freeze([
  claudeProviderModule,
  codexProviderModule,
  opencodeProviderModule,
  grokProviderModule,
  mimocodeProviderModule,
  kimicodeProviderModule,
  antigravityProviderModule,
  geminiProviderModule,
  qwenProviderModule,
]);

/** The sole module inventory for the new provider architecture. */
export const builtInProviderCatalog: ProviderCatalog = new ProviderCatalog(
  BUILT_IN_PROVIDER_MODULES,
);
Object.freeze(builtInProviderCatalog);
