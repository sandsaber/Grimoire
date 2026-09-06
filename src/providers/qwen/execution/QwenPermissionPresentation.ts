/**
 * How a Qwen permission request is described to the person answering it.
 *
 * Extracted from the legacy runtime, which now delegates to it, so the flip
 * does not produce a second opinion about what Qwen is asking for.
 *
 * The fallback name is `Qwen Code action`, not `Qwen action`: it is product
 * copy the runtime has been showing users, and copy is copied.
 *
 * **Deliberately not a vocabulary.** OpenCode and Grok switch on an id the
 * agent sends and write a sentence per tool; Qwen names the tool in the title
 * and this describes whatever that is. Inventing a switch here would mean
 * guessing ids — this provider's wire recording never opened a session at all,
 * so it saw no permission request and no tool — and a guessed id falls through
 * to a worse sentence than the general one. The general one is what the legacy runtime
 * has been showing users, and it is what this keeps.
 */

/** What the approval prompt says, for one Qwen permission request. */
export interface QwenPermissionPresentation {
  readonly blockedPath?: string;
  readonly description: string;
  readonly toolName: string;
}

/** The prompt's words, from the tool that raised the request. */
export function buildQwenPermissionPresentation(
  rawTitle: string | null | undefined,
  rawKind: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): QwenPermissionPresentation {
  // The title first, the kind behind it, and a name for the provider last: a
  // prompt that says only "requests permission" with no subject is one a person
  // cannot answer.
  const toolName = rawTitle?.trim() || rawKind?.trim() || 'Qwen Code action';
  const blockedPath = extractPermissionPath(input, locations);
  return {
    ...(blockedPath ? { blockedPath } : {}),
    description: blockedPath
      ? `${toolName} requests access to ${blockedPath}.`
      : `${toolName} requests permission.`,
    toolName,
  };
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): string | undefined {
  // The order the legacy runtime looked in, kept: `path` before the two spellings
  // of a file path, and the tool call's own locations behind all three.
  for (const key of ['path', 'filePath', 'filepath']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return locations
    ?.map((location) => (typeof location?.path === 'string' ? location.path.trim() : ''))
    .find((path) => path.length > 0) || undefined;
}
