import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';

import type { SubagentRuntimeState } from '../../../core/runtime/types';

export type SubagentHookState = SubagentRuntimeState;

const STOP_BLOCK_REASON = 'Background subagents are still running. Use `TaskOutput task_id="..." block=true` to wait for their results before ending your turn.';

/**
 * Blocks a turn from ending on top of a background subagent.
 *
 * **The answer may be awaited, and that is what lets the records be the source
 * of it.** The hook body was always `async`; only this parameter's type said
 * the question had to be answered without going anywhere, which is why the tab
 * kept a live map of its own subagents beside the durable records and unioned
 * the two. A promise here means the records can be read — and read *after* the
 * recordings in flight have landed — so there is one source instead of two.
 */
export function createStopSubagentHook(
  getState: () => SubagentHookState | Promise<SubagentHookState>
): HookCallbackMatcher {
  return {
    hooks: [
      async () => {
        let hasRunning: boolean;
        try {
          hasRunning = (await getState()).hasRunning;
        } catch {
          // Provider failed — assume subagents are running to be safe
          hasRunning = true;
        }

        if (hasRunning) {
          return { decision: 'block' as const, reason: STOP_BLOCK_REASON };
        }

        return {};
      },
    ],
  };
}
