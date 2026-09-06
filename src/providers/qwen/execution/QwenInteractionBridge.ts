import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import {
  AcpPermissionBridge,
} from '@/providers/acp/execution/AcpPermissionBridge';
import type { ManagedAcpPreparedInteraction } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import {
  mapQwenQuestionAnswers,
  type QwenAskUserQuestion,
  type QwenAskUserQuestionResponse,
} from '@/providers/qwen/execution/QwenAskUserQuestion';
import { buildQwenPermissionPresentation } from '@/providers/qwen/execution/QwenPermissionPresentation';


/**
 * Qwen's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared with every managed-ACP provider; what is Qwen's is the
 * sentence a person reads, which names whatever tool the title carries rather
 * than switching on a vocabulary of ids this provider has never been observed
 * to send — its recording never opened a session at all.
 *
 * **What is missing here is the second interaction kind.** The legacy runtime
 * answers an ACP ask-user-question through this same permission channel, and
 * the kernel models `kind: 'question'` but has never carried one. Left out
 * rather than guessed: the composition is where that decision belongs, and a
 * bridge that opened a question nothing could resolve would hang the turn that
 * raised it.
 */
export class QwenInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildQwenPermissionPresentation(
        request.toolCall.title,
        request.toolCall.kind,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}

/** The response id a question is answered under; the answer rides beside it. */
const ANSWERED = 'answered';
const CANCEL = 'cancel';

/**
 * The bridge for the one interaction that is not a permission.
 *
 * Qwen sends `ask_user_question` down the **permission** channel, and its reply
 * carries structured answers beside the option id. That is why
 * `InteractionResolution` has a payload at all: a response id alone cannot say
 * what somebody typed.
 *
 * Opened as `kind: 'question'`, which the kernel has modelled since M1 and which
 * nothing had ever carried — so this is the first interaction of that kind in
 * the product, and the reason the registry now refuses to *replay* one: the
 * answer is never written down, so a question caught mid-resolution by a reload
 * is cancelled rather than completed with an answer nobody gave.
 */
export function prepareQwenQuestion(
  request: AcpRequestPermissionRequest,
  questions: readonly QwenAskUserQuestion[],
  presentationRef: string,
  remember: (ref: string, questions: readonly QwenAskUserQuestion[]) => void,
  forget: (ref: string) => void,
): ManagedAcpPreparedInteraction {
  // The option the agent offers for "the person answered". Without one there is
  // nothing to select, and the honest reply is that nobody answered.
  const allowOnce = request.options.find(option => option.kind === 'allow_once');
  remember(presentationRef, questions);
  return {
    kind: 'question',
    presentationRef,
    responseIds: [ANSWERED, CANCEL],
    providerResolvedResponseId: CANCEL,
    resolve: async (responseId, payload) => {
      forget(presentationRef);
      const answers = readAnswers(payload);
      if (responseId !== ANSWERED || !allowOnce || !answers) {
        return { outcome: { outcome: 'cancelled' } };
      }
      return {
        answers: mapQwenQuestionAnswers(answers, questions),
        outcome: { optionId: allowOnce.optionId, outcome: 'selected' },
      } satisfies QwenAskUserQuestionResponse;
    },
    cancel: async () => {
      forget(presentationRef);
      return { outcome: { outcome: 'cancelled' } };
    },
  };
}

/**
 * The answers out of an opaque payload, or nothing.
 *
 * The payload crossed a boundary core does not read, so nothing upstream
 * guarantees its shape — and a malformed one must read as "nobody answered"
 * rather than as an answer of `{}`, which the agent would act on.
 */
function readAnswers(payload: unknown): Record<string, string | string[]> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const answers = (payload as { answers?: unknown }).answers;
  return answers && typeof answers === 'object' && !Array.isArray(answers)
    ? answers as Record<string, string | string[]>
    : null;
}

/** How an opened Qwen approval reaches the surface. */
export class QwenInteractionPresenter extends AcpApprovalPresenter {}

