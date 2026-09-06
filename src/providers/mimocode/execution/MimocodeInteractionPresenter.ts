import { AcpApprovalPresenter } from '@/providers/acp/execution/AcpApprovalPresenter';


/**
 * How an opened MiMoCode approval reaches the surface.
 *
 * The shared presenter under this provider's name, which is what its own
 * modules and tests call it.
 */
export class MimocodeInteractionPresenter extends AcpApprovalPresenter {}
