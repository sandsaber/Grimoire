import type { Options } from '@anthropic-ai/claude-agent-sdk';

import type { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import type { ClaudeSdkStartupOptionsResolver } from '@/providers/claude/execution/ClaudeSdkExecutionAdapter';

export const CLAUDE_STARTUP_OPTIONS_REQUEST_KIND = 'claude-startup-options';

/**
 * Resolves opaque Claude SDK startup references through the application
 * request broker. The chat coordinator registers the SDK options before
 * dispatching the run.
 */
export class ClaudeStartupOptionsResolverAdapter implements ClaudeSdkStartupOptionsResolver {
  constructor(private readonly broker: ApplicationExecutionRequestBroker) {}

  async resolve(startupRef: string, _signal: AbortSignal): Promise<Options> {
    return this.broker.take<Options>(startupRef, CLAUDE_STARTUP_OPTIONS_REQUEST_KIND);
  }
}
