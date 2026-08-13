import type { ProviderId } from './types';

// ProviderRegistry removed. Model-to-provider routing now
// resolves through the application runtime; legacy callers fall back to the
// default provider until rewired.
export function getProviderForModel(_model: string, _settings?: Record<string, unknown>): ProviderId {
  return 'codex';
}

export function getEnabledProviderForModel(
  _model: string,
  _settings: Record<string, unknown>,
  fallbackProviderId?: ProviderId,
): ProviderId {
  return fallbackProviderId ?? ('codex');
}
