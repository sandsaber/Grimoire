import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import {
  AcpPermissionBridge,
  normalizeApprovalInput,
} from '@/providers/acp/execution/AcpPermissionBridge';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { buildQwenPermissionPresentation } from '@/providers/qwen/execution/QwenPermissionPresentation';

export type {
  AcpApprovalCallbacks as QwenInteractionCallbacks,
} from '@/providers/acp/execution/AcpApprovalPresenter';
export type {
  AcpApprovalOption as QwenApprovalOption,
  AcpPermissionPresentation as QwenInteractionPresentation,
} from '@/providers/acp/execution/AcpPermissionBridge';

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

/**
 * Whether this permission request is really a question for the person.
 *
 * Qwen sends `ask_user_question` down the **permission** channel, marked three
 * different ways depending on the release — a `_meta.qwenInteractionKind`, a
 * `_meta.toolName`, or a title that reads "Ask user N questions" over a
 * `questions` array. All three are what `QwenChatRuntime` already looks for, and
 * this is that predicate moved rather than a new opinion about it.
 *
 * It exists here so the flip can *see* the case it cannot yet carry, rather than
 * treating it as an approval and asking someone to allow or deny a question. See
 * the progress journal: the kernel's `InteractionResolution` carries a response
 * id and nothing else, so a question's structured answers have no way home.
 */
export function isQwenAskUserQuestionRequest(request: AcpRequestPermissionRequest): boolean {
  const rawInput = asRecord(request.toolCall.rawInput);
  const meta = asRecord((request.toolCall as { _meta?: unknown })._meta);
  return meta?.qwenInteractionKind === 'user_question'
    || meta?.toolName === 'ask_user_question'
    || (Array.isArray(rawInput?.questions)
      && /^Ask user \d+ questions?$/i.test(request.toolCall.title ?? ''));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** How an opened Qwen approval reaches the surface. */
export class QwenInteractionPresenter extends AcpApprovalPresenter {}

export { normalizeApprovalInput };
