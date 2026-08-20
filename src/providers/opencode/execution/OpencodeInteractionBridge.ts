import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import type {
  AcpPermissionOption,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from '@/providers/acp/types';
import type {
  OpencodeInteractionBridge as OpencodeInteractionBridgeContract,
  OpencodePreparedInteraction,
} from '@/providers/opencode/execution/OpencodeExecutionBackend';
import {
  buildOpencodePermissionPresentation,
  normalizeApprovalInput,
} from '@/providers/opencode/execution/OpencodePermissionPresentation';

/** How the surface should weight an option; the approval UI's own vocabulary. */
export type OpencodeApprovalOptionPresentation = 'allow' | 'always' | 'reject';

export interface OpencodeApprovalOption {
  readonly responseId: string;
  readonly label: string;
  readonly presentation: OpencodeApprovalOptionPresentation;
}

/**
 * Everything the surface needs to render one request, and nothing the kernel
 * needs to know. Held here because a control record carries an opaque reference
 * to a presentation, never the presentation itself.
 */
export interface OpencodeInteractionPresentation {
  readonly kind: 'approval';
  readonly toolName: string;
  readonly description: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly options: readonly OpencodeApprovalOption[];
  readonly decisionReason?: string;
  readonly blockedPath?: string;
}

const PROVIDER_RESOLVED = 'provider-resolved';
const CANCEL = 'cancel';
const CANCELLED: AcpRequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/** The id a kernel record carries for each kind of option ACP defines. */
const RESPONSE_ID_BY_KIND: Readonly<Record<AcpPermissionOption['kind'], string>> = {
  allow_once: 'allow-once',
  allow_always: 'allow-always',
  reject_once: 'reject-once',
  reject_always: 'reject-always',
};

/**
 * OpenCode's permission requests, as interactions the kernel can carry.
 *
 * ACP has one request — `session/request_permission` — so there is one kind
 * here, and the legacy runtime rendered every one of them through the approval
 * callback, questions and plan-mode switches included. Preserved rather than
 * split: what a permission is *about* is already said by the presentation, and
 * an interaction promoted to a question would be answered by a UI the agent's
 * options do not fit.
 *
 * The ids are minted rather than passed through. The agent picks its own
 * `optionId` — an arbitrary string — and a control record accepts only
 * constrained, unique identifiers, so an option named `opt one!` would make the
 * whole record unwritable and two options of one kind would collide. Each id
 * maps back to exactly one of the agent's options, which is what the answer is
 * finally expressed in.
 */
export class OpencodeInteractionBridge implements OpencodeInteractionBridgeContract {
  private readonly presentations = new Map<string, OpencodeInteractionPresentation>();
  private readonly settledListeners = new Set<(presentationRef: string) => void>();
  private minted = 0;

  constructor(
    private readonly nextPresentationRef: () => string = () => `ocix-${++this.minted}`,
  ) {}

  /** What one open interaction is asking, for the surface that renders it. */
  presentation(presentationRef: string): OpencodeInteractionPresentation | undefined {
    return this.presentations.get(presentationRef);
  }

  /**
   * Says that an interaction is over, whoever ended it.
   *
   * The two endings the surface cannot see are exactly the two that reach
   * `cancel`: a run cancelled while its prompt is up, and a backend disposing
   * with one open. Without this the surface keeps a dead prompt on screen with
   * the composer locked behind it.
   */
  onSettled(listener: (presentationRef: string) => void): () => void {
    this.settledListeners.add(listener);
    return () => this.settledListeners.delete(listener);
  }

  async prepare(request: AcpRequestPermissionRequest): Promise<OpencodePreparedInteraction> {
    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const described = buildOpencodePermissionPresentation(
      request.toolCall.title,
      input,
      request.toolCall.locations,
    );
    const offered = this.mintOptions(request.options);
    const presentationRef = this.nextPresentationRef();
    this.presentations.set(presentationRef, {
      kind: 'approval',
      toolName: described.toolName,
      description: described.description,
      input,
      options: offered.map(({ option }) => option),
      ...(described.decisionReason ? { decisionReason: described.decisionReason } : {}),
      ...(described.blockedPath ? { blockedPath: described.blockedPath } : {}),
    });

    const kind: InteractionRequest['kind'] = 'approval';
    return {
      kind,
      presentationRef,
      responseIds: [
        ...offered.map(({ option }) => option.responseId),
        CANCEL,
        PROVIDER_RESOLVED,
      ],
      providerResolvedResponseId: PROVIDER_RESOLVED,
      resolve: async responseId => {
        this.forget(presentationRef);
        if (responseId === CANCEL || responseId === PROVIDER_RESOLVED) {
          // Dismissing a prompt is not choosing anything, and ACP has a word
          // for that; answering it as a refusal would tell the agent the user
          // decided when they did not.
          return CANCELLED;
        }
        const chosen = offered.find(({ option }) => option.responseId === responseId);
        // An id this interaction never offered is a defect upstream, and the
        // safe way to be wrong is the refusal the agent itself offered.
        return chosen
          ? selected(chosen.optionId)
          : refusal(offered);
      },
      cancel: async () => {
        this.forget(presentationRef);
        return CANCELLED;
      },
    };
  }

  /**
   * One kernel id per offered option, unique within the request.
   *
   * Named by ACP's own option kinds so a control record reads as what was
   * chosen rather than as a position, and suffixed only where an agent offers
   * two of a kind — which OpenCode does for path-scoped allowances.
   */
  private mintOptions(
    options: readonly AcpPermissionOption[],
  ): ReadonlyArray<{ readonly option: OpencodeApprovalOption; readonly optionId: string }> {
    const used = new Map<string, number>();
    return options.map(option => {
      const base = RESPONSE_ID_BY_KIND[option.kind] ?? 'option';
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      return {
        optionId: option.optionId,
        option: {
          responseId: seen === 1 ? base : `${base}-${seen}`,
          label: option.name,
          presentation: presentationFor(option.kind),
        },
      };
    });
  }

  /**
   * Drops what an interaction was about, once it is over.
   *
   * A presentation carries the command line, the path, and whatever else the
   * tool was called with. None of it outlives the request it described.
   */
  private forget(presentationRef: string): void {
    this.presentations.delete(presentationRef);
    for (const listener of this.settledListeners) {
      listener(presentationRef);
    }
  }
}

function presentationFor(
  kind: AcpPermissionOption['kind'],
): OpencodeApprovalOptionPresentation {
  if (kind === 'allow_once') {
    return 'allow';
  }
  return kind === 'allow_always' ? 'always' : 'reject';
}

function selected(optionId: string): AcpRequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } };
}

/** The refusal the agent offered, or nothing chosen at all where it offered none. */
function refusal(
  offered: ReadonlyArray<{ readonly option: OpencodeApprovalOption; readonly optionId: string }>,
): AcpRequestPermissionResponse {
  const rejection = offered.find(({ option }) => option.presentation === 'reject');
  return rejection ? selected(rejection.optionId) : CANCELLED;
}
