import type { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';

import type { ManagedAcpLaunchInvocation, ManagedAcpLaunchResolver } from './NodeManagedAcpProcessLauncher';

export const MANAGED_ACP_LAUNCH_REQUEST_KIND = 'managed-acp-launch';

/**
 * Resolves opaque managed-ACP startup references through the application
 * request broker. The chat coordinator registers the launch invocation
 * before dispatching the run; the process launcher resolves it here.
 */
export class ManagedAcpLaunchResolverAdapter implements ManagedAcpLaunchResolver {
  constructor(private readonly broker: ApplicationExecutionRequestBroker) {}

  async resolve(startupRef: string): Promise<ManagedAcpLaunchInvocation> {
    return this.broker.take<ManagedAcpLaunchInvocation>(
      startupRef,
      MANAGED_ACP_LAUNCH_REQUEST_KIND,
    );
  }
}
