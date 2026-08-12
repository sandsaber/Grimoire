import type { ExecutionInteractionPresentationPort } from '@/app/runtime/ExecutionInteractionPresentationStore';
import { AcpPermissionInteractionBridge } from '@/providers/acp/execution/AcpPermissionInteractionBridge';
import type {
  AcpAskUserQuestionItem,
  AcpAskUserQuestionRequest,
  AcpAskUserQuestionResponse,
  AcpRequestPermissionRequest,
} from '@/providers/acp/types';

import type {
  GrokInteractionBridge,
  GrokPreparedApproval,
  GrokPreparedQuestion,
} from './GrokExecutionBackend';

const MAX_TITLE_LENGTH = 512;
const MAX_QUESTION_LENGTH = 8 * 1024;

/**
 * Grok-owned interaction bridge: approvals delegate to the shared ACP
 * permission bridge while direct questions get their own bounded presentation.
 */
export class GrokInteractionPresentationBridge implements GrokInteractionBridge {
  private readonly approvals: AcpPermissionInteractionBridge;

  constructor(presentations: ExecutionInteractionPresentationPort) {
    this.approvals = new AcpPermissionInteractionBridge(presentations);
    this.presentations = presentations;
  }

  private readonly presentations: ExecutionInteractionPresentationPort;

  async prepareApproval(request: AcpRequestPermissionRequest): Promise<GrokPreparedApproval> {
    const prepared = await this.approvals.prepare(request);
    return Object.freeze({
      kind: 'approval',
      presentationRef: prepared.presentationRef,
      responseIds: prepared.responseIds,
      providerResolvedResponseId: prepared.providerResolvedResponseId,
      resolve: (responseId: string) => prepared.resolve(responseId),
      cancel: () => prepared.cancel(),
    });
  }

  async prepareQuestion(request: AcpAskUserQuestionRequest): Promise<GrokPreparedQuestion> {
    const first = request.questions[0];
    if (!first) throw new Error('Grok question request has no questions.');
    const title = requireTitle(first.question);
    const description = first.options.length > 0
      ? optionalDescription(first.options.map(option => option.label).join(' / '))
      : undefined;
    const options = mapQuestionOptions(first);
    const { presentationRef } = await this.presentations.store({
      kind: 'question',
      title,
      ...(description ? { description } : {}),
      options,
    });
    const responseIds = Object.freeze(options.map(option => option.responseId));
    const providerResolved = responseIds[responseIds.length - 1] ?? 'skip';
    return Object.freeze({
      kind: 'question',
      presentationRef,
      responseIds,
      providerResolvedResponseId: providerResolved,
      resolve: async (responseId: string): Promise<AcpAskUserQuestionResponse> => {
        const option = options.find(candidate => candidate.responseId === responseId);
        if (!option) return { outcome: 'cancelled' };
        return {
          outcome: 'accepted',
          answers: { [first.question]: option.label },
        };
      },
      cancel: async (): Promise<AcpAskUserQuestionResponse> => ({ outcome: 'cancelled' }),
    });
  }
}

function mapQuestionOptions(
  item: AcpAskUserQuestionItem,
): readonly { readonly responseId: string; readonly label: string; readonly description?: string }[] {
  if (item.options.length === 0) {
    return [{ responseId: 'respond', label: 'Respond' }];
  }
  const seen = new Set<string>();
  const mapped: { responseId: string; label: string; description?: string }[] = [];
  item.options.forEach((option, index) => {
    const label = option.label.trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    mapped.push({
      responseId: `option-${index + 1}`,
      label,
      ...(option.description?.trim() ? { description: option.description.trim() } : {}),
    });
  });
  return mapped;
}

function requireTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Grok question title is empty.');
  if (trimmed.length > MAX_TITLE_LENGTH) throw new Error('Grok question title is too long.');
  return trimmed;
}

function optionalDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_QUESTION_LENGTH) throw new Error('Grok question description is too long.');
  return trimmed;
}
