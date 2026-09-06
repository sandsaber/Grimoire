import { LazyAuxQueryRunner } from '@/core/auxiliary/LazyAuxQueryRunner';

describe('LazyAuxQueryRunner', () => {
  it('builds nothing until it is asked a question', async () => {
    let built = 0;
    const runner = new LazyAuxQueryRunner(() => {
      built += 1;
      return { query: async () => 'the answer', reset: () => undefined };
    });

    // The timing the provider runners had, and the reason this exists: a
    // service is constructed when a tab initializes, and what it needs to reach
    // is constructed at plugin load. Reaching in a constructor makes the
    // service depend on an ordering it cannot see.
    expect(built).toBe(0);
    await expect(runner.query({ systemPrompt: 'x' }, 'y')).resolves.toBe('the answer');
    expect(built).toBe(1);
  });

  it('keeps the one it built, and resets it', async () => {
    let built = 0;
    let resets = 0;
    const runner = new LazyAuxQueryRunner(() => {
      built += 1;
      return { query: async () => 'answer', reset: () => { resets += 1; } };
    });

    await runner.query({ systemPrompt: 'x' }, 'first');
    await runner.query({ systemPrompt: 'x' }, 'second');
    runner.reset();

    // One runner is one auxiliary conversation: a second would be a second
    // process, and the second message would arrive somewhere the first was not.
    expect(built).toBe(1);
    expect(resets).toBe(1);
  });

  it('resets nothing when nothing has run', () => {
    let built = 0;
    const runner = new LazyAuxQueryRunner(() => {
      built += 1;
      return { query: async () => '', reset: () => undefined };
    });

    // A service is reset on paths that may never have asked it anything —
    // closing a modal that was opened and not used. Building a process to end
    // one that was never started is the opposite of what reset means.
    runner.reset();

    expect(built).toBe(0);
  });
});
