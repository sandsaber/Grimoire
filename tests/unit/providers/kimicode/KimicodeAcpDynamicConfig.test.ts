import trace from '@test/fixtures/provider-traces/kimicode-execution.json';
import wire from '@test/fixtures/provider-traces/wire/kimicode-wire.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionConfigOption, AcpSetSessionConfigOptionRequest } from '@/providers/acp/types';
import { KimicodeAcpDynamicConfigApplier } from '@/providers/kimicode/execution/KimicodeAcpDynamicConfig';

describe('KimicodeAcpDynamicConfigApplier', () => {
  it('applies mode then model before dispatch', async () => {
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new KimicodeAcpDynamicConfigApplier({
      resolve: async () => ({ modeId: 'plan', modelId: 'provider/model' }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(setConfigOption.mock.calls.map(([request]) => request)).toEqual([
      { configId: 'mode', sessionId: 'native-session', type: 'select', value: 'plan' },
      { configId: 'model', sessionId: 'native-session', type: 'select', value: 'provider/model' },
    ]);
    expect(setConfigOption.mock.calls.map(([request]) => (
      `set-config:${request.configId}:${request.value}`
    ))).toEqual(trace.cases.dynamicConfiguration);
  });

  it('has no recorded session to ask what Kimi Code offers', () => {
    // Stated rather than assumed, and asserted so it stops being true the day
    // someone re-records on a logged-in machine: `kimi acp` refused
    // `session/new` with "Authentication required", so nothing has ever seen
    // this provider's config options. Every claim about them below is about the
    // applier's behaviour, not about the CLI's.
    expect(wire.coverage).toBe('partial');
    expect(wire.cases).toEqual(['initialize', 'session/new']);
    const answered = wire.exchange
      .map(entry => (entry.message as { result?: { configOptions?: unknown } }).result)
      .find(result => Array.isArray(result?.configOptions));
    expect(answered).toBeUndefined();
  });

  it('drops a thinking level when the session offers nowhere to put it', async () => {
    // Which is what a session with no config options at all looks like — the
    // only shape this provider's recording can stand behind. Setting a level
    // the agent does not have is an error where dropping it is a default.
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new KimicodeAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'provider/model', effortValue: 'high' }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      sessionConfigOptions: [],
      signal: new AbortController().signal,
    });

    expect(setConfigOption.mock.calls.map(([request]) => request.configId)).toEqual(['model']);
  });

  it('drops a thinking level when the session reports options but no level among them', async () => {
    // The case an empty list cannot reach: options are present, so the applier
    // gets as far as looking for a thought level, and there is none. Breaking
    // the guard to fall back on a guessed config id passes the empty case and
    // fails here, which is why both are written.
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new KimicodeAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'provider/model', effortValue: 'high' }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      sessionConfigOptions: [{
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'default',
        options: [
          { value: 'auto', name: 'Auto' },
          { value: 'default', name: 'Default' },
          { value: 'plan', name: 'Plan' },
        ],
      }] as AcpSessionConfigOption[],
      signal: new AbortController().signal,
    });

    expect(setConfigOption.mock.calls.map(([request]) => request.configId)).toEqual(['model']);
  });

  it('sets a thinking level through the config id a session that has one names', async () => {
    // The other half, and the one `KimicodeChatRuntime` has been doing on the
    // legacy path: it reads a thought-level config id off whatever the session
    // reports. A CLI that offers one must not need this rewritten.
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new KimicodeAcpDynamicConfigApplier({
      resolve: async () => ({ effortValue: 'high' }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      sessionConfigOptions: [{
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'low',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      }] as AcpSessionConfigOption[],
      signal: new AbortController().signal,
    });

    expect(setConfigOption.mock.calls.map(([request]) => request)).toEqual([
      { configId: 'effort', sessionId: 'native-session', type: 'select', value: 'high' },
    ]);
  });

  it('performs no provider call without an opaque config reference', async () => {
    const resolve = jest.fn();
    const applier = new KimicodeAcpDynamicConfigApplier({ resolve });
    await applier.apply({
      client: {} as ManagedAcpClient,
      sessionId: 'native-session',
      signal: new AbortController().signal,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('stops ordered updates when the owning run is aborted between provider calls', async () => {
    const abort = new AbortController();
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => {
      abort.abort(new Error('settings transition'));
      return { configOptions: [] };
    });
    const applier = new KimicodeAcpDynamicConfigApplier({
      resolve: async () => ({ modeId: 'plan', modelId: 'provider/model' }),
    });

    await expect(applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(setConfigOption).toHaveBeenCalledTimes(1);
  });
});
