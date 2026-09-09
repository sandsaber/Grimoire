import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';
import { AcpPermissionBridge } from '@/providers/acp/execution/AcpPermissionBridge';
import {
  buildDevinPermissionPresentation,
  type DevinToolCallRecord,
} from '@/providers/devin/execution/DevinPermissionPresentation';

/**
 * Devin's permission requests, as interactions the kernel can carry.
 *
 * The bridge is shared with every managed-ACP provider; what is Devin's is the
 * sentence a person reads. A request names its tool call by id and little
 * else, so the sentence is built from the `tool_call` update that preceded it —
 * looked up through the port the composition keeps, because the bridge is one
 * for every tab and the updates arrive on each tab's content channel.
 *
 * One interaction kind only. Devin has not been observed asking a question over
 * the permission channel the way Qwen does, so nothing here opens one.
 */
export class DevinInteractionBridge extends AcpPermissionBridge {
  constructor(
    nextPresentationRef?: () => string,
    lookupToolCall: (toolCallId: string) => DevinToolCallRecord | undefined = () => undefined,
  ) {
    super(
      (request, input) => buildDevinPermissionPresentation(
        request.toolCall.title,
        request.toolCall.kind,
        input,
        request.toolCall.locations,
        request.toolCall._meta,
        lookupToolCall(request.toolCall.toolCallId),
      ),
      ...(nextPresentationRef ? [nextPresentationRef] as const : [] as const),
    );
  }
}

/** How an opened Devin approval reaches the surface. */
export class DevinInteractionPresenter extends AcpApprovalPresenter {}
