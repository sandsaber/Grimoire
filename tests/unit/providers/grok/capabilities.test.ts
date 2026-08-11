import { GROK_PROVIDER_CAPABILITIES } from '@/providers/grok/capabilities';

describe('GROK_PROVIDER_CAPABILITIES', () => {
  it('should have grok as providerId', () => {
    expect(GROK_PROVIDER_CAPABILITIES.providerId).toBe('grok');
  });

  it('should support persistent runtime', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsPersistentRuntime).toBe(true);
  });

  it('should support native history', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(true);
  });

  it('should support plan mode', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(true);
  });

  it('should not advertise rewind while the runtime cannot perform it', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsRewind).toBe(false);
  });

  it('should not advertise fork while history cannot construct fork state', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsFork).toBe(false);
  });

  it('should support provider commands', () => {
    expect(GROK_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(true);
  });

  it('should use effort-based reasoning control', () => {
    expect(GROK_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
  });

  it('should be frozen', () => {
    expect(Object.isFrozen(GROK_PROVIDER_CAPABILITIES)).toBe(true);
  });
});
