import { applyOrchestratorModeInstructions } from '../../../core/prompt/mainAgent';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage, ImageAttachment } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import {
  appendContextFiles,
  appendCurrentNote,
  appendExcludedFoldersContext,
  appendProjectWorkspaceContext,
  appendVaultSearchContext,
} from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import type { AcpContentBlock } from '../../acp';

/**
 * What one Qwen turn says, and the eight pieces of the vault in it.
 *
 * Moved out of `QwenChatRuntime` before the flip deleted that file, because a
 * turn composed by the kernel has to say exactly what a turn composed by the
 * runtime said. Byte-identical to Gemini's under a normalized diff, which is
 * what a derivation should look like where nothing is actually different. The order is load-bearing: every appender writes after the
 * user's own text, and the history block wraps whatever the seven before it
 * produced.
 */

interface QwenPromptOptions {
  orchestratorMode?: boolean;
}

export function buildQwenPromptText(
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

/**
 * The same turn as ACP content: the text first, then whatever was attached.
 *
 * The orchestrator instructions are applied here rather than inside the text,
 * which is where the legacy runtime applied them — after every context block,
 * so they are the last thing the agent reads.
 */
export function buildQwenPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  options: QwenPromptOptions = {},
): AcpContentBlock[] {
  const prompt = buildQwenPromptText(request, conversationHistory);
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
