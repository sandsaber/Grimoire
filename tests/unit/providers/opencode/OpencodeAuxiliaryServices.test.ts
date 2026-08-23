import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { OpencodeInlineEditService } from '@/providers/opencode/auxiliary/OpencodeInlineEditService';
import { OpencodeInstructionRefineService } from '@/providers/opencode/auxiliary/OpencodeInstructionRefineService';
import { OpencodeTitleGenerationService } from '@/providers/opencode/auxiliary/OpencodeTitleGenerationService';

/**
 * The switch itself: three services, now asking the kernel.
 *
 * What is asserted here is what a reader of the three one-line constructors
 * cannot see — **which auxiliary conversation each service is**. The purpose
 * decides the agent a turn runs as and the artifacts it runs under; the number
 * of runners decides whether a second message reaches the first one's session.
 * Both were carried over from `OpencodeAuxQueryRunner`, and both are invisible
 * until something counts them.
 */
describe('OpenCode auxiliary services', () => {
  function createPlugin(): {
    calls: string[];
    plugin: any;
    queries: Array<{ config: AuxQueryConfig; prompt: string }>;
    resets: number[];
  } {
    const calls: string[] = [];
    const queries: Array<{ config: AuxQueryConfig; prompt: string }> = [];
    const resets: number[] = [];
    const createAuxRunner = (purpose: string): AuxQueryRunner => {
      const index = calls.length;
      calls.push(purpose);
      return {
        query: async (config, prompt) => {
          queries.push({ config, prompt });
          return 'A Title';
        },
        reset: () => { resets.push(index); },
      };
    };
    return {
      calls,
      queries,
      resets,
      plugin: {
        settings: { titleGenerationModel: '' },
        getOpencodeExecution: () => ({ createAuxRunner }),
      },
    };
  }

  it('asks for nothing until something is asked of it', () => {
    const harness = createPlugin();

    new OpencodeInlineEditService(harness.plugin);
    new OpencodeInstructionRefineService(harness.plugin);
    new OpencodeTitleGenerationService(harness.plugin);

    // A service is built when a tab initializes or a modal opens; the
    // composition it reaches for is built at plugin load. The runners these
    // replaced touched the plugin only when a query ran, and that timing is
    // what keeps the ordering out of the services' hands.
    expect(harness.calls).toEqual([]);
  });

  it('keeps one conversation for an inline edit and its follow-up', async () => {
    const harness = createPlugin();
    const service = new OpencodeInlineEditService(harness.plugin);

    await service.editText({ selectedText: 'the note', instruction: 'shorten it' } as never);
    await service.continueConversation('shorter still');

    // The property the whole retained session exists for: the second message
    // has to reach the session the first one made. Two runners would be two
    // processes, and the follow-up would arrive somewhere the edit was not.
    expect(harness.calls).toEqual(['inline']);
    expect(harness.queries).toHaveLength(2);
  });

  it('starts a new conversation for a new edit', async () => {
    const harness = createPlugin();
    const service = new OpencodeInlineEditService(harness.plugin);

    await service.editText({ selectedText: 'the note', instruction: 'shorten it' } as never);
    await service.editText({ selectedText: 'another note', instruction: 'expand it' } as never);

    // `editText` resets first, which ends the conversation and closes the
    // process behind it. Still one runner: the lazy one keeps what it built.
    expect(harness.calls).toEqual(['inline']);
    expect(harness.resets.length).toBeGreaterThanOrEqual(1);
  });

  it('refines instructions in a conversation of its own', async () => {
    const harness = createPlugin();
    const service = new OpencodeInstructionRefineService(harness.plugin);

    await service.refineInstruction('do the thing', 'existing instructions');

    // Its own purpose, which is its own artifacts directory and its own agent:
    // a refinement must not run under the instructions an inline edit was
    // launched with.
    expect(harness.calls).toEqual(['instructions']);
  });

  it('generates each title on a conversation of its own, and ends it', async () => {
    const harness = createPlugin();
    const service = new OpencodeTitleGenerationService(harness.plugin);

    await service.generateTitle('conv-1', 'the first message', async () => undefined);
    await service.generateTitle('conv-2', 'another message', async () => undefined);

    // A runner per title, which is what this service has always built: two
    // titles generated at once are two conversations, and one's reset must not
    // close the process the other is using. Each is ended when its title is.
    expect(harness.calls).toEqual(['title-gen', 'title-gen']);
    expect(harness.resets).toEqual([0, 1]);
  });
});
