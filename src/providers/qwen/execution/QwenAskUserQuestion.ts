import type {
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from '@/providers/acp/types';

/**
 * The question Qwen asks over the permission channel, and the answer it wants
 * back.
 *
 * Extracted from the legacy runtime, which now delegates to it, so the flip does
 * not produce a second opinion about what a question is or how an answer is
 * shaped. This is the only provider that sends one, and it is the reason
 * `InteractionResolution` gained a payload: choosing an option is not the whole
 * answer here.
 */

export interface QwenAskUserQuestion {
  header?: string;
  id?: string;
  multiSelect: boolean;
  options: Array<{ description?: string; label: string; preview?: string }>;
  question: string;
}

/** ACP's own reply, with the answers this provider expects beside the outcome. */
export type QwenAskUserQuestionResponse = AcpRequestPermissionResponse & {
  answers?: Record<string, string>;
};

/**
 * The questions in a permission request, where it is really a question.
 *
 * Three markings, because three releases mark it three ways: a
 * `_meta.qwenInteractionKind`, a `_meta.toolName`, or a title that reads "Ask
 * user N questions" over a `questions` array. All three are what
 * `QwenChatRuntime` already looks for.
 *
 * Answers `null` for anything that is an ordinary permission — the caller uses
 * that to decide, so a wrong `null` shows a question as an approval and a wrong
 * list asks nobody about a real tool call.
 */
export function getQwenAskUserQuestions(
  request: AcpRequestPermissionRequest,
): QwenAskUserQuestion[] | null {
  const rawInput = asRecord(request.toolCall.rawInput);
  const meta = asRecord((request.toolCall as { _meta?: unknown })._meta);
  const isQuestion = meta?.qwenInteractionKind === 'user_question'
    || meta?.toolName === 'ask_user_question'
    || (Array.isArray(rawInput?.questions)
      && /^Ask user \d+ questions?$/i.test(request.toolCall.title ?? ''));
  if (!isQuestion) {
    return null;
  }

  const source = Array.isArray(rawInput?.questions)
    ? rawInput.questions
    : Array.isArray(meta?.qwenQuestions)
      ? meta.qwenQuestions
      : [];
  return source
    .map(normalizeQwenAskUserQuestion)
    .filter((question): question is QwenAskUserQuestion => question !== null);
}

/**
 * What the surface answered, keyed the way the agent expects to read it.
 *
 * By position, not by name: the surface answers under whichever key it was given
 * — the question's own id, or the question text when it has none — and the agent
 * wants the index. Anything unanswered is left out rather than sent empty.
 */
export function mapQwenQuestionAnswers(
  answers: Record<string, string | string[]>,
  questions: readonly QwenAskUserQuestion[],
): Record<string, string> {
  return Object.fromEntries(questions.flatMap((question, index) => {
    const answer = (question.id ? answers[question.id] : undefined) ?? answers[question.question];
    return answer === undefined
      ? []
      : [[String(index), Array.isArray(answer) ? answer.join(', ') : answer]];
  }));
}

function normalizeQwenAskUserQuestion(value: unknown): QwenAskUserQuestion | null {
  const question = asRecord(value);
  if (!question || typeof question.question !== 'string') {
    return null;
  }
  const options = Array.isArray(question.options) ? question.options : [];
  return {
    ...(typeof question.header === 'string' ? { header: question.header } : {}),
    ...(typeof question.id === 'string' ? { id: question.id } : {}),
    multiSelect: question.multiSelect === true,
    options: options.flatMap(option => {
      const record = asRecord(option);
      return record && typeof record.label === 'string'
        ? [{
          ...(typeof record.description === 'string' ? { description: record.description } : {}),
          label: record.label,
          ...(typeof record.preview === 'string' ? { preview: record.preview } : {}),
        }]
        : [];
    }),
    question: question.question,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
