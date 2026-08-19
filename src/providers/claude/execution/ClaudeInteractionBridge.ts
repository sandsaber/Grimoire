import type {
  PermissionMode as SDKPermissionMode,
  PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';

import { getActionDescription } from '../../../core/security/ApprovalManager';
import { isTrustedReadOnlyMcpTool } from '../../../core/tools/mcpTrust';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_EXIT_PLAN_MODE,
  TOOL_SKILL,
} from '../../../core/tools/toolNames';
import type { PermissionMode } from '../../../core/types/settings';
import { buildPermissionUpdates } from '../security/ClaudePermissionUpdates';
import type {
  ClaudeInteractionBridge as ClaudeInteractionBridgeContract,
  ClaudePreparedInteraction,
  ClaudeResolvedPermission,
  ClaudeToolPermissionOptions,
} from './ClaudeExecutionBackend';

/** How the surface should weight an option; the approval UI's own vocabulary. */
export type ClaudeApprovalOptionPresentation = 'allow' | 'always' | 'reject';

export interface ClaudeApprovalOption {
  readonly responseId: string;
  readonly label: string;
  readonly presentation: ClaudeApprovalOptionPresentation;
}

/**
 * Everything the surface needs to render one request, and nothing the kernel
 * needs to know. Held here because a control record carries an opaque reference
 * to a presentation, never the presentation itself.
 */
export type ClaudeInteractionPresentation =
  | {
    readonly kind: 'approval';
    readonly toolName: string;
    readonly description: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly options: readonly ClaudeApprovalOption[];
    readonly decisionReason?: string;
    readonly blockedPath?: string;
    readonly agentID?: string;
  }
  | {
    readonly kind: 'question';
    readonly toolName: string;
    readonly input: Readonly<Record<string, unknown>>;
  }
  | {
    readonly kind: 'plan-decision';
    readonly toolName: string;
    readonly input: Readonly<Record<string, unknown>>;
  };

export interface ClaudeInteractionBridgePorts {
  /** The mode this provider was given, in Grimoire's own vocabulary. */
  readonly permissionMode: () => PermissionMode;
  /** How that mode is expressed to the SDK, which is what an approved plan sets. */
  readonly resolveSdkPermissionMode: (mode: PermissionMode) => SDKPermissionMode;
  /** Tells the surface the mode a plan approval just put the session in. */
  readonly syncPermissionMode?: (mode: PermissionMode, sdkMode: SDKPermissionMode) => void;
}

/** What a question was answered with, or the feedback a plan was refused with. */
export type ClaudeCollectedAnswers =
  | { readonly kind: 'answers'; readonly answers: unknown }
  | { readonly kind: 'feedback'; readonly text: string };

const ALLOW_ONCE = 'allow-once';
const ALLOW_ALWAYS = 'allow-always';
const DENY = 'deny';
const CANCELLED = 'cancelled';
const ANSWERED = 'answered';
const DECLINED = 'declined';
const APPROVED = 'approved';
const FEEDBACK = 'feedback';

/**
 * Claude's tool permission requests, as interactions the kernel can carry.
 *
 * The kernel's model is "choose one of these response ids", and it accepts only
 * constrained identifiers. Two of Claude's answers are not: a question is
 * answered with structured selections, and a refused plan carries the words the
 * user refused it with. So the id stands for the answer and the answer itself
 * stays here — which is why the presenter hands what it collected back through
 * this bridge rather than through the resolution.
 *
 * The three kinds are the legacy handler's three branches, kept: `ExitPlanMode`
 * is a plan decision, `AskUserQuestion` is a question, everything else is an
 * approval. `EnterPlanMode` is absent because the SDK approves it itself and it
 * never reaches a permission callback at all.
 */
export class ClaudeInteractionBridge implements ClaudeInteractionBridgeContract {
  private readonly presentations = new Map<string, ClaudeInteractionPresentation>();
  private readonly collected = new Map<string, ClaudeCollectedAnswers>();
  private readonly settledListeners = new Set<(presentationRef: string) => void>();
  private minted = 0;

  constructor(
    private readonly ports: ClaudeInteractionBridgePorts,
    private readonly nextPresentationRef: () => string = () => `claudeix-${++this.minted}`,
  ) {}

  async prepare(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly options: ClaudeToolPermissionOptions;
    readonly allowedTools?: readonly string[];
  }): Promise<ClaudePreparedInteraction | ClaudeResolvedPermission> {
    const outsideAllowList = this.refuseOutsideAllowList(input.toolName, input.allowedTools);
    if (outsideAllowList) {
      return outsideAllowList;
    }
    if (input.toolName === TOOL_EXIT_PLAN_MODE) {
      return this.preparePlanDecision(input.toolName, input.toolInput);
    }
    if (input.toolName === TOOL_ASK_USER_QUESTION) {
      return this.prepareQuestion(input.toolName, input.toolInput);
    }
    if (this.ports.permissionMode() === 'normal' && isTrustedReadOnlyMcpTool(input.toolName)) {
      // Read-only and trusted: the legacy runtime allowed these without asking,
      // and asking now would be a new prompt for behaviour that has not changed.
      return { kind: 'resolved', result: { behavior: 'allow', updatedInput: { ...input.toolInput } } };
    }
    return this.prepareApproval(input.toolName, input.toolInput, input.options);
  }

  /** What the surface renders, by the reference the interaction carries. */
  presentation(presentationRef: string): ClaudeInteractionPresentation | undefined {
    return this.presentations.get(presentationRef);
  }

  /**
   * What the presenter collected, before it resolves the interaction.
   *
   * Answers and plan feedback cannot travel as a response id — one is a
   * structure, the other is free text — so they are left here under the same
   * reference the resolution names.
   */
  submitAnswers(presentationRef: string, collected: ClaudeCollectedAnswers): void {
    this.collected.set(presentationRef, collected);
  }

  /**
   * Says that an interaction is over, whoever ended it.
   *
   * The ending the surface cannot see is the one that matters: a run cancelled
   * while its prompt is up. Without this the prompt stays on screen with the
   * composer locked behind it.
   */
  onSettled(listener: (presentationRef: string) => void): () => void {
    this.settledListeners.add(listener);
    return () => this.settledListeners.delete(listener);
  }

  private refuseOutsideAllowList(
    toolName: string,
    allowedTools: readonly string[] | undefined,
  ): ClaudeResolvedPermission | undefined {
    if (!allowedTools || allowedTools.includes(toolName) || toolName === TOOL_SKILL) {
      return undefined;
    }
    // A query started with an allow-list refuses everything outside it, and no
    // answer a user could give would change that — so nobody is asked.
    const allowedList = allowedTools.length > 0
      ? ` Allowed tools: ${allowedTools.join(', ')}.`
      : ' No tools are allowed for this query type.';
    return {
      kind: 'resolved',
      result: {
        behavior: 'deny',
        message: `Tool "${toolName}" is not allowed for this query.${allowedList}`,
      },
    };
  }

  private prepareApproval(
    toolName: string,
    toolInput: Readonly<Record<string, unknown>>,
    options: ClaudeToolPermissionOptions,
  ): ClaudePreparedInteraction {
    const presentationRef = this.remember(this.nextPresentationRef(), {
      kind: 'approval',
      toolName,
      description: getActionDescription(toolName, { ...toolInput }),
      input: toolInput,
      options: [
        { responseId: ALLOW_ONCE, label: 'Allow once', presentation: 'allow' },
        { responseId: ALLOW_ALWAYS, label: 'Always allow', presentation: 'always' },
        { responseId: DENY, label: 'Deny', presentation: 'reject' },
      ],
      ...(options.decisionReason ? { decisionReason: options.decisionReason } : {}),
      ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
      ...(options.agentID ? { agentID: options.agentID } : {}),
    });
    const suggestions = readSuggestions(options.suggestions);
    return {
      kind: 'approval',
      presentationRef,
      responseIds: [ALLOW_ONCE, ALLOW_ALWAYS, DENY],
      providerResolvedResponseId: CANCELLED,
      resolve: async responseId => {
        this.forget(presentationRef);
        if (responseId === ALLOW_ONCE || responseId === ALLOW_ALWAYS) {
          return {
            behavior: 'allow',
            updatedInput: { ...toolInput },
            updatedPermissions: buildPermissionUpdates(
              toolName,
              { ...toolInput },
              responseId === ALLOW_ALWAYS ? 'allow-always' : 'allow',
              suggestions,
            ),
          };
        }
        if (responseId === CANCELLED) {
          return { behavior: 'deny', message: 'User interrupted.', interrupt: true };
        }
        // An id this interaction never offered means a defect upstream, and
        // denying is both what the legacy runtime answered and the safe way to
        // be wrong.
        return { behavior: 'deny', message: 'User denied this action.', interrupt: false };
      },
      cancel: async () => {
        this.forget(presentationRef);
        return { behavior: 'deny', message: 'User interrupted.', interrupt: true };
      },
    };
  }

  private prepareQuestion(
    toolName: string,
    toolInput: Readonly<Record<string, unknown>>,
  ): ClaudePreparedInteraction {
    // The SDK's own documentation says "Other will be provided automatically",
    // and the SDK does not inject it: Grimoire renders this prompt itself, so it
    // has to match what the Claude CLI would have shown.
    const input = withOtherOption(toolInput);
    const presentationRef = this.remember(this.nextPresentationRef(), {
      kind: 'question',
      toolName,
      input,
    });
    return {
      kind: 'question',
      presentationRef,
      responseIds: [ANSWERED, DECLINED],
      providerResolvedResponseId: DECLINED,
      resolve: async responseId => {
        const collected = this.collected.get(presentationRef);
        this.forget(presentationRef);
        if (responseId !== ANSWERED || collected?.kind !== 'answers') {
          return { behavior: 'deny', message: 'User declined to answer.', interrupt: true };
        }
        return { behavior: 'allow', updatedInput: { ...input, answers: collected.answers } };
      },
      cancel: async () => {
        this.forget(presentationRef);
        return { behavior: 'deny', message: 'User declined to answer.', interrupt: true };
      },
    };
  }

  private preparePlanDecision(
    toolName: string,
    toolInput: Readonly<Record<string, unknown>>,
  ): ClaudePreparedInteraction {
    const presentationRef = this.remember(this.nextPresentationRef(), {
      kind: 'plan-decision',
      toolName,
      input: toolInput,
    });
    return {
      kind: 'plan-decision',
      presentationRef,
      responseIds: [APPROVED, FEEDBACK, DECLINED],
      providerResolvedResponseId: DECLINED,
      resolve: async responseId => {
        const collected = this.collected.get(presentationRef);
        this.forget(presentationRef);
        if (responseId === APPROVED) {
          const mode = this.ports.permissionMode();
          const sdkMode = this.ports.resolveSdkPermissionMode(mode);
          // The mode the session leaves planning in, told to the surface as
          // well as to the SDK: the toolbar would otherwise still show the mode
          // the turn started in.
          this.ports.syncPermissionMode?.(mode, sdkMode);
          return {
            behavior: 'allow',
            updatedInput: { ...toolInput },
            updatedPermissions: [{ type: 'setMode', mode: sdkMode, destination: 'session' }],
          };
        }
        if (responseId === FEEDBACK && collected?.kind === 'feedback') {
          // Not an interruption: the model is being told what to change, and
          // the turn goes on.
          return { behavior: 'deny', message: collected.text, interrupt: false };
        }
        return { behavior: 'deny', message: 'User cancelled.', interrupt: true };
      },
      cancel: async () => {
        this.forget(presentationRef);
        return { behavior: 'deny', message: 'User cancelled.', interrupt: true };
      },
    };
  }

  private remember(presentationRef: string, presentation: ClaudeInteractionPresentation): string {
    this.presentations.set(presentationRef, presentation);
    return presentationRef;
  }

  private forget(presentationRef: string): void {
    this.presentations.delete(presentationRef);
    this.collected.delete(presentationRef);
    for (const listener of this.settledListeners) {
      listener(presentationRef);
    }
  }
}

function withOtherOption(
  toolInput: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const input = { ...toolInput };
  const questions: unknown = input.questions;
  if (!Array.isArray(questions)) {
    return input;
  }
  input.questions = (questions as readonly unknown[]).map(question => (
    question && typeof question === 'object' && !('isOther' in question)
      ? { ...question, isOther: true }
      : question
  ));
  return input;
}

/**
 * The SDK's own suggested permission rules, carried through untouched.
 *
 * They reach us as `unknown` because the kernel's option type does not model
 * the SDK's, and `buildPermissionUpdates` is the code that reads them — the
 * same code the legacy runtime handed them to.
 */
function readSuggestions(
  suggestions: readonly unknown[] | undefined,
): PermissionUpdate[] | undefined {
  return suggestions ? ([...suggestions] as PermissionUpdate[]) : undefined;
}
