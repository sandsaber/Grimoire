import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import {
  buildQwenStructuredQuestionResponse,
  parseQwenStructuredQuestionRequest,
} from '@/providers/qwen/execution/QwenStructuredQuestions';

describe('Qwen structured questions', () => {
  it('keeps Qwen question metadata distinct from generic approval requests', () => {
    const parsed = parseQwenStructuredQuestionRequest(questionRequest());
    expect(parsed).toEqual({
      submitOptionId: 'submit',
      questions: [{
        id: 'focus',
        header: 'Focus',
        multiSelect: true,
        options: [
          { label: 'Content', description: 'Improve facts' },
          { label: 'Diagram' },
        ],
        question: 'What should change?',
      }],
    });
    if (!parsed) throw new Error('Expected a structured question.');
    expect(buildQwenStructuredQuestionResponse(parsed, {
      focus: ['Content', 'Diagram'],
    })).toEqual({
      answers: { '0': 'Content, Diagram' },
      outcome: { optionId: 'submit', outcome: 'selected' },
    });

    expect(parseQwenStructuredQuestionRequest({
      ...questionRequest(),
      toolCall: { toolCallId: 'tool-2', title: 'Write file' },
    })).toBeNull();
  });

  it('requires a native submit option and at least one valid question', () => {
    expect(parseQwenStructuredQuestionRequest({
      ...questionRequest(),
      options: [{ optionId: 'cancel', kind: 'reject_once', name: 'Cancel' }],
    })).toBeNull();
    expect(parseQwenStructuredQuestionRequest({
      ...questionRequest(),
      toolCall: {
        ...questionRequest().toolCall,
        rawInput: { questions: [{ question: '', options: [] }] },
      },
    })).toBeNull();
    expect(parseQwenStructuredQuestionRequest({
      ...questionRequest(),
      toolCall: {
        ...questionRequest().toolCall,
        rawInput: {
          questions: [
            { question: '', options: [] },
            { id: 'valid', question: 'Keep my native index?', options: [] },
          ],
        },
      },
    })).toBeNull();
  });
});

function questionRequest(): AcpRequestPermissionRequest {
  return {
    sessionId: 'native-session',
    options: [
      { optionId: 'submit', kind: 'allow_once', name: 'Submit' },
      { optionId: 'cancel', kind: 'reject_once', name: 'Cancel' },
    ],
    toolCall: {
      toolCallId: 'tool-1',
      title: 'Ask user 1 question',
      _meta: { qwenInteractionKind: 'user_question', toolName: 'ask_user_question' },
      rawInput: {
        questions: [{
          id: 'focus',
          header: 'Focus',
          multiSelect: true,
          options: [
            { label: 'Content', description: 'Improve facts' },
            'Diagram',
          ],
          question: 'What should change?',
        }],
      },
    },
  };
}
