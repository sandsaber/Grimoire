import type {
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from '@/providers/acp/types';

export interface QwenStructuredQuestionOption {
  readonly description?: string;
  readonly label: string;
  readonly preview?: string;
}

export interface QwenStructuredQuestion {
  readonly header?: string;
  readonly id?: string;
  readonly multiSelect: boolean;
  readonly options: readonly QwenStructuredQuestionOption[];
  readonly question: string;
}

export interface QwenStructuredQuestionRequest {
  readonly questions: readonly QwenStructuredQuestion[];
  readonly submitOptionId: string;
}

export type QwenStructuredQuestionPermissionResponse = AcpRequestPermissionResponse & {
  readonly answers: Readonly<Record<string, string>>;
};

/** Detects Qwen's question-shaped ACP permission request without affecting normal approvals. */
export function parseQwenStructuredQuestionRequest(
  request: AcpRequestPermissionRequest,
): QwenStructuredQuestionRequest | null {
  const rawInput = asRecord(request.toolCall.rawInput);
  const metadata = asRecord(request.toolCall._meta);
  const matchesQuestion = metadata?.qwenInteractionKind === 'user_question'
    || metadata?.toolName === 'ask_user_question'
    || (Array.isArray(rawInput?.questions)
      && /^Ask user \d+ questions?$/i.test(request.toolCall.title ?? ''));
  if (!matchesQuestion) return null;

  const submit = request.options.find(option => option.kind === 'allow_once');
  if (!submit) return null;
  const source = Array.isArray(rawInput?.questions)
    ? rawInput.questions
    : Array.isArray(metadata?.qwenQuestions)
      ? metadata.qwenQuestions
      : [];
  const normalized = source.map(normalizeQuestion);
  if (normalized.length === 0 || !normalized.every(
    (question): question is QwenStructuredQuestion => question !== null,
  )) return null;
  const questions = normalized;
  return { questions, submitOptionId: submit.optionId };
}

export function buildQwenStructuredQuestionResponse(
  parsed: QwenStructuredQuestionRequest,
  answers: Readonly<Record<string, string | readonly string[]>>,
): QwenStructuredQuestionPermissionResponse {
  const normalizedAnswers: Record<string, string> = {};
  parsed.questions.forEach((question, index) => {
    const answer = (question.id ? answers[question.id] : undefined) ?? answers[question.question];
    if (answer === undefined) return;
    normalizedAnswers[String(index)] = typeof answer === 'string'
      ? answer
      : [...answer].join(', ');
  });
  return {
    answers: normalizedAnswers,
    outcome: { optionId: parsed.submitOptionId, outcome: 'selected' },
  };
}

function normalizeQuestion(value: unknown): QwenStructuredQuestion | null {
  const question = asRecord(value);
  if (!question || typeof question.question !== 'string' || !question.question.trim()) return null;
  return {
    ...(typeof question.header === 'string' ? { header: question.header } : {}),
    ...(typeof question.id === 'string' ? { id: question.id } : {}),
    multiSelect: question.multiSelect === true,
    options: Array.isArray(question.options)
      ? question.options.map(normalizeOption).filter(
        (option): option is QwenStructuredQuestionOption => option !== null,
      )
      : [],
    question: question.question,
  };
}

function normalizeOption(value: unknown): QwenStructuredQuestionOption | null {
  if (typeof value === 'string') return { label: value };
  const option = asRecord(value);
  if (!option || typeof option.label !== 'string' || !option.label.trim()) return null;
  return {
    ...(typeof option.description === 'string' ? { description: option.description } : {}),
    label: option.label,
    ...(typeof option.preview === 'string' ? { preview: option.preview } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
