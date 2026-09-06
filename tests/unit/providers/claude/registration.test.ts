import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { updateClaudeProviderSettings } from '@/providers/claude/settings';

describe('Claude provider registration', () => {
  it('registers Claude as a toggleable provider', () => {
    expect(providerCatalog().ids()).toContain('claude');
    expect(providerCatalog().displayName('claude')).toBe('Claude');
    expect(providerCatalog().isEnabled({}, 'claude')).toBe(false);

    const settings: Record<string, unknown> = {};
    updateClaudeProviderSettings(settings, { enabled: true });

    expect(providerCatalog().isEnabled(settings, 'claude')).toBe(true);
  });
});
