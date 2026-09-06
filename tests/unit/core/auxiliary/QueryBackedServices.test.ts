import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { QueryBackedInstructionRefineService } from '@/core/auxiliary/QueryBackedInstructionRefineService';
import { QueryBackedTitleGenerationService } from '@/core/auxiliary/QueryBackedTitleGenerationService';

/**
 * The shared auxiliary services, asserted once.
 *
 * These properties were tested five times over, once per provider, through five
 * different constructors that all reached the same two classes — so a change to
 * the parsing was reported five times and a change to a provider was reported
 * nowhere. The provider-specific half is `auxiliarySource.test.ts`; this is the
 * half that is the same for every provider because it is the same code.
 */

function stubRunner(): AuxQueryRunner & {
  readonly asked: Array<{ config: AuxQueryConfig; prompt: string }>;
  readonly resets: () => number;
  answer(text: string): void;
  fail(error: Error): void;
} {
  const asked: Array<{ config: AuxQueryConfig; prompt: string }> = [];
  let resets = 0;
  let next: { text: string } | { error: Error } = { text: '' };
  return {
    asked,
    resets: () => resets,
    answer: text => { next = { text }; },
    fail: error => { next = { error }; },
    async query(config, prompt) {
      asked.push({ config, prompt });
      if ('error' in next) {
        throw next.error;
      }
      return next.text;
    },
    reset() { resets += 1; },
  };
}

describe('QueryBackedInstructionRefineService', () => {
  it('reads a refined instruction out of the tags it is wrapped in', async () => {
    const runner = stubRunner();
    runner.answer('<instruction>Use TypeScript</instruction>');

    const result = await new QueryBackedInstructionRefineService(runner)
      .refineInstruction('use ts', '');

    expect(result).toEqual({ success: true, refinedInstruction: 'Use TypeScript' });
  });

  it('treats an untagged answer as a question back, not a failure', async () => {
    const runner = stubRunner();
    runner.answer('Could you be more specific?');

    const result = await new QueryBackedInstructionRefineService(runner)
      .refineInstruction('do stuff', '');

    expect(result).toEqual({ success: true, clarification: 'Could you be more specific?' });
  });

  it('refuses a follow-up when there is no conversation to continue', async () => {
    const result = await new QueryBackedInstructionRefineService(stubRunner())
      .continueConversation('follow up');

    expect(result).toEqual({ success: false, error: 'No active conversation to continue' });
  });

  it('sends a follow-up into the conversation the first message made', async () => {
    const runner = stubRunner();
    const service = new QueryBackedInstructionRefineService(runner);

    runner.answer('What language?');
    await service.refineInstruction('use typed language', '');
    runner.answer('<instruction>Use TypeScript for all code</instruction>');
    const result = await service.continueConversation('TypeScript');

    // One runner is one retained conversation. Two would send the follow-up
    // somewhere the first message never went.
    expect(result).toEqual({ success: true, refinedInstruction: 'Use TypeScript for all code' });
    expect(runner.asked).toHaveLength(2);
  });

  it('ends the conversation when the caller resets it', async () => {
    const runner = stubRunner();
    const service = new QueryBackedInstructionRefineService(runner);

    runner.answer('What language?');
    await service.refineInstruction('use typed language', '');
    service.resetConversation();

    expect(runner.resets()).toBeGreaterThanOrEqual(1);
  });

  it('reports the failure rather than throwing at a modal', async () => {
    const runner = stubRunner();
    runner.fail(new Error('Connection failed'));

    const result = await new QueryBackedInstructionRefineService(runner)
      .refineInstruction('test', '');

    expect(result).toEqual({ success: false, error: 'Connection failed' });
  });

  it('passes the caller model override down to the runner', async () => {
    const runner = stubRunner();
    runner.answer('<instruction>Use TypeScript</instruction>');
    const service = new QueryBackedInstructionRefineService(runner);

    service.setModelOverride('gpt-5.4');
    await service.refineInstruction('use ts', '');

    expect(runner.asked[0]?.config.model).toBe('gpt-5.4');
    expect(runner.asked[0]?.prompt).toBe('Please refine this instruction: "use ts"');
  });
});

describe('QueryBackedTitleGenerationService', () => {
  it('builds a runner per title and ends it when the title is done', async () => {
    const runners: Array<ReturnType<typeof stubRunner>> = [];
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => {
        const runner = stubRunner();
        runner.answer('A title');
        runners.push(runner);
        return runner;
      },
    });

    await service.generateTitle('conv-1', 'the first message', async () => undefined);
    await service.generateTitle('conv-2', 'another message', async () => undefined);

    // Two titles generated at once are two conversations, and one ending must
    // not close the process the other is still using.
    expect(runners).toHaveLength(2);
    expect(runners.map(runner => runner.resets())).toEqual([1, 1]);
  });

  it('reports an answer it cannot read as a title as a failure', async () => {
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => {
        const runner = stubRunner();
        runner.answer('   ');
        return runner;
      },
    });
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: false,
      error: 'Failed to parse title from response',
    });
  });
});
