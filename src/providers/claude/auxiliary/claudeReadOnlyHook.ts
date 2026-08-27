import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';

import { isReadOnlyTool } from '../../../core/tools/toolNames';

/**
 * The ceiling an inline edit runs under.
 *
 * The tool list narrows what the model is offered; this refuses what it asks
 * for anyway. Both, because they answer different questions — one is what is
 * advertised, the other is what is allowed — and an inline edit that writes to
 * the vault while the user is looking at a preview of the change is the failure
 * this exists to prevent.
 */
export function createReadOnlyHook(): HookCallbackMatcher {
  return {
    hooks: [
      async (hookInput) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: Record<string, unknown>;
        };
        const toolName = input.tool_name;

        if (isReadOnlyTool(toolName)) {
          return { continue: true };
        }

        return {
          continue: false,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny' as const,
            permissionDecisionReason: `Inline edit mode: tool "${toolName}" is not allowed (read-only)`,
          },
        };
      },
    ],
  };
}
