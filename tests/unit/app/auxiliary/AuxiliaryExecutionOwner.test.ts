import '@/providers';

import { AuxiliaryExecutionOwner } from '@/app/auxiliary/AuxiliaryExecutionOwner';
import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import type {
  AuxiliaryPurpose,
  ProviderAuxiliarySource,
} from '@/core/auxiliary/ProviderAuxiliarySource';
import type { ProviderId } from '@/core/types/provider';

/**
 * The auxiliary owner, which is where twenty-seven provider factories went.
 *
 * What is tested here is the part that was never a provider's: which provider a
 * title is routed to, what a superseded title is allowed to do, whether a
 * runner is built before it is asked anything, and what a provider that
 * contributes nothing answers.
 */

interface RecordingRunner extends AuxQueryRunner {
  readonly asked: Array<{ config: AuxQueryConfig; prompt: string }>;
  readonly resets: number;
}

function recordingRunner(answer: string): RecordingRunner {
  const asked: Array<{ config: AuxQueryConfig; prompt: string }> = [];
  let resets = 0;
  return {
    asked,
    get resets() { return resets; },
    async query(config, prompt) {
      asked.push({ config, prompt });
      return answer;
    },
    reset() { resets += 1; },
  };
}

function sourceFor(
  runner: AuxQueryRunner,
  options: {
    onCreate?: (purpose: AuxiliaryPurpose) => void;
    titleModel?: string;
  } = {},
): ProviderAuxiliarySource {
  return {
    createRunner: purpose => {
      options.onCreate?.(purpose);
      return runner;
    },
    ...(options.titleModel !== undefined
      ? { resolveTitleModel: () => options.titleModel }
      : {}),
  };
}

function owner(
  sources: Array<[ProviderId, ProviderAuxiliarySource]>,
  resolveTitleProviderId: () => ProviderId,
): AuxiliaryExecutionOwner {
  return new AuxiliaryExecutionOwner({
    resolveTitleProviderId,
    sources: new Map(sources),
  });
}

describe('AuxiliaryExecutionOwner', () => {
  describe('title routing', () => {
    it('asks the provider the setting names, at the moment the title is asked for', async () => {
      const codex = recordingRunner('Fix the parser');
      const claude = recordingRunner('Something else');
      let titleProvider: ProviderId = 'claude';
      const service = owner(
        [['claude', sourceFor(claude)], ['codex', sourceFor(codex)]],
        () => titleProvider,
      ).titleGenerationService();

      titleProvider = 'codex';
      const callback = jest.fn();
      await service.generateTitle('conv-1', 'hello', callback);

      // The tab holds one title service for its whole life, and the setting
      // that decides the provider can change while it does.
      expect(codex.asked).toHaveLength(1);
      expect(claude.asked).toHaveLength(0);
      expect(callback).toHaveBeenCalledWith('conv-1', {
        success: true,
        title: 'Fix the parser',
      });
    });

    it('hands the provider the title model only when the provider owns it', async () => {
      const withModel = recordingRunner('A title');
      const service = owner(
        [['codex', sourceFor(withModel, { titleModel: 'gpt-5-codex' })]],
        () => 'codex',
      ).titleGenerationService();

      await service.generateTitle('conv-1', 'hello', jest.fn());

      expect(withModel.asked[0]?.config.model).toBe('gpt-5-codex');
    });

    it('drops the answer a superseded title generation returns', async () => {
      const slow = deferredRunner();
      const fast = recordingRunner('The newer title');
      let titleProvider: ProviderId = 'claude';
      const service = owner(
        [['claude', sourceFor(slow)], ['codex', sourceFor(fast)]],
        () => titleProvider,
      ).titleGenerationService();

      const callback = jest.fn();
      const first = service.generateTitle('conv-1', 'first', callback);
      titleProvider = 'codex';
      await service.generateTitle('conv-1', 'second', callback);
      await slow.answer('The stale title');
      await first;

      // The stale one may not overwrite the title the newer one just wrote.
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('conv-1', {
        success: true,
        title: 'The newer title',
      });
    });
  });

  describe('a provider that contributes no auxiliary source', () => {
    it('says so in every one of the three services, in the provider name', async () => {
      const none = owner([], () => 'qwen');
      const titleCallback = jest.fn();

      await none.titleServiceFor('qwen').generateTitle('conv-1', 'hello', titleCallback);
      const refined = await none.instructionRefineService('qwen')
        .refineInstruction('do a thing', '');
      const edited = await none.inlineEditService('qwen')
        .editText({
          mode: 'cursor',
          instruction: 'write',
          notePath: 'Note.md',
          cursorContext: {
            afterCursor: '',
            beforeCursor: '',
            column: 0,
            isInbetween: false,
            line: 0,
          },
        });

      // The provider's name as the user sees it in the picker, not the
      // directory it lives in: three providers hardcoded their own and two of
      // them named something the UI never calls them.
      const expected = 'Qwen Code auxiliary tasks are not implemented yet.';
      expect(titleCallback).toHaveBeenCalledWith('conv-1', { success: false, error: expected });
      expect(refined).toEqual({ success: false, error: expected });
      expect(edited).toEqual({ success: false, error: expected });
    });

    it('is what a caller gets before the application has composed one', async () => {
      const result = await AuxiliaryExecutionOwner.unavailable('codex')
        .instructionRefineService('codex')
        .refineInstruction('do a thing', '');

      expect(result).toEqual({
        success: false,
        error: 'Codex auxiliary tasks are not implemented yet.',
      });
    });
  });

  describe('runner lifetime', () => {
    it('builds no runner until something is asked', () => {
      const created: AuxiliaryPurpose[] = [];
      const runner = recordingRunner('x');
      const composed = owner(
        [['codex', sourceFor(runner, { onCreate: purpose => created.push(purpose) })]],
        () => 'codex',
      );

      composed.instructionRefineService('codex');
      composed.inlineEditService('codex');

      // A refine service is built when a tab initializes and an inline-edit
      // service when a modal opens; the composition behind them may not have
      // finished starting.
      expect(created).toEqual([]);
    });

    it('keeps one conversation per service, so a follow-up has something to continue', async () => {
      const runner = recordingRunner('<instruction>Do the thing</instruction>');
      const created: AuxiliaryPurpose[] = [];
      const refine = owner(
        [['codex', sourceFor(runner, { onCreate: purpose => created.push(purpose) })]],
        () => 'codex',
      ).instructionRefineService('codex');

      await refine.refineInstruction('do a thing', '');
      const continued = await refine.continueConversation('and also this');

      expect(created).toEqual(['instruction-refine']);
      expect(runner.asked).toHaveLength(2);
      expect(continued).toEqual({ success: true, refinedInstruction: 'Do the thing' });
    });
  });
});

function deferredRunner(): AuxQueryRunner & { answer: (text: string) => Promise<void> } {
  let release: ((text: string) => void) | null = null;
  const pending = new Promise<string>(resolve => { release = resolve; });
  return {
    async query() {
      return pending;
    },
    reset() {},
    answer: async text => {
      release?.(text);
      await pending;
    },
  };
}
