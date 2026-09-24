import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import type { ExecutionInteractionAnswer } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { AskUserQuestionItem, AskUserQuestionOption } from '@/core/types';

import type { AcpApprovalPresenter } from './AcpApprovalPresenter';

export type AcpQuestion = Omit<AskUserQuestionItem, 'header' | 'options'> & {
  header?: string;
  options: Array<Omit<AskUserQuestionOption, 'description'> & { description?: string }>;
};

/** Questions share the existing chat question callback; ordinary approvals keep their presenter. */
export class AcpQuestionPresenter {
  private readonly open = new Map<string, AbortController>();

  constructor(
    private readonly approvals: Pick<AcpApprovalPresenter, 'present' | 'dismiss' | 'dismissAll'>,
    private readonly questions: (presentationRef: string) => readonly AcpQuestion[] | undefined,
    private readonly callbacks: () => Readonly<Record<string, unknown>>,
  ) {}

  async present(request: InteractionRequest): Promise<string | ExecutionInteractionAnswer | null> {
    const asked = this.questions(request.presentationRef);
    if (!asked) return this.approvals.present(request);
    const ask = this.callbacks().question as
      | ((input: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, string | string[]> | null>)
      | undefined;
    if (typeof ask !== 'function') return 'cancel';
    const abort = new AbortController();
    this.open.set(request.presentationRef, abort);
    try {
      const answers = await ask({ questions: [...asked] }, abort.signal);
      return answers === null ? 'cancel' : { responseId: 'answered', payload: { answers } };
    } catch {
      return 'cancel';
    } finally {
      this.open.delete(request.presentationRef);
    }
  }

  dismiss(presentationRef: string): void {
    this.open.get(presentationRef)?.abort();
    this.open.delete(presentationRef);
    this.approvals.dismiss(presentationRef);
  }

  dismissAll(): void {
    for (const abort of this.open.values()) abort.abort();
    this.open.clear();
    this.approvals.dismissAll();
  }
}
