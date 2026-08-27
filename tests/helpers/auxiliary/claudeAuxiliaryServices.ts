import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { AuxiliaryExecutionOwner } from '@/app/auxiliary/AuxiliaryExecutionOwner';
import { ClaudeExecution } from '@/app/execution/claude/ClaudeExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';

/**
 * Claude's auxiliary services, built the way the application builds them.
 *
 * Not a stand-in: it constructs the same composition and the same owner
 * production does, so a test that passes here is a statement about the path a
 * user is on. Assembling them by hand instead is how a harness ends up
 * measuring itself.
 */
export function claudeAuxiliaryServices(plugin: unknown): AuxiliaryExecutionOwner {
  const host = new ExecutionKernelHost({ storage: new TestDurableStorage() });
  const execution = new ClaudeExecution(plugin as never, host.registry);
  return new AuxiliaryExecutionOwner({
    resolveTitleProviderId: () => 'claude',
    sources: new Map([['claude', execution.auxiliarySource()]]),
  });
}
