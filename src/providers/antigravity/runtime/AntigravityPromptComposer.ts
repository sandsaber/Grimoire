import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import {
  appendContextFiles,
  appendCurrentNote,
  appendExcludedFoldersContext,
  appendProjectWorkspaceContext,
  appendVaultSearchContext,
  formatCurrentNote,
} from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';

/** How many prior messages print mode replays, since it keeps no session. */
const HISTORY_WINDOW = 12;

/** The turn's text with every context surface the request carried appended. */
export function buildAntigravityPromptText(request: ChatTurnRequest): string {
  let prompt = request.text;

  if (request.excludedFolders && request.excludedFolders.length > 0) {
    prompt = appendExcludedFoldersContext(prompt, request.excludedFolders);
  }

  if (request.currentNotePath) {
    prompt = appendCurrentNote(prompt, request.currentNotePath);
  }

  if (request.vaultSearchContext) {
    prompt = appendVaultSearchContext(prompt, request.vaultSearchContext);
  }

  if (request.contextFiles && request.contextFiles.length > 0) {
    prompt = appendContextFiles(prompt, request.contextFiles);
  }

  if (request.projectWorkspaceContext) {
    prompt = appendProjectWorkspaceContext(prompt, request.projectWorkspaceContext);
  }

  if (request.editorSelection) {
    prompt = appendEditorContext(prompt, request.editorSelection);
  }

  if (request.browserSelection) {
    prompt = appendBrowserContext(prompt, request.browserSelection);
  }

  if (request.canvasSelection) {
    prompt = appendCanvasContext(prompt, request.canvasSelection);
  }

  return prompt;
}

/**
 * The single string `agy --print` receives.
 *
 * Print mode is stateless, so continuity exists only as replayed history. The
 * window is bounded because the whole conversation would grow past what one
 * command line and one context window can carry.
 */
export function buildAntigravityPrintPrompt(
  currentPrompt: string,
  conversationHistory?: ChatMessage[],
): string {
  const history = (conversationHistory ?? [])
    .filter((message) => !message.isRebuiltContext && (message.content.trim() || message.currentNote))
    .slice(-HISTORY_WINDOW)
    .map(formatAntigravityHistoryMessage)
    .join('\n\n');

  return history ? `${history}\n\nUser: ${currentPrompt}` : currentPrompt;
}

function formatAntigravityHistoryMessage(message: ChatMessage): string {
  const role = message.role === 'assistant' ? 'Assistant' : 'User';
  let content = message.content.trim();

  if (
    message.role === 'user'
    && message.currentNote
    && !content.includes('<current_note>')
  ) {
    const currentNoteContext = formatCurrentNote(message.currentNote);
    content = content ? `${currentNoteContext}\n\n${content}` : currentNoteContext;
  }

  return `${role}: ${content}`;
}
