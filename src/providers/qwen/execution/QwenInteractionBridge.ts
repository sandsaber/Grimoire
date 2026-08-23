import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import {
  AcpPermissionBridge,
  normalizeApprovalInput,
} from '@/providers/acp/execution/AcpPermissionBridge';
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

/** How an opened Qwen approval reaches the surface. */
export class QwenInteractionPresenter extends AcpApprovalPresenter {}

export { normalizeApprovalInput };
