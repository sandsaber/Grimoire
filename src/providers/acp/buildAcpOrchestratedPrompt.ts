import { applyOrchestratorModeInstructions } from '../../core/prompt/mainAgent';
import type { ChatTurnRequest } from '../../core/runtime/types';
import type { ChatMessage } from '../../core/types';
import { buildAcpContextPromptText } from './buildAcpContextPrompt';
import type { AcpContentBlock } from './types';

interface AcpOrchestratedPromptOptions {
  orchestratorMode?: boolean;
}

export function buildAcpOrchestratedPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  options: AcpOrchestratedPromptOptions = {},
): string {
  let prompt = buildAcpContextPromptText({ ...request,
    editorSelection: request.editorSelection?.mode === 'none' ? undefined : request.editorSelection,
  }, conversationHistory);

  if (request.orchestratorMode === true || options.orchestratorMode === true) {
    prompt = applyOrchestratorModeInstructions(prompt);
  }

  return prompt;
}

export function buildAcpOrchestratedPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  options: AcpOrchestratedPromptOptions = {},
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [
    { type: 'text', text: buildAcpOrchestratedPromptText(request, conversationHistory, options) },
  ];

  for (const image of request.images ?? []) {
    if (!image.data) {
      continue;
    }

    blocks.push({
      data: image.data,
      mimeType: image.mediaType,
      type: 'image',
    });
  }

  return blocks;
}
