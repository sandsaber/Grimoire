import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import {
  getQwenAskUserQuestions,
  mapQwenQuestionAnswers,
  type QwenAskUserQuestion,
} from '@/providers/qwen/execution/QwenAskUserQuestion';
import { prepareQwenQuestion } from '@/providers/qwen/execution/QwenInteractionBridge';

/**
 * The one interaction on this transport that is not a permission.
 *
 * Qwen sends `ask_user_question` down the ACP permission channel and expects
 * structured answers beside the option id. Everything here was reached through
 * `QwenChatRuntime` before the extraction; the helpers are the same ones, and
 * the prepared interaction is what carries them into the kernel.
 */
describe('Qwen ask-user-question', () => {
  function request(overrides: Record<string, unknown> = {}): AcpRequestPermissionRequest {
    return {
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Answer' },
        { optionId: 'no', kind: 'reject_once', name: 'Cancel' },
      ],
      toolCall: {
        toolCallId: 'question-1',
        title: 'Ask user 2 questions',
        rawInput: {
          questions: [
            { question: 'Which one?', options: [{ label: 'first' }, { label: 'second' }] },
            { id: 'why', question: 'Why?', multiSelect: true, options: [] },
          ],
        },
        ...overrides,
      },
    };
  }

  describe('telling a question from a permission', () => {
    it('reads all three markings a release might use', () => {
      // Three, because three releases mark it three ways, and a marking this
      // does not know shows a question as an approval.
      expect(getQwenAskUserQuestions(request())).toHaveLength(2);
      // `rawInput` empty, so the `_meta` list is the one being read: where both
      // are present the input wins, which is what the two marked-by-meta cases
      // would otherwise be silently exercising.
      expect(getQwenAskUserQuestions(request({
        title: 'Something else',
        rawInput: {},
        _meta: { qwenInteractionKind: 'user_question', qwenQuestions: [{ question: 'Which?' }] },
      }))).toHaveLength(1);
      expect(getQwenAskUserQuestions(request({
        title: 'Something else',
        rawInput: {},
        _meta: { toolName: 'ask_user_question', qwenQuestions: [{ question: 'Which?' }] },
      }))).toHaveLength(1);
    });

    it('answers null for an ordinary tool call', () => {
      // The other half of the same rule: a wrong list asks nobody about a real
      // tool call, which is a permission prompt that never appeared.
      expect(getQwenAskUserQuestions(request({
        title: 'WriteFile',
        rawInput: { path: 'notes/today.md' },
      }))).toBeNull();
    });

    it('drops an entry that is not a question', () => {
      expect(getQwenAskUserQuestions(request({
        rawInput: { questions: [{ question: 'Real?' }, { header: 'no question here' }] },
      }))).toEqual([expect.objectContaining({ question: 'Real?' })]);
    });
  });

  describe('the answers the agent reads back', () => {
    const questions: QwenAskUserQuestion[] = [
      { question: 'Which one?', multiSelect: false, options: [] },
      { id: 'why', question: 'Why?', multiSelect: true, options: [] },
    ];

    it('keys them by position, whichever key the surface answered under', () => {
      expect(mapQwenQuestionAnswers({ 'Which one?': 'second', why: ['a', 'b'] }, questions))
        .toEqual({ 0: 'second', 1: 'a, b' });
    });

    it('leaves an unanswered question out rather than sending it empty', () => {
      expect(mapQwenQuestionAnswers({ 'Which one?': 'second' }, questions))
        .toEqual({ 0: 'second' });
    });
  });

  describe('the interaction it becomes', () => {
    function prepare(overrides: Record<string, unknown> = {}) {
      const asked = getQwenAskUserQuestions(request(overrides)) ?? [];
      return prepareQwenQuestion(
        request(overrides),
        asked,
        'presentation-1',
        () => undefined,
        () => undefined,
      );
    }

    it('opens as a question rather than as an approval', () => {
      // The kernel has modelled `kind: 'question'` since M1 and nothing had ever
      // opened one; showing this as an approval would ask a person to allow or
      // deny a question.
      expect(prepare().kind).toBe('question');
    });

    it('answers the agent with the choice and the answers together', async () => {
      await expect(prepare().resolve('answered', { answers: { 'Which one?': 'second' } }))
        .resolves.toEqual({
          answers: { 0: 'second' },
          outcome: { optionId: 'once', outcome: 'selected' },
        });
    });

    it('reads a payload it cannot understand as nobody having answered', async () => {
      // The payload crossed a boundary core does not read, so nothing upstream
      // guarantees its shape. An answer of `{}` is one the agent would act on;
      // "cancelled" is what actually happened.
      for (const payload of [undefined, null, 'answers', { answers: 'second' }, {}]) {
        await expect(prepare().resolve('answered', payload))
          .resolves.toEqual({ outcome: { outcome: 'cancelled' } });
      }
    });

    it('cancels when the agent offered nothing to answer with', async () => {
      const asked = getQwenAskUserQuestions(request()) ?? [];
      const prepared = prepareQwenQuestion(
        {
          ...request(),
          options: [{ optionId: 'no', kind: 'reject_once', name: 'Cancel' }],
        },
        asked,
        'presentation-2',
        () => undefined,
        () => undefined,
      );

      await expect(prepared.resolve('answered', { answers: { 'Which one?': 'second' } }))
        .resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    });

    it('cancels on any response id but the one it offered', async () => {
      await expect(prepare().resolve('cancel')).resolves
        .toEqual({ outcome: { outcome: 'cancelled' } });
      await expect(prepare().cancel()).resolves
        .toEqual({ outcome: { outcome: 'cancelled' } });
    });
  });
});
