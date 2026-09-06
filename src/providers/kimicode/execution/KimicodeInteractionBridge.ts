import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import {
  buildKimicodePermissionPresentation,
} from '@/providers/kimicode/execution/KimicodePermissionPresentation';


/**
 * Kimi Code's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared; what is Kimi Code's is the sentence a person reads,
 * which its own vocabulary writes from the tool that raised the request.
 */
export class KimicodeInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildKimicodePermissionPresentation(
        request.toolCall.title,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}
