import trace from '@test/fixtures/provider-traces/mimocode-execution.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSetSessionConfigOptionRequest } from '@/providers/acp/types';
import { MimocodeAcpDynamicConfigApplier } from '@/providers/mimocode/execution/MimocodeAcpDynamicConfig';

describe('MimocodeAcpDynamicConfigApplier', () => {
  it('applies mode, model, and effort in provider-defined order before dispatch', async () => {
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new MimocodeAcpDynamicConfigApplier({
      resolve: async () => ({
        modeId: 'plan',
        modelId: 'provider/model',
        effort: { configId: 'variant', value: 'high' },
      }),
    });

    await applier.apply({
      client: { setConfigOption } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(setConfigOption.mock.calls.map(([request]) => request)).toEqual([
      { configId: 'mode', sessionId: 'native-session', type: 'select', value: 'plan' },
      {
        configId: 'model',
        sessionId: 'native-session',
        type: 'select',
        value: 'provider/model',
      },
      { configId: 'variant', sessionId: 'native-session', type: 'select', value: 'high' },
    ]);
    expect(setConfigOption.mock.calls.map(([request]) => (
      `set-config:${request.configId}:${request.value}`
    ))).toEqual(trace.cases.dynamicConfiguration);
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
