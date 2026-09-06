import { QueryBackedTitleGenerationService } from '@/core/auxiliary/QueryBackedTitleGenerationService';

function createPendingRunner() {
  return {
    query: jest.fn((config: any) => new Promise<string>((_, reject) => {
      config.abortController.signal.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    })),
    reset: jest.fn(),
  };
}

function createService() {
  const runners: ReturnType<typeof createPendingRunner>[] = [];
  const service = new QueryBackedTitleGenerationService({
    createRunner: () => {
      const runner = createPendingRunner();
      runners.push(runner);
      return runner;
    },
  });

  return { runners, service };
}

describe('QueryBackedTitleGenerationService.cancel', () => {
  it('aborts only the conversation it is given', async () => {
    const { service } = createService();
    const first = jest.fn();
    const second = jest.fn();

    const firstRun = service.generateTitle('conv-1', 'how do I dry PETG?', first);
    const secondRun = service.generateTitle('conv-2', 'how do I dry PLA?', second);

    // One service is shared by every conversation a tab has opened, so a caller that
    // started one generation must be able to stop that one alone.
    service.cancel('conv-1');
    await firstRun;

    expect(first).toHaveBeenCalledWith('conv-1', expect.objectContaining({ success: false }));
    expect(second).not.toHaveBeenCalled();

    service.cancel();
    await secondRun;

    expect(second).toHaveBeenCalledWith('conv-2', expect.objectContaining({ success: false }));
  });

  it('ignores a conversation that has nothing running', async () => {
    const { service } = createService();
    const callback = jest.fn();

    const run = service.generateTitle('conv-1', 'how do I dry PETG?', callback);
    service.cancel('conv-2');

    expect(callback).not.toHaveBeenCalled();

    service.cancel('conv-1');
    await run;

    expect(callback).toHaveBeenCalledWith('conv-1', expect.objectContaining({ success: false }));
  });
});
