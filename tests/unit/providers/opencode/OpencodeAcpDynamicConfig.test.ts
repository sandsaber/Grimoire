import trace from '@test/fixtures/provider-traces/opencode-execution.json';
import compatibility from '@test/fixtures/provider-traces/opencode-mode-compatibility.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionConfigOption, AcpSetSessionConfigOptionRequest } from '@/providers/acp/types';
import { MimocodeAcpDynamicConfigApplier } from '@/providers/mimocode/execution/MimocodeAcpDynamicConfig';
import { OpencodeAcpDynamicConfigApplier } from '@/providers/opencode/execution/OpencodeAcpDynamicConfig';

describe('OpencodeAcpDynamicConfigApplier', () => {
  it.each([OpencodeAcpDynamicConfigApplier, MimocodeAcpDynamicConfigApplier])(
    'uses the selected model response instead of the previous model effort options', async Applier => {
      const setConfigOption = jest.fn(async () => ({ configOptions: [{
        id: 'model', name: 'Model', category: 'model', type: 'select' as const,
        currentValue: 'provider/new-model', options: [{ value: 'provider/new-model', name: 'New model' }],
      }] }));
      const applier = new Applier({ resolve: async () => ({
        modelId: 'provider/new-model', effort: { configId: 'effort', value: 'high' },
      }) });
      await applier.apply({
        client: { setConfigOption } as unknown as ManagedAcpClient,
        sessionId: 'native-session', dynamicRef: 'opaque-config', signal: new AbortController().signal,
        sessionConfigOptions: [{ id: 'effort', name: 'Effort', category: 'thought_level', type: 'select',
          currentValue: 'high', options: [{ value: 'high', name: 'High' }] }],
      });
      expect(setConfigOption).toHaveBeenCalledTimes(1);
      expect(setConfigOption).toHaveBeenCalledWith(expect.objectContaining({ configId: 'model' }));
    },
  );
  it.each(compatibility.probes.filter(probe => probe.setModeSucceeded))(
    'keeps Safe on the advertised managed agent with OpenCode $version',
    async (probe) => {
      const setConfigOption = jest.fn(async () => ({ configOptions: [] }));
      const applier = new OpencodeAcpDynamicConfigApplier({
        resolve: async () => ({ modeId: 'grimoire-safe' }),
      });
      await applier.apply({
        client: { setConfigOption } as unknown as ManagedAcpClient,
        sessionId: 'native-session',
        dynamicRef: 'opaque-config',
        sessionConfigOptions: probe.configOptions as AcpSessionConfigOption[],
        signal: new AbortController().signal,
      });
      expect(setConfigOption).toHaveBeenCalledWith({
        configId: 'mode', sessionId: 'native-session', type: 'select', value: 'grimoire-safe',
      });
    },
  );

  it.each(['grimoire-full-access', 'grimoire-safe'])(
    'rejects an unavailable managed mode %s without silently switching to build',
    async (modeId) => {
      const setConfigOption = jest.fn(async () => ({ configOptions: [] }));
      const applier = new OpencodeAcpDynamicConfigApplier({
        resolve: async () => ({ modeId, modelId: 'opencode/mimo-v2.6-flash-free' }),
      });

      await expect(applier.apply({
        client: { setConfigOption } as unknown as ManagedAcpClient,
        sessionId: 'native-session',
        dynamicRef: 'opaque-config',
        sessionConfigOptions: compatibility.probes.find(probe => probe.version === '2.0.15')!
          .configOptions as AcpSessionConfigOption[],
        signal: new AbortController().signal,
      })).rejects.toThrow('OpenCode did not expose the requested permission mode');
      expect(setConfigOption).not.toHaveBeenCalled();
    },
  );

  it('applies mode, model, and effort in provider-defined order before dispatch', async () => {
    const setConfigOption = jest.fn(async (_request: AcpSetSessionConfigOptionRequest) => ({
      configOptions: [],
    }));
    const applier = new OpencodeAcpDynamicConfigApplier({
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
    const applier = new OpencodeAcpDynamicConfigApplier({ resolve });
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
    const applier = new OpencodeAcpDynamicConfigApplier({
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
