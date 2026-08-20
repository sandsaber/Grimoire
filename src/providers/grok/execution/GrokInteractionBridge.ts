import {
  AcpPermissionBridge,
  normalizeApprovalInput,
} from '@/providers/acp/execution/AcpPermissionBridge';
import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import { buildGrokPermissionPresentation } from '@/providers/grok/execution/GrokPermissionPresentation';

export type {
  AcpApprovalOption as GrokApprovalOption,
  AcpPermissionPresentation as GrokInteractionPresentation,
} from '@/providers/acp/execution/AcpPermissionBridge';
export type {
  AcpApprovalCallbacks as GrokInteractionCallbacks,
} from '@/providers/acp/execution/AcpApprovalPresenter';

/**
 * Grok's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared with every managed-ACP provider; what is Grok's is the
 * sentence a person reads, which its own vocabulary writes from the tool *and*
 * the kind that raised the request — a distinction OpenCode does not make.
 */
export class GrokInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildGrokPermissionPresentation(
        request.toolCall.title,
        request.toolCall.kind,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}

/** How an opened Grok approval reaches the surface. */
export class GrokInteractionPresenter extends AcpApprovalPresenter {}

export { normalizeApprovalInput };
