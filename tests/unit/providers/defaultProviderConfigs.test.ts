import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

describe('getBuiltInProviderDefaultConfigs', () => {
  it('returns fresh built-in provider config objects', () => {
    const first = getBuiltInProviderDefaultConfigs();
    const second = getBuiltInProviderDefaultConfigs();

    expect(first).toHaveProperty('antigravity');
    expect(first).toHaveProperty('claude');
    expect(first).toHaveProperty('codex');
    expect(first).toHaveProperty('gemini');
    expect(first).toHaveProperty('opencode');
    expect(first).toHaveProperty('qwen');
    expect(first).toHaveProperty('grok');
    expect(first).not.toBe(second);
    expect(first.antigravity).not.toBe(second.antigravity);
    expect(first.claude).not.toBe(second.claude);
    expect(first.codex).not.toBe(second.codex);
    expect(first.gemini).not.toBe(second.gemini);
    expect(first.opencode).not.toBe(second.opencode);
    expect(first.qwen).not.toBe(second.qwen);
  });

  it('keeps runtime, workspace, and default-config inventories in parity', () => {
    const runtimeProviderIds = ProviderRegistry.getRegisteredProviderIds();
    const defaultConfigProviderIds = Object.keys(getBuiltInProviderDefaultConfigs()).sort();

    expect([...runtimeProviderIds].sort()).toEqual(defaultConfigProviderIds);
    for (const providerId of runtimeProviderIds) {
      expect(ProviderWorkspaceRegistry.getCapabilities(providerId)).toBeDefined();
    }
  });
});
