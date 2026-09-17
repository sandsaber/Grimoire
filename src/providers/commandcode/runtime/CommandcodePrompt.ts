import type { ChatTurnRequest } from '@/core/runtime/types';
import { appendBrowserContext } from '@/utils/browser';
import { appendCanvasContext } from '@/utils/canvas';
import { appendContextFiles, appendCurrentNote, appendExcludedFoldersContext,
  appendProjectWorkspaceContext, appendVaultSearchContext } from '@/utils/context';
import { appendEditorContext } from '@/utils/editor';

/** Native resume carries history; this text contains only the current turn's context. */
export function buildCommandcodePrompt(request: ChatTurnRequest): string {
  let prompt = request.text;
  if (request.excludedFolders?.length) prompt = appendExcludedFoldersContext(prompt, request.excludedFolders);
  if (request.currentNotePath) prompt = appendCurrentNote(prompt, request.currentNotePath);
  if (request.vaultSearchContext) prompt = appendVaultSearchContext(prompt, request.vaultSearchContext);
  if (request.contextFiles?.length) prompt = appendContextFiles(prompt, request.contextFiles);
  if (request.projectWorkspaceContext) prompt = appendProjectWorkspaceContext(prompt, request.projectWorkspaceContext);
  if (request.editorSelection) prompt = appendEditorContext(prompt, request.editorSelection);
  if (request.browserSelection) prompt = appendBrowserContext(prompt, request.browserSelection);
  if (request.canvasSelection) prompt = appendCanvasContext(prompt, request.canvasSelection);
  return prompt;
}
