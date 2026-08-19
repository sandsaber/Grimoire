import type { InteractionRequest } from '../../../core/execution/ExecutionContracts';
import type { ExecutionInteractionCallbacks } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ApprovalDecisionOption } from '../../../core/runtime/types';
import type { ApprovalDecision } from '../../../core/types';
import type {
  ClaudeApprovalOption,
  ClaudeInteractionBridge,
  ClaudeInteractionPresentation,
} from './ClaudeInteractionBridge';

/**
 * The callbacks the chat surface installed, read when an interaction opens.
 *
 * Read late rather than captured: the adapter is constructed before the view
 * installs them, and a tab that has not opened its approval UI yet must still
 * be able to receive one.
 */
export type ClaudeInteractionCallbacks = () => Readonly<ExecutionInteractionCallbacks>;

/**
 * The decisions the surface answers with, and the ids that stand for them.
 *
 * One list read both ways, because two hand-maintained inverses drift.
 */
const STANDARD_DECISIONS: ReadonlyArray<readonly [ApprovalDecision, string]> = [
  ['allow', 'allow-once'],
  ['allow-always', 'allow-always'],
  ['deny', 'deny'],
  ['cancel', 'cancelled'],
];

/**
 * An opened Claude interaction, rendered by the surface that already knows how.
 *
 * The chat surface speaks the legacy callback contract — a tool name, an input,
 * a description, a set of decision options — and the kernel speaks response
 * ids. This holds those two vocabularies together so neither has to learn the
 * other's: the options it hands the surface carry the kernel's ids as their
 * values, so what comes back is already an answer the run can record.
 *
 * Three kinds, because Claude asks three different things: a tool approval, a
 * question with structured answers, and a plan waiting to be approved or sent
 * back with feedback.
 */
export class ClaudeInteractionPresenter {
  /** What is on screen right now, so it can be taken down again. */
  private readonly open = new Map<string, AbortController>();

  constructor(
    private readonly bridge: Pick<ClaudeInteractionBridge, 'presentation' | 'submitAnswers'>,
    private readonly callbacks: ClaudeInteractionCallbacks,
  ) {}

  async present(request: InteractionRequest): Promise<string | null> {
    const presentation = this.bridge.presentation(request.presentationRef);
    if (!presentation) {
      // Nothing to show the user. Answering anyway would be the UI deciding on
      // their behalf, which is the one thing an approval must never do.
      return null;
    }
    const abort = new AbortController();
    this.open.set(request.presentationRef, abort);
    try {
      if (presentation.kind === 'approval') {
        return await this.presentApproval(request, presentation, abort.signal);
      }
      if (presentation.kind === 'question') {
        return await this.presentQuestion(request, presentation, abort.signal);
      }
      return await this.presentPlanDecision(request, presentation, abort.signal);
    } finally {
      this.open.delete(request.presentationRef);
    }
  }

  /**
   * Takes down one prompt, for an interaction that ended somewhere else.
   *
   * A run cancelled mid-approval settles without an answer from the user, and
   * the legacy runtime dismissed the prompt in exactly that case. Subscribe it
   * to the bridge's `onSettled`; without it the surface keeps a dead prompt up
   * with the composer locked behind it.
   */
  dismiss(presentationRef: string): void {
    const abort = this.open.get(presentationRef);
    if (!abort) {
      return;
    }
    this.open.delete(presentationRef);
    abort.abort();
    this.callbacks().approvalDismisser?.();
  }

  /** Takes down everything on screen; the composition's shutdown calls it. */
  dismissAll(): void {
    for (const presentationRef of [...this.open.keys()]) {
      this.dismiss(presentationRef);
    }
  }

  private async presentApproval(
    request: InteractionRequest,
    presentation: Extract<ClaudeInteractionPresentation, { kind: 'approval' }>,
    signal: AbortSignal,
  ): Promise<string | null> {
    const approval = this.callbacks().approval;
    // A missing callback is answered rather than left open, which is what the
    // legacy runtime did: a prompt nobody can see would hang the turn.
    if (!approval) {
      return declined(request);
    }
    try {
      const decision = await approval(
        presentation.toolName,
        { ...presentation.input },
        presentation.description,
        {
          decisionOptions: presentation.options.map(toDecisionOption),
          ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
          ...(presentation.blockedPath ? { blockedPath: presentation.blockedPath } : {}),
          ...(presentation.agentID ? { agentID: presentation.agentID } : {}),
        },
      );
      // A dismissed prompt resolves with nothing, which the surface reports as
      // `cancel` — and cancelling aborts the whole turn. An interaction that
      // ended somewhere else is not the user choosing that, so it says nothing.
      return signal.aborted ? null : toResponseId(decision, request);
    } catch {
      // A surface that could not ask — a detached view, a render that failed —
      // is not an answer, and upstream reads a rejection as a dismissal.
      return declined(request);
    }
  }

  private async presentQuestion(
    request: InteractionRequest,
    presentation: Extract<ClaudeInteractionPresentation, { kind: 'question' }>,
    signal: AbortSignal,
  ): Promise<string | null> {
    const ask = this.callbacks().question;
    if (!ask) {
      return offered(request, 'declined');
    }
    let answers: Record<string, string | string[]> | null;
    try {
      answers = await ask({ ...presentation.input }, signal);
    } catch {
      return offered(request, 'declined');
    }
    if (!answers || signal.aborted) {
      return offered(request, 'declined');
    }
    // Handed over before the id is returned, because the id only says *that* it
    // was answered — the answers themselves never leave the provider.
    this.bridge.submitAnswers(request.presentationRef, { kind: 'answers', answers });
    return offered(request, 'answered');
  }

  private async presentPlanDecision(
    request: InteractionRequest,
    presentation: Extract<ClaudeInteractionPresentation, { kind: 'plan-decision' }>,
    signal: AbortSignal,
  ): Promise<string | null> {
    const decide = this.callbacks().planDecision;
    if (!decide) {
      return offered(request, 'declined');
    }
    let decision;
    try {
      decision = await decide({ ...presentation.input }, signal);
    } catch {
      return offered(request, 'declined');
    }
    if (!decision || signal.aborted) {
      return offered(request, 'declined');
    }
    if (decision.type === 'approve') {
      return offered(request, 'approved');
    }
    // Feedback is text, and text is not a response id: it goes back through the
    // bridge under the same reference the resolution names.
    this.bridge.submitAnswers(request.presentationRef, {
      kind: 'feedback',
      text: decision.text,
    });
    return offered(request, 'feedback');
  }
}

/** The id, where this interaction offers it; nothing where it does not. */
function offered(request: InteractionRequest, responseId: string): string | null {
  return request.responseIds.includes(responseId) ? responseId : null;
}

function toDecisionOption(option: ClaudeApprovalOption): ApprovalDecisionOption {
  const decision = STANDARD_DECISIONS.find(([, id]) => id === option.responseId)?.[0];
  return {
    label: option.label,
    // The kernel's id, so a picked option comes back as an answer the run can
    // record without a second mapping table.
    value: option.responseId,
    ...(decision ? { decision } : {}),
    presentation: option.presentation,
  };
}

function toResponseId(decision: ApprovalDecision, request: InteractionRequest): string | null {
  if (typeof decision === 'object' && decision?.type === 'select-option') {
    return request.responseIds.includes(decision.value) ? decision.value : declined(request);
  }
  const responseId = STANDARD_DECISIONS.find(([known]) => known === decision)?.[1];
  return responseId && request.responseIds.includes(responseId)
    ? responseId
    : declined(request);
}

/**
 * Refusing, in whatever way this interaction can express it.
 *
 * The answer for anything it cannot express. Denying is preferred to cancelling
 * because a denied tool leaves the turn running, and a prompt that can neither
 * be answered nor refused would block the SDK on something no longer on screen.
 */
function declined(request: InteractionRequest): string | null {
  if (request.responseIds.includes('deny')) {
    return 'deny';
  }
  return request.responseIds.includes('declined') ? 'declined' : null;
}
