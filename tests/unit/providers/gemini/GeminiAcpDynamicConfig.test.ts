import trace from '@test/fixtures/provider-traces/gemini-execution.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import { GeminiAcpDynamicConfigApplier } from '@/providers/gemini/execution/GeminiAcpDynamicConfig';

describe('GeminiAcpDynamicConfigApplier', () => {
  it('applies native model and mode in order and caches confirmed session state', async () => {
    const calls: string[] = [];
    const client = {
      setModel: jest.fn(async ({ modelId }: { modelId: string }) => {
        calls.push(`set-model:${modelId}`);
        return {};
      }),
      setMode: jest.fn(async ({ modeId }: { modeId: string }) => {
        calls.push(`set-mode:${modeId}`);
        return {};
      }),
    } as unknown as ManagedAcpClient;
    const applier = new GeminiAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'gemini-2.5-flash', modeId: 'plan' }),
    });
    const input = {
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    };

    await applier.apply(input);
    await applier.apply(input);

    expect(calls).toEqual(trace.cases.dynamicConfiguration);
    expect(client.setModel).toHaveBeenCalledTimes(1);
    expect(client.setMode).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected native transition', async () => {
    const setModel = jest.fn()
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockResolvedValue({});
    const applier = new GeminiAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'gemini-2.5-flash' }),
    });
    const input = {
      client: { setModel } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    };

    await expect(applier.apply(input)).rejects.toThrow('model unavailable');
    await expect(applier.apply(input)).resolves.toBeUndefined();
    expect(setModel).toHaveBeenCalledTimes(2);
  });

  it('stops the ordered transition when preparation is aborted', async () => {
    const abort = new AbortController();
    const setModel = jest.fn(async () => {
      abort.abort(new Error('settings transition'));
      return {};
    });
    const setMode = jest.fn(async () => ({}));
    const applier = new GeminiAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'model', modeId: 'plan' }),
    });

    await expect(applier.apply({
      client: { setModel, setMode } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(setMode).not.toHaveBeenCalled();
  });
});
