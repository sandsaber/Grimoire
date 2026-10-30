import * as path from 'node:path';

import { buildGrokRuntimeEnv } from '@/providers/grok/runtime/GrokRuntimeEnvironment';

describe('buildGrokRuntimeEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, HOME: '/home/tester', USERPROFILE: '/home/tester' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('bridges managed GROK_HOME to the provider auth path from env resolution', () => {
    const env = buildGrokRuntimeEnv({}, '/usr/local/bin/grok', '/vault/.grimoire/grok');

    expect(env.GROK_HOME).toBe('/vault/.grimoire/grok');
    expect(env.GROK_AUTH_PATH).toBe(path.join('/home/tester', '.grok', 'auth.json'));
  });

  it('respects an explicit GROK_AUTH_PATH from provider env vars', () => {
    const env = buildGrokRuntimeEnv({
      providerConfigs: {
        grok: {
          environmentVariables: 'GROK_AUTH_PATH=/custom/auth.json',
        },
      },
    }, '/usr/local/bin/grok', '/vault/.grimoire/grok');

    expect(env.GROK_AUTH_PATH).toBe('/custom/auth.json');
  });

  it('does not inject GROK_AUTH_PATH when managed GROK_HOME is not used', () => {
    const env = buildGrokRuntimeEnv({}, '/usr/local/bin/grok');

    expect(env.GROK_HOME).toBeUndefined();
    expect(env.GROK_AUTH_PATH).toBeUndefined();
  });
});
