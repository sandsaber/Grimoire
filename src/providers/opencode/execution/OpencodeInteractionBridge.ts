import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import { buildOpencodePermissionPresentation } from '@/providers/opencode/execution/OpencodePermissionPresentation';

export type {
  AcpApprovalOption as OpencodeApprovalOption,
  AcpApprovalOptionPresentation as OpencodeApprovalOptionPresentation,
  AcpPermissionPresentation as OpencodeInteractionPresentation,
} from '@/providers/acp/execution/AcpPermissionBridge';

/**
 * OpenCode's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared; what is OpenCode's is the sentence a person reads,
 * which its own vocabulary writes from the tool that raised the request.
 */
export class OpencodeInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildOpencodePermissionPresentation(
        request.toolCall.title,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}
