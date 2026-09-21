import { applyOrchestratorModeInstructions } from '../../core/prompt/mainAgent';
import type { ChatTurnRequest } from '../../core/runtime/types';
import type { ChatMessage, ImageAttachment } from '../../core/types';
import { appendBrowserContext } from '../../utils/browser';
import { appendCanvasContext } from '../../utils/canvas';
import {
  appendContextFiles,
  appendCurrentNote,
  appendExcludedFoldersContext,
  appendProjectWorkspaceContext,
  appendVaultSearchContext,
} from '../../utils/context';
import { appendEditorContext } from '../../utils/editor';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../utils/session';
import type { AcpContentBlock } from './types';


interface AcpContextPromptOptions {
  orchestratorMode?: boolean;
}

export function buildAcpContextPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): string {
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

  if (conversationHistory.length > 0) {
    const historyContext = buildContextFromHistory(conversationHistory);
    prompt = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      prompt,
      conversationHistory,
    );
  }

  return prompt;
}

export function buildAcpContextPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  options: AcpContextPromptOptions = {},
): AcpContentBlock[] {
  const prompt = buildAcpContextPromptText(request, conversationHistory);
  const text = request.orchestratorMode === true || options.orchestratorMode === true
    ? applyOrchestratorModeInstructions(prompt)
    : prompt;
  const blocks: AcpContentBlock[] = [{ text, type: 'text' }];
  for (const image of request.images ?? []) {
    blocks.push(toAcpImage(image));
  }
  return blocks;
}

function toAcpImage(image: ImageAttachment): AcpContentBlock {
  return {
    data: image.data,
    mimeType: image.mediaType,
    type: 'image',
  };
}
