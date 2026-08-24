import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { CodexInstructionRefineService } from '@/providers/codex/auxiliary/CodexInstructionRefineService';

/**
 * Instruction refinement, over the runner the composition now hands out.
 *
 * The assertions are the service's own — how a refusal, a clarification and a
 * follow-up are read out of an answer — and they did not change when the runner
 * behind them did. What changed is where the runner comes from: a class this
 * file used to mock, and now a port on the composition.
 */
describe('CodexInstructionRefineService', () => {
  let service: CodexInstructionRefineService;
  let mockQuery: jest.Mock;
  let mockReset: jest.Mock;
  let purposes: string[];

  function createMockPlugin(): any {
    return {
      settings: {},
      getCodexExecution: () => ({
        createAuxRunner: (purpose: string): AuxQueryRunner => {
          purposes.push(purpose);
          return { query: mockQuery, reset: mockReset };
        },
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = jest.fn();
    mockReset = jest.fn();
    purposes = [];
    service = new CodexInstructionRefineService(createMockPlugin());
  });

  it('should parse refined instruction from response', async () => {
    mockQuery.mockResolvedValue('<instruction>Use TypeScript</instruction>');
    const result = await service.refineInstruction('use ts', '');
    expect(result.success).toBe(true);
    expect(result.refinedInstruction).toBe('Use TypeScript');
  });

  it('should return clarification when no instruction tags', async () => {
    mockQuery.mockResolvedValue('Could you be more specific?');
    const result = await service.refineInstruction('do stuff', '');
    expect(result.success).toBe(true);
    expect(result.clarification).toBe('Could you be more specific?');
  });

  it('should return error for continueConversation without active thread', async () => {
    const result = await service.continueConversation('follow up');
    expect(result.success).toBe(false);
    expect(result.error).toBe('No active conversation to continue');
  });

  it('should allow continueConversation after refineInstruction', async () => {
    mockQuery.mockResolvedValue('What language?');
    await service.refineInstruction('use typed language', '');

    mockQuery.mockResolvedValue('<instruction>Use TypeScript for all code</instruction>');
    const result = await service.continueConversation('TypeScript');
    expect(result.success).toBe(true);
    expect(result.refinedInstruction).toBe('Use TypeScript for all code');
    // One runner, which is one retained thread: the follow-up has to reach the
    // conversation the first message made.
    expect(purposes).toEqual(['instructions']);
  });

  it('should reset runner on resetConversation', async () => {
    mockQuery.mockResolvedValue('What language?');
    await service.refineInstruction('use typed language', '');

    service.resetConversation();

    expect(mockReset).toHaveBeenCalled();
  });

  it('should return error on query failure', async () => {
    mockQuery.mockRejectedValue(new Error('Connection failed'));
    const result = await service.refineInstruction('test', '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection failed');
  });

  it('passes a model override through to the aux runner', async () => {
    mockQuery.mockResolvedValue('<instruction>Use TypeScript</instruction>');

    service.setModelOverride('gpt-5.4');
    await service.refineInstruction('use ts', '');

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
    }), 'Please refine this instruction: "use ts"');
  });
});
