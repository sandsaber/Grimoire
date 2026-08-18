import type { InteractionRequest } from '../../../core/execution/ExecutionContracts';
import type {
  ApprovalCallback,
  ApprovalDecisionOption,
  AskUserQuestionCallback,
} from '../../../core/runtime/types';
import type { ApprovalDecision } from '../../../core/types';
import type {
  CodexApprovalOption,
  CodexInteractionBridge,
  CodexInteractionPresentation,
} from './CodexInteractionBridge';

/**
 * The callbacks the chat surface installed, read when an interaction opens.
 *
 * Read late rather than captured: the adapter is constructed before the view
 * installs them, and a tab that has not opened its approval UI yet must still
 * be able to receive one.
 */
export type CodexInteractionCallbacks = () => Readonly<Record<string, unknown>>;

const DECISION_RESPONSE_IDS: Record<string, string> = {
  allow: 'allow-once',
  'allow-always': 'allow-always',
  deny: 'deny',
  cancel: 'cancel',
};

/**
 * An opened Codex interaction, rendered by the surface that already knows how.
 *
 * The chat surface speaks the legacy callback contract — a tool name, an input,
 * a description, a set of decision options — and the kernel speaks response
 * ids. This holds those two vocabularies together so neither has to learn the
 * other's: the options it hands the surface carry the kernel's ids as their
 * values, so what comes back is already an answer the run can record.
 */
export class CodexInteractionPresenter {
  constructor(
    private readonly bridge: Pick<CodexInteractionBridge, 'presentation' | 'submitAnswers'>,
    private readonly callbacks: CodexInteractionCallbacks,
  ) {}

  async present(request: InteractionRequest): Promise<string | null> {
    const presentation = this.bridge.presentation(request.presentationRef);
    if (!presentation) {
      // Nothing to show the user. Answering anyway would be the UI deciding on
      // their behalf, which is the one thing an approval must never do.
      return null;
    }

    return presentation.kind === 'approval'
      ? this.presentApproval(request, presentation)
      : this.presentQuestion(request, presentation);
  }

  private async presentApproval(
    request: InteractionRequest,
    presentation: Extract<CodexInteractionPresentation, { kind: 'approval' }>,
  ): Promise<string | null> {
    const approval = this.callbacks().approval as ApprovalCallback | undefined;
    // A missing callback is answered rather than left open, which is what the
    // legacy runtime did: a prompt nobody can see would hang the turn.
    if (!approval) {
      return declined(request);
    }

    const decision = await approval(
      presentation.toolName,
      presentation.input,
      presentation.description,
      {
        decisionOptions: presentation.options.map(toDecisionOption),
        ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
        ...(presentation.networkApprovalContext
          ? { networkApprovalContext: presentation.networkApprovalContext }
          : {}),
        ...(presentation.additionalPermissions
          ? { additionalPermissions: presentation.additionalPermissions }
          : {}),
      },
    );

    return toResponseId(decision, request);
  }

  private async presentQuestion(
    request: InteractionRequest,
    presentation: Extract<CodexInteractionPresentation, { kind: 'question' }>,
  ): Promise<string | null> {
    const ask = this.callbacks().question as AskUserQuestionCallback | undefined;
    if (!ask) {
      return 'dismissed';
    }

    const answers = await ask({ questions: [...presentation.questions] });
    if (!answers) {
      return 'dismissed';
    }

    // Handed over before the id is returned, because the id only says *that*
    // it was answered — the answers themselves never leave the provider.
    this.bridge.submitAnswers(request.presentationRef, answers);
    return 'answered';
  }
}

function toDecisionOption(option: CodexApprovalOption): ApprovalDecisionOption {
  return {
    label: option.label,
    // The kernel's id, so a picked option comes back as an answer the run can
    // record without a second mapping table.
    value: option.responseId,
    ...(option.description ? { description: option.description } : {}),
    ...(option.presentation ? { presentation: option.presentation } : {}),
    ...(DECISION_RESPONSE_IDS[option.responseId]
      ? { decision: legacyDecisionFor(option.responseId) }
      : {}),
  };
}

function legacyDecisionFor(responseId: string): ApprovalDecision {
  if (responseId === 'allow-once') return 'allow';
  if (responseId === 'allow-always') return 'allow-always';
  if (responseId === 'cancel') return 'cancel';
  return 'deny';
}

function toResponseId(decision: ApprovalDecision, request: InteractionRequest): string | null {
  if (typeof decision === 'object' && decision?.type === 'select-option') {
    return request.responseIds.includes(decision.value)
      ? decision.value
      : declined(request);
  }

  const responseId = DECISION_RESPONSE_IDS[decision as string];
  return responseId && request.responseIds.includes(responseId)
    ? responseId
    : declined(request);
}

/**
 * Declining, where this interaction offers it.
 *
 * The answer for anything the interaction cannot express, which is what the
 * legacy runtime mapped an unrecognised decision to. Where decline is not on
 * offer there is nothing safe to say, so it says nothing.
 */
function declined(request: InteractionRequest): string | null {
  return request.responseIds.includes('deny') ? 'deny' : null;
}
