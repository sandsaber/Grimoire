import { ExecutionDispatchError } from '@/core/execution/ExecutionContracts';

/**
 * A turn that died before the agent was ready to be asked anything.
 *
 * Distinct from the dispatch errors around it because the tab has to say
 * something different: nothing was resumed, so a sentence about a saved session
 * is not merely unhelpful, it points at a thing that never existed. The run is
 * side-effect free by construction — the handshake had not finished, so no
 * prompt was sent and no tool could have run.
 */
export class AcpStartupError extends ExecutionDispatchError {
  constructor(message: string) {
    super(message, true);
    this.name = 'AcpStartupError';
  }
}
