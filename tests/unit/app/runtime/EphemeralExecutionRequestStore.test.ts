import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';

const REQUEST_REF = `req-${'1'.repeat(32)}`;

describe('EphemeralExecutionRequestStore', () => {
  it('keeps raw payloads memory-only behind kind-bound opaque refs', () => {
    const store = new EphemeralExecutionRequestStore();
    const payload = { prompt: 'sensitive prompt', environment: { TOKEN: 'secret' } };
    store.register(REQUEST_REF, 'codex-turn', payload);

    expect(store.resolve(REQUEST_REF, 'codex-turn')).toEqual(payload);
    expect(store.resolve(REQUEST_REF, 'codex-turn')).not.toBe(payload);
    expect(() => store.resolve(REQUEST_REF, 'claude-turn')).toThrow('unavailable');
    store.forget(REQUEST_REF);
    expect(() => store.resolve(REQUEST_REF, 'codex-turn')).toThrow('unavailable');
  });

  it('accepts identical identity replay and rejects conflicting reuse', () => {
    const store = new EphemeralExecutionRequestStore();
    const payload = { prompt: 'same object' };
    store.register(REQUEST_REF, 'provider-turn', payload);
    expect(() => store.register(REQUEST_REF, 'provider-turn', payload)).not.toThrow();
    expect(() => store.register(REQUEST_REF, 'provider-turn', { prompt: 'different value' }))
      .toThrow('already registered');
  });

  it('fails closed at its bounded capacity', () => {
    const store = new EphemeralExecutionRequestStore(1);
    store.register(REQUEST_REF, 'provider-turn', {});
    expect(() => store.register(`req-${'2'.repeat(32)}`, 'provider-turn', {}))
      .toThrow('capacity');
  });

  it('consumes a one-shot payload exactly once', () => {
    const store = new EphemeralExecutionRequestStore();
    const ref = `req-${'4'.repeat(32)}`;
    store.register(ref, 'provider-turn', { prompt: 'one shot' });

    expect(store.take(ref, 'provider-turn')).toEqual({ prompt: 'one shot' });
    expect(() => store.take(ref, 'provider-turn')).toThrow('unavailable');
  });

  it('bounds individual and aggregate sensitive payload bytes', () => {
    const store = new EphemeralExecutionRequestStore(4, 16, 24);
    store.register(REQUEST_REF, 'provider-turn', '123456789012');
    expect(store.retainedBytes).toBe(12);
    expect(() => store.register(`req-${'2'.repeat(32)}`, 'provider-turn', 'x'.repeat(17)))
      .toThrow('payload exceeds');
    expect(() => store.register(`req-${'3'.repeat(32)}`, 'provider-turn', '1234567890123'))
      .toThrow('byte capacity');
    store.forget(REQUEST_REF);
    expect(store.retainedBytes).toBe(0);
  });

  it('rejects opaque object graphs whose retained size cannot be inspected', () => {
    const store = new EphemeralExecutionRequestStore();
    expect(() => store.register(REQUEST_REF, 'provider-turn', new AbortController().signal))
      .toThrow('plain data');
  });

  it('retains an immutable measured snapshot when the caller later grows its payload', () => {
    const store = new EphemeralExecutionRequestStore(2, 64, 64);
    const payload = { prompt: 'small', nested: ['a'] };
    store.register(REQUEST_REF, 'provider-turn', payload);
    const retainedBytes = store.retainedBytes;

    payload.prompt = 'x'.repeat(1_000_000);
    payload.nested.push('y'.repeat(1_000_000));

    expect(store.resolve(REQUEST_REF, 'provider-turn')).toEqual({
      prompt: 'small',
      nested: ['a'],
    });
    expect(store.retainedBytes).toBe(retainedBytes);
  });

  it('rejects accessors instead of retaining values that can change after measurement', () => {
    const store = new EphemeralExecutionRequestStore();
    const payload = Object.defineProperty({}, 'prompt', {
      enumerable: true,
      get: () => 'dynamic',
    });
    expect(() => store.register(REQUEST_REF, 'provider-turn', payload)).toThrow('accessors');
  });

  it('rejects custom array prototypes without invoking caller-controlled collection methods', () => {
    const store = new EphemeralExecutionRequestStore(2, 64, 64);
    let mapCalled = false;
    const payload: unknown[] = [];
    Object.setPrototypeOf(payload, {
      map: () => {
        mapCalled = true;
        return { prompt: 'x'.repeat(1_000_000) };
      },
    });

    expect(() => store.register(REQUEST_REF, 'provider-turn', payload)).toThrow('built-in arrays');
    expect(mapCalled).toBe(false);
    expect(store.retainedBytes).toBe(0);
  });

  it('preserves an own __proto__ data key without mutating the snapshot prototype', () => {
    const store = new EphemeralExecutionRequestStore();
    const payload = Object.defineProperty({}, '__proto__', {
      enumerable: true,
      value: { provider: 'safe' },
    });

    store.register(REQUEST_REF, 'provider-turn', payload);
    const snapshot = store.resolve<Record<string, unknown>>(REQUEST_REF, 'provider-turn');

    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(Object.hasOwn(snapshot, '__proto__')).toBe(true);
    expect(snapshot.__proto__).toEqual({ provider: 'safe' });
  });
});
