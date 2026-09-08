import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { AskUserAnswers, AskUserQuestionItem } from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { AcpToolStreamAdapter } from '../../acp';

/*
 * The names Grok actually sends, taken from its own session histories rather
 * than guessed from the shapes its siblings use. Its four commonest tools —
 * `read_file`, `list_dir`, `search_replace`, `run_terminal_command` — were not
 * here at all, so they fell through to the raw name and drew as a wrench and a
 * snake_case word: six identical `read_file` rows where Claude says which note
 * it read. `write` and `grep` matched by accident, which is why the same
 * transcript had one properly named `Write` row among them.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  askuserquestion: TOOL_ASK_USER_QUESTION,
  bash: TOOL_BASH,
  edit: TOOL_EDIT,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  list_dir: TOOL_LS,
  question: TOOL_ASK_USER_QUESTION,
  read: TOOL_READ,
  read_file: TOOL_READ,
  run_terminal_command: TOOL_BASH,
  search_replace: TOOL_EDIT,
  shell: TOOL_BASH,
  skill: TOOL_SKILL,
  strreplace: TOOL_EDIT,
  task: TOOL_TASK,
  todowrite: TOOL_TODO_WRITE,
  webfetch: TOOL_WEB_FETCH,
  websearch: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
};

type GrokKnownToolName = keyof typeof TOOL_NAME_MAP;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKnownToolName(value: unknown): value is GrokKnownToolName {
  if (typeof value !== 'string') {
    return false;
  }

  return value.trim().toLowerCase() in TOOL_NAME_MAP;
}

function toKnownToolName(value: string | undefined): GrokKnownToolName | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isKnownToolName(normalized)
    ? normalized
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function firstTrimmedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string {
  return firstTrimmedString(...values) ?? '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueValues = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    uniqueValues.add(trimmed);
  }

  return [...uniqueValues];
}

function normalizeQuestionOptions(value: unknown): Array<{ description: string; label: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option) => {
    if (typeof option === 'string') {
      const label = option.trim();
      return label ? [{ description: '', label }] : [];
    }

    if (!isPlainObject(option)) {
      return [];
    }

    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!label) {
      return [];
    }

    return [{
      description: typeof option.description === 'string' ? option.description : '',
      label,
    }];
  });
}

function normalizeQuestionItems(value: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const record = isPlainObject(item) ? item : {};
    const question = firstTrimmedString(record.question) ?? `Question ${index + 1}`;
    const header = firstTrimmedString(record.header) ?? `Q${index + 1}`;

    return {
      ...(typeof record.id === 'string' && record.id.trim()
        ? { id: record.id }
        : {}),
      header,
      multiSelect: record.multiSelect === true || record.multi_select === true || record.multiple === true,
      options: normalizeQuestionOptions(record.options),
      question,
    };
  });
}

function normalizeTodoStatus(value: unknown): 'completed' | 'in_progress' | 'pending' {
  switch (value) {
    case 'completed':
    case 'cancelled':
      return 'completed';
    case 'in_progress':
      return 'in_progress';
    default:
      return 'pending';
  }
}

function normalizeTodos(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }

    const content = firstTrimmedString(item.content, item.title, item.description);
    if (!content) {
      return [];
    }

    return [{
      activeForm: firstTrimmedString(item.activeForm, item.active_form) ?? content,
      content,
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      status: normalizeTodoStatus(item.status),
    }];
  });
}

function normalizeQuestionAnswers(
  rawAnswers: unknown,
  questions: AskUserQuestionItem[],
): AskUserAnswers | undefined {
  if (!Array.isArray(rawAnswers) || questions.length === 0) {
    return undefined;
  }

  const answers: AskUserAnswers = {};

  for (let index = 0; index < Math.min(rawAnswers.length, questions.length); index += 1) {
    const question = questions[index];
    const rawEntry = (rawAnswers as unknown[])[index];
    if (!question) {
      continue;
    }

    const values = Array.isArray(rawEntry)
      ? rawEntry
          .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : typeof rawEntry === 'string' && rawEntry.trim().length > 0
      ? [rawEntry]
      : [];

    if (values.length === 0) {
      continue;
    }

    const normalizedValue = values.length === 1 ? values[0] : values;
    answers[question.question] = normalizedValue;
    if (question.id) {
      answers[question.id] = normalizedValue;
    }
  }

  return Object.keys(answers).length > 0 ? answers : undefined;
}

function extractToolMetadata(rawOutput: unknown): Record<string, unknown> | null {
  if (!isPlainObject(rawOutput)) {
    return null;
  }

  return isPlainObject(rawOutput.metadata) ? rawOutput.metadata : null;
}

export function resolveGrokRawToolName(
  currentRawName: string | undefined,
  update: {
    kind?: string | null;
    title?: string | null;
  },
): string {
  const titleName = firstTrimmedString(update.title);
  const knownTitleName = titleName && isKnownToolName(titleName)
    ? titleName.trim().toLowerCase()
    : undefined;

  if (knownTitleName) {
    return knownTitleName;
  }

  if (currentRawName) {
    return currentRawName;
  }

  switch (update.kind) {
    case 'execute':
      return 'bash';
    case 'fetch':
      return 'webfetch';
    case 'read':
      return 'read';
    default:
      return titleName ?? 'tool';
  }
}

function normalizeWebSearchInput(input: Record<string, unknown>): Record<string, unknown> {
  const action = isPlainObject(input.action)
    ? input.action
    : {};

  const queries = normalizeStringArray(action.queries ?? input.queries);
  const query = firstNonEmptyString(action.query, input.query, queries[0]);
  const url = firstNonEmptyString(action.url, input.url);
  const pattern = firstNonEmptyString(action.pattern, input.pattern);
  const explicitType = firstNonEmptyString(action.type, input.actionType, input.action_type);

  const actionType = explicitType
    || (url && pattern ? 'find_in_page' : url ? 'open_page' : (query || queries.length > 0) ? 'search' : '');

  const normalized: Record<string, unknown> = {};
  if (actionType) {
    normalized.actionType = actionType;
  }
  if (query) {
    normalized.query = query;
  }
  if (queries.length > 0) {
    normalized.queries = queries;
  }
  if (url) {
    normalized.url = url;
  }
  if (pattern) {
    normalized.pattern = pattern;
  }

  return normalized;
}

export function normalizeGrokToolName(rawName: string | undefined): string {
  const knownName = toKnownToolName(rawName);
  if (!knownName) {
    return rawName?.trim() || 'tool';
  }

  return TOOL_NAME_MAP[knownName];
}

export function normalizeGrokToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const knownName = toKnownToolName(rawName);
  switch (knownName) {
    case 'question':
      return { questions: normalizeQuestionItems(input.questions) };
    // `target_file` is Grok's own key for the path, and without it the row knew
    // the tool was a Read and still had nothing to name.
    case 'read':
    case 'read_file':
      return {
        ...(firstString(input.target_file, input.file_path, input.filePath, input.filepath, input.path)
          ? { file_path: firstString(input.target_file, input.file_path, input.filePath, input.filepath, input.path) }
          : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
      };
    case 'list_dir':
      return firstString(input.target_directory, input.path)
        ? { path: firstString(input.target_directory, input.path) }
        : {};
    case 'write':
      return {
        ...(typeof input.content === 'string' ? { content: input.content } : {}),
        ...(firstString(input.file_path, input.filePath, input.filepath, input.path)
          ? { file_path: firstString(input.file_path, input.filePath, input.filepath, input.path) }
          : {}),
      };
    case 'edit':
    case 'search_replace':
      return {
        ...(firstString(input.file_path, input.filePath, input.filepath, input.path)
          ? { file_path: firstString(input.file_path, input.filePath, input.filepath, input.path) }
          : {}),
        ...(firstString(input.old_string, input.oldString) ? { old_string: firstString(input.old_string, input.oldString) } : {}),
        ...(firstString(input.new_string, input.newString) ? { new_string: firstString(input.new_string, input.newString) } : {}),
        ...(typeof input.replace_all === 'boolean'
          ? { replace_all: input.replace_all }
          : typeof input.replaceAll === 'boolean'
          ? { replace_all: input.replaceAll }
          : {}),
      };
    case 'task':
      return {
        ...(firstTrimmedString(input.command) ? { command: firstTrimmedString(input.command) } : {}),
        ...(firstTrimmedString(input.description) ? { description: firstTrimmedString(input.description) } : {}),
        ...(firstTrimmedString(input.prompt) ? { prompt: firstTrimmedString(input.prompt) } : {}),
        ...(input.run_in_background === true || input.run_in_background === false
          ? { run_in_background: input.run_in_background }
          : {}),
        ...(firstTrimmedString(input.subagent_type) ? { subagent_type: firstTrimmedString(input.subagent_type) } : {}),
        ...(firstTrimmedString(input.task_id) ? { task_id: firstTrimmedString(input.task_id) } : {}),
      };
    case 'todowrite':
      return { todos: normalizeTodos(input.todos) };
    case 'skill':
      return firstTrimmedString(input.skill, input.name)
        ? { skill: firstTrimmedString(input.skill, input.name) }
        : {};
    case 'websearch':
      return normalizeWebSearchInput(input);
    default:
      return input;
  }
}

export function normalizeGrokToolUseResult(
  rawName: string | undefined,
  input: Record<string, unknown>,
  rawOutput: unknown,
): SDKToolUseResult | undefined {
  const knownName = toKnownToolName(rawName);
  const metadata = extractToolMetadata(rawOutput);
  const normalized: SDKToolUseResult = {};

  if (
    (knownName === 'write' || knownName === 'edit')
    && firstString(input.file_path, input.filePath, metadata?.filepath, metadata?.filePath)
  ) {
    normalized.filePath = firstString(input.file_path, input.filePath, metadata?.filepath, metadata?.filePath);
  }

  if (knownName === 'question') {
    const questions = Array.isArray(input.questions)
      ? input.questions as AskUserQuestionItem[]
      : [];
    const answers = normalizeQuestionAnswers(metadata?.answers, questions);
    if (answers) {
      normalized.answers = answers;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createGrokToolStreamAdapter(): AcpToolStreamAdapter {
  return new AcpToolStreamAdapter({
    normalizeToolInput: normalizeGrokToolInput,
    normalizeToolName: normalizeGrokToolName,
    normalizeToolUseResult: normalizeGrokToolUseResult,
    resolveRawToolName: resolveGrokRawToolName,
  });
}
