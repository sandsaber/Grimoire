import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import {
  AcpPermissionBridge,
  normalizeApprovalInput,
} from '@/providers/acp/execution/AcpPermissionBridge';
import { buildGeminiPermissionPresentation } from '@/providers/gemini/execution/GeminiPermissionPresentation';

export type {
  AcpApprovalCallbacks as GeminiInteractionCallbacks,
} from '@/providers/acp/execution/AcpApprovalPresenter';
export type {
  AcpApprovalOption as GeminiApprovalOption,
  AcpPermissionPresentation as GeminiInteractionPresentation,
} from '@/providers/acp/execution/AcpPermissionBridge';

/**
 * Gemini's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared with every managed-ACP provider; what is Gemini's is the
 * sentence a person reads, which names whatever tool the title carries rather
 * than switching on a vocabulary of ids this provider has never been observed
 * to send.
 */
export class GeminiInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildGeminiPermissionPresentation(
        request.toolCall.title,
        request.toolCall.kind,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}

/** How an opened Gemini approval reaches the surface. */
export class GeminiInteractionPresenter extends AcpApprovalPresenter {}

export { normalizeApprovalInput };
