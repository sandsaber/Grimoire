import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import {
  buildMimocodePermissionPresentation,
} from '@/providers/mimocode/execution/MimocodePermissionPresentation';


/**
 * MiMoCode's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared; what is MiMoCode's is the sentence a person reads,
 * which its own vocabulary writes from the tool that raised the request.
 */
export class MimocodeInteractionBridge extends AcpPermissionBridge {
  constructor(nextPresentationRef?: () => string) {
    super(
      (request, input) => buildMimocodePermissionPresentation(
        request.toolCall.title,
        input,
        request.toolCall.locations,
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}
