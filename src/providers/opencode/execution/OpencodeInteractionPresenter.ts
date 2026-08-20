import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import type {
  ExecutionInteractionCallbacks,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ApprovalDecisionOption } from '@/core/runtime/types';
import type { ApprovalDecision } from '@/core/types';
import type {
  OpencodeApprovalOption,
  OpencodeInteractionBridge,
  OpencodeInteractionPresentation,
} from '@/providers/opencode/execution/OpencodeInteractionBridge';

/**
 * The callbacks the chat surface installed, read when an interaction opens.
 *
 * Read late rather than captured: the adapter is constructed before the view
 * installs them, and a tab that has not opened its approval UI yet must still
 * be able to receive one.
 */
export type OpencodeInteractionCallbacks = () => Readonly<ExecutionInteractionCallbacks>;

const CANCEL = 'cancel';

/**
 * The decisions the surface answers with, and the option each one means.
 *
 * ACP names its options by kind, so a decision the surface produces on its own
 * — a keyboard shortcut, a default — is matched to the option that expresses
 * it rather than to a fixed id: an agent that offers only `reject_always` still
 * has to be able to hear "deny".
 */
const PREFERRED_BY_DECISION: Readonly<Record<string, readonly string[]>> = {
  allow: ['allow-once', 'allow-always'],
  'allow-always': ['allow-always', 'allow-once'],
  deny: ['reject-once', 'reject-always'],
};

/**
 * An opened OpenCode interaction, rendered by the surface that already knows
 * how.
 *
 * The chat surface speaks the legacy callback contract — a tool name, an input,
 * a description, a set of decision options — and the kernel speaks response
 * ids. This holds those two vocabularies together so neither has to learn the
 * other's: the options it hands the surface carry the kernel's ids as their
 * values, so what comes back is already an answer the run can record.
 */
export class OpencodeInteractionPresenter {
  /** What is on screen right now, so it can be taken down again. */
  private readonly open = new Map<string, AbortController>();

  constructor(
    private readonly bridge: Pick<OpencodeInteractionBridge, 'presentation'>,
    private readonly callbacks: OpencodeInteractionCallbacks,
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
      return await this.presentApproval(request, presentation, abort.signal);
    } finally {
      this.open.delete(request.presentationRef);
    }
  }

  /**
   * Takes down one prompt, for an interaction that ended somewhere else.
   *
   * A run cancelled mid-approval and a backend disposing with one open both
   * settle without an answer from the user. Subscribe it to the bridge's
   * `onSettled`; without it the surface keeps a dead prompt up with the
   * composer locked behind it.
   */
  dismiss(presentationRef: string): void {
    const abort = this.open.get(presentationRef);
    if (!abort) {
      // Nothing of this interaction is on screen: already answered, or never
      // presented here.
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
    presentation: OpencodeInteractionPresentation,
    signal: AbortSignal,
  ): Promise<string | null> {
    const approval = this.callbacks().approval;
    // A missing callback is answered rather than left open, which is what the
    // legacy runtime did: the agent is blocked on this answer before it does
    // anything at all, so a prompt nobody can see would hang the turn.
    if (!approval) {
      return declined(request, presentation);
    }

    try {
      const decision = await approval(
        presentation.toolName,
        presentation.input,
        presentation.description,
        {
          decisionOptions: presentation.options.map(toDecisionOption),
          ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
          ...(presentation.blockedPath ? { blockedPath: presentation.blockedPath } : {}),
        },
      );
      // A dismissed prompt resolves with nothing, which the surface reports as
      // `cancel` — and cancelling aborts the whole turn. An interaction that
      // ended somewhere else is not the user choosing that, so it says nothing.
      return signal.aborted ? null : toResponseId(decision, request, presentation);
    } catch {
      // A surface that could not ask — a detached view, a render that failed —
      // is not an answer, and upstream reads a rejection as a dismissal and
      // resolves nothing. Declining is what the legacy transport answered with.
      return declined(request, presentation);
    }
  }
}

/**
 * One option, carrying the kernel's id and **no** decision.
 *
 * A `decision` makes the surface answer with that word instead of the option
 * the person picked, and the word is then resolved back to whichever option
 * matches it first — so an agent that offers two allowances of one kind, which
 * OpenCode does for path-scoped ones, has the second one answered as the first.
 * The legacy runtime left `decision` off for exactly this reason.
 */
function toDecisionOption(option: OpencodeApprovalOption): ApprovalDecisionOption {
  return {
    label: option.label,
    // The kernel's id, so a picked option comes back as an answer the run can
    // record without a second mapping table.
    value: option.responseId,
    presentation: option.presentation,
  };
}

function toResponseId(
  decision: ApprovalDecision,
  request: InteractionRequest,
  presentation: OpencodeInteractionPresentation,
): string | null {
  if (typeof decision === 'object') {
    // The surface picked one of the options it was handed, and those carry the
    // kernel's ids as their values.
    return request.responseIds.includes(decision.value)
      ? decision.value
      : declined(request, presentation);
  }
  if (decision === CANCEL) {
    return request.responseIds.includes(CANCEL) ? CANCEL : declined(request, presentation);
  }

  const offered = new Set(presentation.options.map(option => option.responseId));
  const preferred = (PREFERRED_BY_DECISION[decision] ?? [])
    .find(responseId => offered.has(responseId) && request.responseIds.includes(responseId));
  return preferred ?? declined(request, presentation);
}

/**
 * Refusing, in whatever way this interaction can express it.
 *
 * The answer for anything it cannot express, which is what the legacy runtime
 * mapped an unrecognised decision to. Cancelling is the fallback because an
 * agent that offered no refusal still has to be answered — leaving it open
 * blocks the agent on a prompt that is no longer on screen.
 */
function declined(
  request: InteractionRequest,
  presentation: OpencodeInteractionPresentation,
): string | null {
  const rejection = presentation.options
    .find(option => option.presentation === 'reject' && request.responseIds.includes(
      option.responseId,
    ));
  if (rejection) {
    return rejection.responseId;
  }
  return request.responseIds.includes(CANCEL) ? CANCEL : null;
}
