import * as fs from 'node:fs';

import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

export const GROK_DEBUG_LOG_SCOPE = 'provider.grok';

type GrokDebugLevel = 'debug' | 'info' | 'warn' | 'error';

export function summarizeGrokCliText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 240);
}

export function grokAuthPathExists(authPath: string | undefined): boolean {
  if (!authPath?.trim()) {
    return false;
  }

  try {
    return fs.existsSync(authPath.trim());
  } catch {
    return false;
  }
}

export function logGrokDebug(
  plugin: LegacyProviderContext,
  event: string,
  data: Record<string, unknown> = {},
  options?: {
    error?: unknown;
    level?: GrokDebugLevel;
  },
): void {
  plugin.recordDebugLog?.({
    data: {
      providerId: 'grok',
      ...data,
    },
    ...(options?.error !== undefined ? { error: options.error } : {}),
    event,
    level: options?.level ?? 'debug',
    scope: GROK_DEBUG_LOG_SCOPE,
  });
}
