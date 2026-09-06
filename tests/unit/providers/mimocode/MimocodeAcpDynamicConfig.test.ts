import trace from '@test/fixtures/provider-traces/mimocode-execution.json';
import wire from '@test/fixtures/provider-traces/wire/mimocode-wire.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionConfigOption, AcpSetSessionConfigOptionRequest } from '@/providers/acp/types';
import { MimocodeAcpDynamicConfigApplier } from '@/providers/mimocode/execution/MimocodeAcpDynamicConfig';

/** The options `mimo acp` really answered `session/new` with, from the recording. */
function recordedSessionConfigOptions(): AcpSessionConfigOption[] {
  const answered = wire.exchange
    .map(entry => (entry.message as { result?: { configOptions?: unknown } }).result)
    .find(result => Array.isArray(result?.configOptions));
  return (answered?.configOptions ?? []) as AcpSessionConfigOption[];
}

describe('MimocodeAcpDynamicConfigApplier', () => {
  it('applies mode then model before dispatch', async () => {
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new MimocodeAcpDynamicConfigApplier({
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

  it('drops a thinking level the recorded session has nowhere to put', async () => {
    // mimo 0.1.13 offers `model` and `mode` and no thought level at all — it
    // carries the level inside the model id instead. Setting one anyway is an
    // error from the agent where dropping it is a default, so the session is
    // asked rather than assumed, and the session here is the recorded one.
    const configOptions = recordedSessionConfigOptions();
    expect(configOptions.map(option => option.id)).toEqual(['model', 'mode']);

    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new MimocodeAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'provider/model', effortValue: 'high' }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      sessionConfigOptions: configOptions,
      signal: new AbortController().signal,
    });

    expect(setConfigOption.mock.calls.map(([request]) => request.configId)).toEqual(['model']);
  });

  it('sets a thinking level through the config id a session that has one names', async () => {
    // The other half of the same decision: MiMoCode's legacy runtime handles a
    // session that reports a thought level, so a later CLI growing one must not
    // need this rewritten.
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new MimocodeAcpDynamicConfigApplier({
      resolve: async () => ({ effortValue: 'high' }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      sessionConfigOptions: [{
        id: 'reasoning',
        name: 'Reasoning',
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
      { configId: 'reasoning', sessionId: 'native-session', type: 'select', value: 'high' },
    ]);
  });

  it('performs no provider call without an opaque config reference', async () => {
    const resolve = jest.fn();
    const applier = new MimocodeAcpDynamicConfigApplier({ resolve });
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
    const applier = new MimocodeAcpDynamicConfigApplier({
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
