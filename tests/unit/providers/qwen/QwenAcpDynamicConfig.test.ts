import trace from '@test/fixtures/provider-traces/qwen-execution.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionNotification } from '@/providers/acp/types';
import { QwenAcpDynamicConfigApplier } from '@/providers/qwen/execution/QwenAcpDynamicConfig';

describe('QwenAcpDynamicConfigApplier', () => {
  it('applies native model, mode, and effort turns in order and caches by client session', async () => {
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
      prompt: jest.fn(async ({ prompt }: { prompt: Array<{ text?: string }> }) => {
        calls.push(`control-prompt:${prompt[0]?.text}`);
        return { stopReason: 'end_turn' };
      }),
      onSessionNotification: () => () => undefined,
    } as unknown as ManagedAcpClient;
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'qwen3-coder', modeId: 'plan', effortLevel: 'xhigh' }),
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
    expect(client.prompt).toHaveBeenCalledTimes(1);
  });

  it('fails before the user turn when effort control is rejected', async () => {
    const client = {
      setModel: jest.fn(async () => ({})),
      setMode: jest.fn(async () => ({})),
      prompt: jest.fn(async () => ({ stopReason: 'cancelled' })),
      onSessionNotification: () => () => undefined,
    } as unknown as ManagedAcpClient;
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'model', modeId: 'default', effortLevel: 'high' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    })).rejects.toThrow('effort selection was rejected');
  });

  it('stops the ordered transition when its owning preparation is aborted', async () => {
    const abort = new AbortController();
    const setModel = jest.fn(async () => {
      abort.abort(new Error('settings transition'));
      return {};
    });
    const setMode = jest.fn(async () => ({}));
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'model', modeId: 'plan', effortLevel: 'high' }),
    });

    await expect(applier.apply({
      client: { setModel, setMode } as unknown as ManagedAcpClient,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(setMode).not.toHaveBeenCalled();
  });

  it('rejects a resolved control turn whose Qwen output reports a command failure', async () => {
    let listener: ((notification: AcpSessionNotification) => void) | undefined;
    const client = {
      setModel: jest.fn(async () => ({})),
      setMode: jest.fn(async () => ({})),
      onSessionNotification: jest.fn((next: typeof listener) => {
        listener = next;
        return () => { listener = undefined; };
      }),
      prompt: jest.fn(async () => {
        listener?.({
          sessionId: 'native-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Settings service not available.' },
          },
        });
        return { stopReason: 'end_turn' };
      }),
    } as unknown as ManagedAcpClient;
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ effortLevel: 'high' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    })).rejects.toThrow('effort selection was rejected');
  });
});
