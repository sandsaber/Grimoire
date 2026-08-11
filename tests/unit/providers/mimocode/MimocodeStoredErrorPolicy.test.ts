import { MimocodeStoredErrorPolicy } from '@/providers/mimocode/execution/MimocodeStoredErrorPolicy';

describe('MimocodeStoredErrorPolicy', () => {
  it('applies the supported base model after the provider rejects an unsupported variant', async () => {
    const applied: string[] = [];
    const policy = new MimocodeStoredErrorPolicy(
      {
        apply: async ({ rawModelId, signal }) => {
          expect(signal.aborted).toBe(false);
          applied.push(rawModelId);
        },
      },
      {
        load: async input => {
          expect(input).toEqual({
            sessionId: 'native-session',
            databasePath: '/provider/mimocode.db',
            sinceEpochMs: 100,
            parentMessageId: 'message-1',
          });
          return { message: 'not supported model provider/model-ultraspeed' };
        },
      },
    );

    await expect(policy.resolve(input())).resolves.toEqual({
      kind: 'fallback-applied',
      fallbackRawModelId: 'provider/model',
    });
    expect(applied).toEqual(['provider/model']);
  });

  it('keeps ordinary provider errors as failures and performs no settings mutation', async () => {
    const apply = jest.fn(async () => undefined);
    const policy = new MimocodeStoredErrorPolicy(
      { apply },
      { load: async () => ({ message: 'Invalid API Key', statusCode: 401 }) },
    );

    await expect(policy.resolve(input())).resolves.toEqual({ kind: 'provider-failure' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('reports no provider error when the native database has no matching failure', async () => {
    const policy = new MimocodeStoredErrorPolicy(
      { apply: async () => undefined },
      { load: async () => null },
    );

    await expect(policy.resolve(input())).resolves.toEqual({ kind: 'no-provider-error' });
  });

  it('does not claim a fallback when settings persistence fails', async () => {
    const policy = new MimocodeStoredErrorPolicy(
      { apply: async () => { throw new Error('settings unavailable'); } },
      { load: async () => ({ message: 'not supported model provider/model-ultraspeed' }) },
    );

    await expect(policy.resolve(input())).resolves.toEqual({ kind: 'provider-failure' });
  });

  it('does not mutate settings when the lifecycle signal is already aborted', async () => {
    const apply = jest.fn(async () => undefined);
    const policy = new MimocodeStoredErrorPolicy(
      { apply },
      { load: async () => ({ message: 'not supported model provider/model-ultraspeed' }) },
    );
    const controller = new AbortController();
    controller.abort(new Error('run closed'));

    await expect(policy.resolve({ ...input(), signal: controller.signal }))
      .resolves.toEqual({ kind: 'provider-failure' });
    expect(apply).not.toHaveBeenCalled();
  });
});

function input() {
  return {
    requestRef: 'request-ref',
    nativeSessionRef: 'native-session',
    nativeRunRef: 'message-1',
    databasePath: '/provider/mimocode.db',
    availableRawModelIds: ['provider/model-ultraspeed', 'provider/model'],
    startedAt: 100,
    signal: new AbortController().signal,
  };
}
