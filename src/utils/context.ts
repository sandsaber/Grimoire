/**
 * Grimoire - Context Utilities
 *
 * Current note and context file formatting for prompts.
 */

import { escapeXmlAttribute, escapeXmlText } from '../core/context/text';
import type { ContextSnippet, ProjectWorkspace } from '../core/context/types';

// Matches <current_note> at the START of prompt (legacy format)
const CURRENT_NOTE_PREFIX_REGEX = /^<current_note>\n[\s\S]*?<\/current_note>\n\n/;
// Matches <current_note> at the END of prompt (current format)
const CURRENT_NOTE_SUFFIX_REGEX = /\n\n<current_note>\n[\s\S]*?<\/current_note>$/;

/**
 * Pattern to match XML context tags appended to prompts.
 * Providers may serialize the separator as one or more newlines.
 * Matches: current_note, editor_selection (with attributes), editor_cursor (with attributes),
 * context_files, excluded_folders, canvas_selection, browser_selection, vault_search, project_workspace
 */
export const XML_CONTEXT_PATTERN = /\n+<(?:current_note|editor_selection|editor_cursor|context_files|excluded_folders|canvas_selection|browser_selection|vault_search|project_workspace)[\s>]/;

const CURRENT_NOTE_DEFAULT_TARGET_HINT = 'Default target: If the user asks to edit, rewrite, update, or apply instructions without naming another target file, use this note as the target file.';

export function formatCurrentNote(notePath: string): string {
  return [
    '<current_note>',
    notePath,
    CURRENT_NOTE_DEFAULT_TARGET_HINT,
    '</current_note>',
  ].join('\n');
}

export function appendCurrentNote(prompt: string, notePath: string): string {
  return `${prompt}\n\n${formatCurrentNote(notePath)}`;
}

/**
 * Strips current note context from a prompt (both prefix and suffix formats).
 * Handles legacy (prefix) and current (suffix) formats.
 */
export function stripCurrentNoteContext(prompt: string): string {
  // Try prefix format first (legacy)
  const strippedPrefix = prompt.replace(CURRENT_NOTE_PREFIX_REGEX, '');
  if (strippedPrefix !== prompt) {
    return strippedPrefix;
  }
  // Try suffix format (current)
  return prompt.replace(CURRENT_NOTE_SUFFIX_REGEX, '');
}

/**
 * Extracts user content that appears before XML context tags.
 * Handles two formats:
 * 1. Legacy: content inside <query> tags
 * 2. Current: user content first, context XML appended after
 */
export function extractContentBeforeXmlContext(text: string): string | undefined {
  if (!text) return undefined;

  // Legacy format: content inside <query> tags
  const queryMatch = text.match(/<query>\n?([\s\S]*?)\n?<\/query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }

  // Current format: user content before any XML context tags
  // Context tags are appended after one or more newlines.
  const xmlMatch = text.match(XML_CONTEXT_PATTERN);
  if (xmlMatch?.index !== undefined) {
    return text.substring(0, xmlMatch.index).trim();
  }

  return undefined;
}

/**
 * Extracts the actual user query from an XML-wrapped prompt.
 * Used for comparing prompts during history deduplication and history hydrate.
 *
 * Always returns a string - falls back to stripping all XML tags if no
 * structured context is found.
 *
 * Also understands Grok Build harness wrappers:
 * - `<user_info>...</user_info>` environment blocks (not user-visible)
 * - `<rules>...</rules>` workspace / user-rule dumps (not user-visible)
 * - `<user_query>...</user_query>` (closing tag may be missing in partial history)
 */
export function extractUserQuery(prompt: string): string {
  if (!prompt) return '';

  const withoutHarness = stripGrokHarnessWrappers(prompt);
  if (!withoutHarness) {
    return '';
  }

  // Grok Build wraps the real request; history sometimes omits the closing tag.
  const userQueryMatch = withoutHarness.match(
    /<user_query\b[^>]*>\s*([\s\S]*?)(?:\s*<\/user_query\s*>|$)/i,
  );
  if (userQueryMatch) {
    return stripGrokHarnessWrappers(userQueryMatch[1]);
  }

  // Try to extract content before XML context
  const extracted = extractContentBeforeXmlContext(withoutHarness);
  if (extracted !== undefined) {
    return extracted;
  }

  // No XML context - return the whole prompt stripped of any remaining tags
  return withoutHarness
    .replace(/<current_note>[\s\S]*?<\/current_note>\s*/g, '')
    .replace(/<editor_selection[\s\S]*?<\/editor_selection>\s*/g, '')
    .replace(/<editor_cursor[\s\S]*?<\/editor_cursor>\s*/g, '')
    .replace(/<context_files>[\s\S]*?<\/context_files>\s*/g, '')
    .replace(/<excluded_folders>[\s\S]*?<\/excluded_folders>\s*/g, '')
    .replace(/<canvas_selection[\s\S]*?<\/canvas_selection>\s*/g, '')
    .replace(/<browser_selection[\s\S]*?<\/browser_selection>\s*/g, '')
    .replace(/<vault_search[\s\S]*?<\/vault_search>\s*/g, '')
    .replace(/<project_workspace[\s\S]*?<\/project_workspace>\s*/g, '')
    .trim();
}

/** Drop Grok Build environment and workspace-rule dumps that are not chat text. */
function stripGrokHarnessWrappers(prompt: string): string {
  const withoutClosed = prompt
    .replace(/<user_info\b[^>]*>[\s\S]*?<\/user_info>\s*/gi, '')
    .replace(/<rules\b[^>]*>[\s\S]*?<\/rules>\s*/gi, '')
    .trim();
  if (withoutClosed) {
    if (
      /^<rules\b/i.test(withoutClosed)
      && /<always_applied_workspace_rules\b/i.test(withoutClosed)
    ) {
      return '';
    }
    return withoutClosed;
  }

  return '';
}

function formatContextFilesLine(files: string[]): string {
  const fileLines = files.map(file => `- ${file}`).join('\n');
  return [
    '<context_files>',
    'The user selected these files as active context.',
    'Inspect the relevant selected files before answering broad or deictic requests.',
    'Do not ignore these files just because the user did not name them explicitly in the message.',
    '',
    fileLines,
    '</context_files>',
  ].join('\n');
}

export function appendContextFiles(prompt: string, files: string[]): string {
  return `${prompt}\n\n${formatContextFilesLine(files)}`;
}

export function appendExcludedFoldersContext(prompt: string, folders: string[]): string {
  const lines = ['<excluded_folders>'];

  for (const folder of folders) {
    lines.push(`  <folder>${escapeXmlText(folder)}</folder>`);
  }

  lines.push('</excluded_folders>');
  return `${prompt}\n\n${lines.join('\n')}`;
}

export function appendVaultSearchContext(
  prompt: string,
  context: { query: string; snippets: ContextSnippet[] },
): string {
  const lines = [
    `<vault_search query="${escapeXmlAttribute(context.query)}">`,
  ];

  for (const snippet of context.snippets) {
    lines.push(
      `  <source id="${escapeXmlAttribute(snippet.source.id)}" path="${escapeXmlAttribute(
        snippet.source.path,
      )}" title="${escapeXmlAttribute(snippet.source.title)}" score="${escapeXmlAttribute(
        snippet.score.toFixed(2),
      )}">`,
      `    ${escapeXmlText(snippet.text)}`,
      '  </source>',
    );
  }

  lines.push('</vault_search>');

  return `${prompt}\n\n${lines.join('\n')}`;
}

export function appendProjectWorkspaceContext(
  prompt: string,
  context: { workspace: ProjectWorkspace },
): string {
  const { workspace } = context;
  const lines = [
    `<project_workspace id="${escapeXmlAttribute(workspace.id)}" name="${escapeXmlAttribute(workspace.name)}">`,
  ];

  if (workspace.systemPrompt) {
    lines.push('  <system_prompt>', `    ${escapeXmlText(workspace.systemPrompt)}`, '  </system_prompt>');
  }
  if (workspace.vaultFolders.length > 0) {
    lines.push('  <vault_folders>');
    for (const folder of workspace.vaultFolders) {
      lines.push(`    <folder>${escapeXmlText(folder)}</folder>`);
    }
    lines.push('  </vault_folders>');
  }
  if (workspace.vaultFiles.length > 0) {
    lines.push('  <vault_files>');
    for (const file of workspace.vaultFiles) {
      lines.push(`    <file>${escapeXmlText(file)}</file>`);
    }
    lines.push('  </vault_files>');
  }
  if (workspace.tags.length > 0) {
    lines.push('  <tags>');
    for (const tag of workspace.tags) {
      lines.push(`    <tag>${escapeXmlText(tag)}</tag>`);
    }
    lines.push('  </tags>');
  }

  lines.push('</project_workspace>');
  return `${prompt}\n\n${lines.join('\n')}`;
}
