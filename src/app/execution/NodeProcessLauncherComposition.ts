import type { AcpManagedProcessLauncher } from '@/providers/acp/execution/AcpManagedClientAdapter';
import type { AntigravityProcessTransport } from '@/providers/antigravity/runtime/AntigravityPrintProcessRunner';
import type { CodexExecutionProcessFactory } from '@/providers/codex/runtime/CodexExecutionConnection';

import type { ApplicationExecutionRequestBroker } from '../runtime/ApplicationExecutionRequestBroker';
import {
  ManagedAcpLaunchResolverAdapter,
} from './acp/ManagedAcpLaunchResolverAdapter';
import {
  NodeManagedAcpProcessLauncher,
} from './acp/NodeManagedAcpProcessLauncher';
import { NodeAntigravityProcessTransport } from './antigravity/NodeAntigravityProcessTransport';
import {
  NodeCodexExecutionProcessFactory,
  type NodeCodexExecutionProcessOptions,
} from './codex/NodeCodexExecutionProcess';

export interface NodeProcessLauncherComposition {
  readonly antigravityTransport: AntigravityProcessTransport;
  readonly managedAcpLauncher: AcpManagedProcessLauncher;
  readonly codexProcessFactory: CodexExecutionProcessFactory;
}

export interface NodeProcessLauncherCompositionOptions {
  readonly requests: ApplicationExecutionRequestBroker;
  readonly codexLaunchSpec: NodeCodexExecutionProcessOptions['launchSpec'];
}

/**
 * Constructs the concrete Node.js process launchers for every execution topology.
 * Provider code sees only the narrow transport/launcher interfaces; Node process
 * and platform primitives stay behind the application boundary.
 */
export function createNodeProcessLauncherComposition(
  options: NodeProcessLauncherCompositionOptions,
): NodeProcessLauncherComposition {
  const antigravityTransport = new NodeAntigravityProcessTransport();
  const launchResolver = new ManagedAcpLaunchResolverAdapter(options.requests);
  const managedAcpLauncher = new NodeManagedAcpProcessLauncher(launchResolver);
  const codexProcessFactory = new NodeCodexExecutionProcessFactory({
    launchSpec: options.codexLaunchSpec,
  });
  return Object.freeze({ antigravityTransport, managedAcpLauncher, codexProcessFactory });
}
