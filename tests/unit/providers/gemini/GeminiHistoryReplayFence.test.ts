import type { AcpSessionNotification } from '@/providers/acp/types';
import type { GeminiExecutionScheduler } from '@/providers/gemini/execution/GeminiExecutionBackend';
import { GeminiHistoryReplayFence } from '@/providers/gemini/execution/GeminiHistoryReplayFence';

describe('GeminiHistoryReplayFence', () => {
  it('consumes the exact native replay inventory across the load response boundary', async () => {
    const scheduler = new ControlledScheduler();
    const fence = createFence(2, scheduler);
    const abort = new AbortController();
    await fence.begin({ sessionId: 'saved-session', cwd: '/vault', signal: abort.signal });

    expect(fence.observe(history('saved-session', 'first'))).toBe(true);
    expect(fence.observe(commands('saved-session'))).toBe(true);
    const settled = fence.settle({ sessionId: 'saved-session', signal: abort.signal });
    let completed = false;
    void settled.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    expect(fence.observe(history('saved-session', 'second'))).toBe(true);
    await expect(settled).resolves.toBeUndefined();
    expect(fence.observe(history('saved-session', 'user turn'))).toBe(false);
  });

  it('fails closed when fewer replay notifications arrive than native history declares', async () => {
    const scheduler = new ControlledScheduler();
    const fence = createFence(2, scheduler);
    await fence.begin({
      sessionId: 'saved-session',
      cwd: '/vault',
      signal: new AbortController().signal,
    });
    fence.observe(history('saved-session', 'only one'));
    const settled = fence.settle({
      sessionId: 'saved-session',
      signal: new AbortController().signal,
    });
    scheduler.fireNext();

    await expect(settled).rejects.toThrow('did not match its native inventory');
  });

  it('fails closed when replay exceeds the native inventory', async () => {
    const scheduler = new ControlledScheduler();
    const fence = createFence(1, scheduler);
    const signal = new AbortController().signal;
    await fence.begin({ sessionId: 'saved-session', cwd: '/vault', signal });
    fence.observe(history('saved-session', 'expected'));
    fence.observe(history('saved-session', 'unexpected'));

    await expect(fence.settle({ sessionId: 'saved-session', signal }))
      .rejects.toThrow('exceeded its native inventory');
  });

  it('aborts a pending replay fence during process cleanup', async () => {
    const scheduler = new ControlledScheduler();
    const fence = createFence(1, scheduler);
    const abort = new AbortController();
    await fence.begin({ sessionId: 'saved-session', cwd: '/vault', signal: abort.signal });
    const settled = fence.settle({ sessionId: 'saved-session', signal: abort.signal });
    abort.abort(new Error('process closed'));

    await expect(settled).rejects.toThrow('process closed');
  });

  it('rejects an invalid provider-native replay inventory', async () => {
    const scheduler = new ControlledScheduler();
    const fence = createFence(-1, scheduler);

    await expect(fence.begin({
      sessionId: 'saved-session',
      cwd: '/vault',
      signal: new AbortController().signal,
    })).rejects.toThrow('inventory is invalid');
  });
});

function createFence(expected: number, scheduler: ControlledScheduler): GeminiHistoryReplayFence {
  return new GeminiHistoryReplayFence(
    { count: async () => expected },
    scheduler,
    100,
  );
}

class ControlledScheduler implements GeminiExecutionScheduler {
  private readonly tasks = new Map<object, () => void>();

  setTimeout(callback: () => void): object {
    const handle = {};
    this.tasks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'object' && handle !== null) this.tasks.delete(handle);
  }

  fireNext(): void {
    const iterator = this.tasks.entries().next();
    if (iterator.done) throw new Error('No scheduled timer.');
    this.tasks.delete(iterator.value[0]);
    iterator.value[1]();
  }
}

function history(sessionId: string, text: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  };
}

function commands(sessionId: string): AcpSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'available_commands_update',
      availableCommands: [],
    },
  };
}
