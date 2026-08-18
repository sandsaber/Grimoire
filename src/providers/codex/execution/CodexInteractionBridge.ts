import { normalizeCodexToolName } from '../normalization/codexToolNormalization';
import type {
  CommandApprovalRequest,
  CommandExecutionApprovalDecision,
  FileChangeApprovalRequest,
  PermissionsApprovalRequest,
  UserInputQuestion,
  UserInputRequest,
} from '../runtime/codexAppServerTypes';
import type {
  CodexInteractionBridge as CodexInteractionBridgeContract,
  CodexPreparedInteraction,
} from './CodexExecutionBackend';

/** How the surface should weight an option; the legacy approval UI's own vocabulary. */
export type CodexApprovalOptionPresentation = 'allow' | 'always' | 'reject' | 'other';

export interface CodexApprovalOption {
  readonly responseId: string;
  readonly label: string;
  readonly description?: string;
  readonly presentation: CodexApprovalOptionPresentation;
}

/**
 * Everything the surface needs to render one request, and nothing the kernel
 * needs to know. Held here because a control record carries an opaque reference
 * to a presentation, never the presentation itself.
 */
export type CodexInteractionPresentation =
  | {
    readonly kind: 'approval';
    readonly method: string;
    readonly toolName: string;
    readonly description: string;
    readonly input: Record<string, unknown>;
    readonly options: readonly CodexApprovalOption[];
    readonly decisionReason?: string;
    readonly networkApprovalContext?: { readonly host: string; readonly protocol: string };
    readonly additionalPermissions?: unknown;
  }
  | {
    readonly kind: 'question';
    readonly method: string;
    readonly questions: readonly UserInputQuestion[];
  };

export type CodexCollectedAnswers = Record<string, string | string[]>;

const PROVIDER_RESOLVED = 'provider-resolved';
const ANSWERED = 'answered';
const DISMISSED = 'dismissed';

/**
 * Codex's four server requests, as interactions the kernel can carry.
 *
 * The kernel's model is "choose one of these response ids", and it accepts only
 * constrained identifiers. Two of Codex's answers are not: a command decision
 * can be a policy-amendment object, and a question is answered with free text.
 * So the id stands for the answer and the answer itself stays here — which is
 * also why the presenter hands its collected answers back through this bridge
 * rather than through the resolution.
 */
export class CodexInteractionBridge implements CodexInteractionBridgeContract {
  private readonly presentations = new Map<string, CodexInteractionPresentation>();
  private readonly answers = new Map<string, CodexCollectedAnswers>();
  private minted = 0;

  constructor(private readonly nextPresentationRef: () => string = () => `codexix-${++this.minted}`) {}

  async prepare(input: {
    readonly method: string;
    readonly params: unknown;
  }): Promise<CodexPreparedInteraction> {
    switch (input.method) {
      case 'item/commandExecution/requestApproval':
        return this.prepareCommandApproval(input.params as CommandApprovalRequest);
      case 'item/fileChange/requestApproval':
        return this.prepareFileChangeApproval(input.params as FileChangeApprovalRequest);
      case 'item/permissions/requestApproval':
        return this.preparePermissionsApproval(input.params as PermissionsApprovalRequest);
      case 'item/tool/requestUserInput':
        return this.prepareUserInput(input.params as UserInputRequest);
      default:
        // Answering one of these the wrong way is worse than failing to answer:
        // the daemon acts on whatever comes back.
        throw new Error(`Unsupported server request: ${input.method}`);
    }
  }

  /** What the surface renders, by the reference the interaction carries. */
  presentation(presentationRef: string): CodexInteractionPresentation | undefined {
    return this.presentations.get(presentationRef);
  }

  /** What the presenter collected, before it resolves the question as answered. */
  submitAnswers(presentationRef: string, answers: CodexCollectedAnswers): void {
    this.answers.set(presentationRef, answers);
  }

  private prepareCommandApproval(params: CommandApprovalRequest): CodexPreparedInteraction {
    const decisions = params.availableDecisions
      ?? ['accept', 'acceptForSession', 'decline'];
    const options: CodexApprovalOption[] = [];
    const byResponseId = new Map<string, CommandExecutionApprovalDecision>();
    let amendments = 0;

    for (const decision of decisions) {
      const option = describeCommandDecision(decision, params, () => `amendment-${++amendments}`);
      options.push(option);
      byResponseId.set(option.responseId, decision);
    }

    const presentationRef = this.remember({
      kind: 'approval',
      method: 'item/commandExecution/requestApproval',
      toolName: normalizeCodexToolName('command_execution'),
      description: describeCommandApproval(params),
      input: {
        command: params.command ?? '',
        cwd: params.cwd ?? null,
        reason: params.reason ?? null,
        commandActions: params.commandActions ?? null,
        approvalId: params.approvalId ?? null,
        networkApprovalContext: params.networkApprovalContext ?? null,
        additionalPermissions: params.additionalPermissions ?? null,
        skillMetadata: params.skillMetadata ?? null,
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
        proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments ?? null,
      },
      options,
      ...(params.reason ? { decisionReason: params.reason } : {}),
      ...(params.networkApprovalContext
        ? { networkApprovalContext: params.networkApprovalContext }
        : {}),
      ...(params.additionalPermissions
        ? { additionalPermissions: params.additionalPermissions }
        : {}),
    });

    return {
      presentationRef,
      responseIds: [...options.map(option => option.responseId), PROVIDER_RESOLVED],
      providerResolvedResponseId: PROVIDER_RESOLVED,
      // An id this interaction never offered means a defect upstream, and
      // declining is both what the legacy runtime answered and the safe way to
      // be wrong.
      resolve: async responseId => ({ decision: byResponseId.get(responseId) ?? 'decline' }),
      cancel: async () => ({ decision: 'decline' }),
    };
  }

  private prepareFileChangeApproval(params: FileChangeApprovalRequest): CodexPreparedInteraction {
    const reason = params.reason ?? undefined;
    const options: CodexApprovalOption[] = [
      { responseId: 'allow-once', label: 'Allow once', presentation: 'allow' },
      { responseId: 'allow-always', label: 'Always allow', presentation: 'always' },
      { responseId: 'deny', label: 'Deny', presentation: 'reject' },
    ];
    const decisions: Record<string, 'accept' | 'acceptForSession' | 'decline'> = {
      'allow-once': 'accept',
      'allow-always': 'acceptForSession',
      deny: 'decline',
    };

    const presentationRef = this.remember({
      kind: 'approval',
      method: 'item/fileChange/requestApproval',
      toolName: normalizeCodexToolName('file_change'),
      description: reason ? `File change: ${reason}` : 'File change',
      input: { reason: reason ?? null },
      options,
    });

    return {
      presentationRef,
      responseIds: [...options.map(option => option.responseId), PROVIDER_RESOLVED],
      providerResolvedResponseId: PROVIDER_RESOLVED,
      resolve: async responseId => ({ decision: decisions[responseId] ?? 'decline' }),
      cancel: async () => ({ decision: 'decline' }),
    };
  }

  private preparePermissionsApproval(params: PermissionsApprovalRequest): CodexPreparedInteraction {
    const requested = (params.permissions ?? {}) as Record<string, unknown>;
    const reason = params.reason ?? undefined;
    const options: CodexApprovalOption[] = [
      { responseId: 'allow-once', label: 'Allow once', presentation: 'allow' },
      { responseId: 'allow-always', label: 'Always allow', presentation: 'always' },
      { responseId: 'deny', label: 'Deny', presentation: 'reject' },
    ];

    const presentationRef = this.remember({
      kind: 'approval',
      method: 'item/permissions/requestApproval',
      toolName: 'permissions',
      description: reason ? `Permission request: ${reason}` : 'Permission request',
      input: requested,
      options,
    });

    // Nothing is granted unless the answer says so, and how long it lasts is
    // part of the answer rather than a default the provider picks.
    const declined = { permissions: {}, scope: 'turn' as const };
    return {
      presentationRef,
      responseIds: [...options.map(option => option.responseId), PROVIDER_RESOLVED],
      providerResolvedResponseId: PROVIDER_RESOLVED,
      resolve: async responseId => {
        if (responseId === 'allow-once') {
          return { permissions: requested, scope: 'turn' };
        }
        if (responseId === 'allow-always') {
          return { permissions: requested, scope: 'session' };
        }
        return declined;
      },
      cancel: async () => declined,
    };
  }

  private prepareUserInput(params: UserInputRequest): CodexPreparedInteraction {
    const presentationRef = this.remember({
      kind: 'question',
      method: 'item/tool/requestUserInput',
      questions: params.questions ?? [],
    });

    const nothing = { answers: {} };
    return {
      presentationRef,
      responseIds: [ANSWERED, DISMISSED, PROVIDER_RESOLVED],
      providerResolvedResponseId: PROVIDER_RESOLVED,
      resolve: async responseId => {
        const collected = responseId === ANSWERED
          ? this.answers.get(presentationRef)
          : undefined;
        if (!collected) {
          // Dismissed, or answered without anything collected. Not the same as
          // a wrong answer: Codex reads an empty set as "the user said nothing".
          return nothing;
        }
        this.answers.delete(presentationRef);
        return { answers: toCodexAnswers(collected) };
      },
      cancel: async () => {
        this.answers.delete(presentationRef);
        return nothing;
      },
    };
  }

  private remember(presentation: CodexInteractionPresentation): string {
    const presentationRef = this.nextPresentationRef();
    this.presentations.set(presentationRef, presentation);
    return presentationRef;
  }
}

function describeCommandApproval(params: CommandApprovalRequest): string {
  const networkContext = params.networkApprovalContext;
  if (networkContext) {
    return `Allow ${networkContext.protocol} access to ${networkContext.host}`;
  }

  const command = params.command ?? '';
  return command ? `Execute: ${command}` : 'Execute command';
}

function describeCommandDecision(
  decision: CommandExecutionApprovalDecision,
  params: CommandApprovalRequest,
  nextAmendmentId: () => string,
): CodexApprovalOption {
  if (decision === 'accept') {
    return { responseId: 'allow-once', label: 'Allow once', presentation: 'allow' };
  }
  if (decision === 'acceptForSession') {
    return { responseId: 'allow-always', label: 'Always allow', presentation: 'always' };
  }
  if (decision === 'decline') {
    return { responseId: 'deny', label: 'Deny', presentation: 'reject' };
  }
  if (decision === 'cancel') {
    return { responseId: 'cancel', label: 'Cancel', presentation: 'reject' };
  }
  if ('acceptWithExecpolicyAmendment' in decision) {
    return {
      responseId: nextAmendmentId(),
      label: 'Allow similar commands',
      description: 'Approve and store an exec policy amendment.',
      presentation: 'other',
    };
  }

  const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
  const host = amendment.host || params.networkApprovalContext?.host || 'host';
  const action = amendment.action === 'deny' ? 'Deny' : 'Allow';
  return {
    responseId: nextAmendmentId(),
    label: `${action} ${host} for this session`,
    description: `Apply a ${amendment.action} rule for ${host}.`,
    presentation: 'other',
  };
}

function toCodexAnswers(
  collected: CodexCollectedAnswers,
): Record<string, { answers: string[] }> {
  const answers: Record<string, { answers: string[] }> = {};
  for (const [question, value] of Object.entries(collected)) {
    answers[question] = { answers: normalizeAnswers(value) };
  }
  return answers;
}

function normalizeAnswers(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item : String(item)))
      .filter(item => item.trim().length > 0);
  }

  return [value];
}
