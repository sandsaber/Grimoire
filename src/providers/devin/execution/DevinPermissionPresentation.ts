/**
 * How a Devin permission request is described to the person answering it.
 *
 * What Devin sends is thinner than the protocol allows, and the recording says
 * exactly how: `session/request_permission` carries a `toolCall` with an id and,
 * for a shell command, `_meta["cognition.ai/editableCommand"]` — no title, no
 * kind, no `rawInput`. For an edit in Plan mode or a plan exit it carries the id
 * alone. What the request is *about* was said a moment earlier, by the
 * `tool_call` update with the same id (observed 2026-09-09: the update always
 * precedes the request), so the bridge looks that up and hands it in here.
 */

/** What a `tool_call` update said about the call a request is for. */
export interface DevinToolCallRecord {
  readonly toolCallId: string;
  readonly title?: string | null;
  readonly kind?: string | null;
  readonly rawInput?: unknown;
  readonly locations?: ReadonlyArray<{ path: string }> | null;
  /** The file a diff in the call's content is for, when there is one. */
  readonly diffPath?: string | null;
  readonly meta?: Record<string, unknown> | null;
}

/** What the approval prompt says, for one Devin permission request. */
export interface DevinPermissionPresentation {
  readonly blockedPath?: string;
  readonly description: string;
  readonly toolName: string;
}

const EDITABLE_COMMAND_KEY = 'cognition.ai/editableCommand';
const EXIT_PLAN_KEY = 'cognition.ai/isExitPlan';

/** The prompt's words, from the tool that raised the request. */
export function buildDevinPermissionPresentation(
  rawTitle: string | null | undefined,
  rawKind: string | null | undefined,
  input: Record<string, unknown>,
  locations: ReadonlyArray<{ path: string }> | null | undefined,
  meta?: Record<string, unknown> | null,
  recorded?: DevinToolCallRecord,
): DevinPermissionPresentation {
  const title = rawTitle?.trim() || recorded?.title?.trim() || '';
  const kind = rawKind?.trim() || recorded?.kind?.trim() || '';
  const command = readCommand(input, meta) ?? readCommand(asRecord(recorded?.rawInput), recorded?.meta);
  if (command) {
    return {
      description: `Devin wants to run \`${command}\`.`,
      toolName: title || 'Shell command',
    };
  }
  if (kind === 'switch_mode' || meta?.[EXIT_PLAN_KEY] === true || recorded?.meta?.[EXIT_PLAN_KEY] === true) {
    return {
      description: 'Devin wants to leave Plan mode and start implementing the plan.',
      toolName: title || 'Exit plan mode',
    };
  }
  const path = extractPermissionPath(input, locations)
    ?? recorded?.diffPath?.trim()
    ?? extractPermissionPath(asRecord(recorded?.rawInput) ?? {}, recorded?.locations);
  if (kind === 'edit' && path) {
    return {
      blockedPath: path,
      description: `Devin wants to write ${path}.`,
      toolName: title || 'Write file',
    };
  }
  const toolName = title || kind || 'Devin action';
  return {
    ...(path ? { blockedPath: path } : {}),
    description: path
      ? `${toolName} requests access to ${path}.`
      : `${toolName} requests permission.`,
    toolName,
  };
}

function readCommand(
  input: Record<string, unknown> | null | undefined,
  meta: Record<string, unknown> | null | undefined,
): string | undefined {
  const fromMeta = meta?.[EDITABLE_COMMAND_KEY];
  if (typeof fromMeta === 'string' && fromMeta.trim()) {
    return fromMeta.trim();
  }
  const fromInput = input?.command;
  return typeof fromInput === 'string' && fromInput.trim() ? fromInput.trim() : undefined;
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: ReadonlyArray<{ path: string }> | null | undefined,
): string | undefined {
  for (const key of ['path', 'file_path', 'filePath', 'filepath']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return locations
    ?.map((location) => (typeof location?.path === 'string' ? location.path.trim() : ''))
    .find((path) => path.length > 0) || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
