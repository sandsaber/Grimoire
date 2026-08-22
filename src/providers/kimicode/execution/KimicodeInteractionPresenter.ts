import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';

export type {
  AcpApprovalCallbacks as KimicodeInteractionCallbacks,
} from '@/providers/acp/execution/AcpApprovalPresenter';

/**
 * How an opened Kimi Code approval reaches the surface.
 *
 * The shared presenter under this provider's name, which is what its own
 * modules and tests call it.
 */
export class KimicodeInteractionPresenter extends AcpApprovalPresenter {}
