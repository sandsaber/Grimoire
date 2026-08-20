import { JsonRpcErrorResponse } from '@/providers/acp';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionConfigOption } from '@/providers/acp/types';
import {
  type GrokAcpDynamicConfig,
  GrokAcpDynamicConfigApplier,
} from '@/providers/grok/execution/GrokAcpDynamicConfig';

/**
 * How a Grok turn is applied to the session it landed on.
 *
 * These are the legacy runtime's `applySelectedMode` and `applySelectedModel`
 * tests, moved onto the object that does it now. What they cover is the part
 * that was never about which value to send: a release that has no mode method
 * at all, an agent that refuses the value itself, and an error that is neither
 * — where sending on regardless, or failing the turn, are both wrong.
 */
describe('Grok ACP dynamic configuration', () => {
  const MODE_OPTION: AcpSessionConfigOption = {
    category: 'mode',
    currentValue: 'ask',
    id: 'session_mode',
    name: 'Mode',
    options: [{ name: 'Safe', value: 'ask' }, { name: 'Auto-approve', value: 'always-approve' }],
    type: 'select',
  } as never;

  interface Fake {
    readonly client: ManagedAcpClient;
    readonly modes: string[];
    readonly models: string[];
    readonly configOptions: Array<{ configId: string; value: unknown }>;
    readonly order: string[];
  }

  function createFake(options: {
    modeError?: Error;
    configOptionError?: Error;
  } = {}): Fake {
    const modes: string[] = [];
    const models: string[] = [];
    const configOptions: Array<{ configId: string; value: unknown }> = [];
    const order: string[] = [];
    const client = {
      setMode: async (request: { modeId: string }) => {
        order.push('mode');
        if (options.modeError) {
          throw options.modeError;
        }
        modes.push(request.modeId);
        return {};
      },
      setModel: async (request: { modelId: string }) => {
        order.push('model');
        models.push(request.modelId);
        return {};
      },
      setConfigOption: async (request: { configId: string; value: unknown }) => {
        order.push('configOption');
        if (options.configOptionError) {
          throw options.configOptionError;
        }
        configOptions.push({ configId: request.configId, value: request.value });
        return { configOptions: [] };
      },
    } as unknown as ManagedAcpClient;
    return { client, modes, models, configOptions, order };
  }

  function apply(
    fake: Fake,
    config: GrokAcpDynamicConfig,
    sessionConfigOptions?: readonly AcpSessionConfigOption[],
  ): Promise<void> {
    const applier = new GrokAcpDynamicConfigApplier({ resolve: async () => config });
    return applier.apply({
      client: fake.client,
      sessionId: 'grok-session',
      dynamicRef: 'dynamic-1',
      signal: new AbortController().signal,
      ...(sessionConfigOptions ? { sessionConfigOptions } : {}),
    });
  }

  it('sets the model before the mode', async () => {
    const fake = createFake();

    await apply(fake, { modeId: 'always-approve', modelId: 'grok-4.6' });

    // The mode a turn runs under is a property of the session; the model is
    // what answers it. A mode applied first is a mode applied to a session
    // about to change model underneath it.
    expect(fake.order).toEqual(['model', 'mode']);
    expect(fake.models).toEqual(['grok-4.6']);
    expect(fake.modes).toEqual(['always-approve']);
  });

  it('falls back to the advertised config option when the release has no mode method', async () => {
    const fake = createFake({
      modeError: new JsonRpcErrorResponse('session/set_mode', -32601, 'Method not found'),
    });

    await apply(fake, { modeId: 'always-approve' }, [MODE_OPTION]);

    expect(fake.configOptions).toEqual([
      { configId: 'session_mode', value: 'always-approve' },
    ]);
  });

  it('leaves the launch policy alone when there is no method and no option', async () => {
    const fake = createFake({
      modeError: new JsonRpcErrorResponse('session/set_mode', -32601, 'Method not found'),
    });

    // This release takes its policy on the command line, which the launch
    // already carried. Nothing to send, and nothing to fail.
    await expect(apply(fake, { modeId: 'always-approve' })).resolves.toBeUndefined();

    expect(fake.configOptions).toEqual([]);
  });

  it('keeps the turn alive when the agent says it has no such mode', async () => {
    const fake = createFake({
      modeError: new JsonRpcErrorResponse('session/set_mode', -32602, 'Invalid params'),
    });

    // Not a failed turn: the agent is saying it has no such mode, and the turn
    // runs on the one it does have. Failing here would refuse a turn over a
    // toolbar value the agent never offered.
    await expect(apply(fake, { modeId: 'plan' }, [MODE_OPTION])).resolves.toBeUndefined();

    expect(fake.configOptions).toEqual([]);
  });

  it('keeps the turn alive when the config option refuses the value too', async () => {
    const fake = createFake({
      modeError: new JsonRpcErrorResponse('session/set_mode', -32601, 'Method not found'),
      configOptionError: new JsonRpcErrorResponse(
        'session/set_config_option',
        -32602,
        'Invalid params',
      ),
    });

    await expect(apply(fake, { modeId: 'plan' }, [MODE_OPTION])).resolves.toBeUndefined();
  });

  it('rethrows an error that is neither a missing method nor a refused value', async () => {
    const policyError = new JsonRpcErrorResponse('session/set_mode', -32001, 'Mode change rejected');
    const fake = createFake({ modeError: policyError });

    await expect(apply(fake, { modeId: 'always-approve' }, [MODE_OPTION]))
      .rejects.toBe(policyError);

    // No second mutation: an agent that rejected the mode outright has not
    // said its method is missing.
    expect(fake.configOptions).toEqual([]);
  });

  it('sends nothing for a turn that asks for nothing', async () => {
    const fake = createFake();

    await apply(fake, {});

    expect(fake.order).toEqual([]);
  });

  it('sends nothing when the turn carried no dynamic reference at all', async () => {
    const fake = createFake();
    const applier = new GrokAcpDynamicConfigApplier({
      resolve: async () => {
        throw new Error('A turn with no dynamic reference must not be resolved.');
      },
    });

    await applier.apply({
      client: fake.client,
      sessionId: 'grok-session',
      signal: new AbortController().signal,
    });

    expect(fake.order).toEqual([]);
  });

  it('stops at the abort the turn was cancelled with', async () => {
    const fake = createFake();
    const abort = new AbortController();
    const applier = new GrokAcpDynamicConfigApplier({
      resolve: async () => {
        abort.abort(new Error('turn cancelled'));
        return { modeId: 'always-approve', modelId: 'grok-4.6' };
      },
    });

    await expect(applier.apply({
      client: fake.client,
      sessionId: 'grok-session',
      dynamicRef: 'dynamic-1',
      signal: abort.signal,
    })).rejects.toThrow('turn cancelled');

    expect(fake.order).toEqual([]);
  });
});
