import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';

export type {
  AcpApprovalCallbacks as OpencodeInteractionCallbacks,
} from '@/providers/acp/execution/AcpApprovalPresenter';

/**
 * How an opened OpenCode approval reaches the surface.
 *
 * The shared presenter under this provider's name, which is what its own
 * modules and tests call it.
 */
export class OpencodeInteractionPresenter extends AcpApprovalPresenter {}
