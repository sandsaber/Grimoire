/**
 * Dialog kind the Claude Code CLI uses to hand an AskUserQuestion call to the
 * host renderer instead of resolving it through `canUseTool`.
 */
export const CLAUDE_ASK_USER_QUESTION_DIALOG_KIND = 'permission_ask_user_question';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The CLI adds the free-text "Other" choice inside its own AskUserQuestion UI,
 * and neither the `canUseTool` input nor the dialog payload carries that flag.
 * Grimoire renders the question itself, so every entry point must inject it to
 * match the CLI's built-in behavior.
 */
export function prepareAskUserQuestionInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const questions = input.questions;
  if (!Array.isArray(questions)) {
    return input;
  }

  return {
    ...input,
    questions: (questions as unknown[]).map(question => (
      isRecord(question) && !('isOther' in question)
        ? { ...question, isOther: true }
        : question
    )),
  };
}
