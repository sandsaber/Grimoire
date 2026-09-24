import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import type { AcpQuestion } from '@/providers/acp/execution/AcpQuestionPresenter';
import type { ManagedAcpPreparedInteraction } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { buildOpencodePermissionPresentation } from '@/providers/opencode/execution/OpencodePermissionPresentation';
import { isRecord } from '@/utils/records';

import type { OpencodeQuestionResponse } from './OpencodeQuestions';


/**
 * OpenCode's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared; what is OpenCode's is the sentence a person reads,
 * which its own vocabulary writes from the tool that raised the request.
 */
export class OpencodeInteractionBridge extends AcpPermissionBridge {
  private readonly questions = new Map<string, readonly AcpQuestion[]>();
  private readonly questionSettled = new Set<(ref: string) => void>();
  private questionSequence = 0;

  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildOpencodePermissionPresentation(
        request.toolCall.title,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }

  question(presentationRef: string): readonly AcpQuestion[] | undefined {
    return this.questions.get(presentationRef);
  }

  override onSettled(listener: (ref: string) => void): () => void {
    const unsubscribe = super.onSettled(listener);
    this.questionSettled.add(listener);
    return () => { unsubscribe(); this.questionSettled.delete(listener); };
  }

  clearQuestions(): void {
    for (const ref of this.questions.keys()) this.forgetQuestion(ref);
  }

  override async prepare(request: AcpRequestPermissionRequest): Promise<ManagedAcpPreparedInteraction> {
    const input = request.toolCall.rawInput;
    if (request.toolCall.title !== 'grimoire-question' || !isRecord(input) || input.grimoireForm !== true) {
      return super.prepare(request);
    }
    if (!Array.isArray(input.questions) || !input.questions.length
      || !input.questions.every(question => isRecord(question) && typeof question.question === 'string' && Array.isArray(question.options))) {
      throw new Error('OpenCode sent an invalid question.');
    }
    const questions = input.questions as AcpQuestion[];
    const ref = `oc-question-${++this.questionSequence}`;
    this.questions.set(ref, questions);
    return {
      kind: 'question', presentationRef: ref, responseIds: ['answered', 'cancel'], providerResolvedResponseId: 'cancel',
      resolve: async (responseId, payload) => {
        this.forgetQuestion(ref);
        const answers = isRecord(payload) && isRecord(payload.answers) ? payload.answers : null;
        if (responseId !== 'answered' || !answers || !Object.values(answers).every(value => typeof value === 'string'
          || (Array.isArray(value) && value.every(item => typeof item === 'string')))) {
          return { outcome: { outcome: 'cancelled' } };
        }
        return { outcome: { outcome: 'selected', optionId: 'answered' },
          answers: answers as Record<string, string | string[]> } satisfies OpencodeQuestionResponse;
      },
      cancel: async () => {
        this.forgetQuestion(ref);
        return { outcome: { outcome: 'cancelled' } };
      },
    };
  }

  private forgetQuestion(ref: string): void {
    if (!this.questions.delete(ref)) return;
    for (const listener of this.questionSettled) listener(ref);
  }
}
