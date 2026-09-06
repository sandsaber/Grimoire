import type {
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
} from '@anthropic-ai/claude-agent-sdk';

import { getActionPattern } from '../../../core/security/ApprovalManager';

/**
 * The rule an approval grants, derived from the action that was approved.
 *
 * Shared with the card that offers it: what "Always allow" writes and what the
 * button says it writes have to come from one place, or the sentence drifts
 * away from the grant and the card becomes worse than no card.
 */
export function resolveApprovalRule(
  toolName: string,
  input: Record<string, unknown>,
): PermissionRuleValue {
  const pattern = getActionPattern(toolName, input);
  if (pattern && !pattern.startsWith('{')) {
    return { toolName, ruleContent: pattern };
  }
  return { toolName };
}

/** What that rule permits, in a sentence the person can weigh before clicking. */
export function describeApprovalRule(
  rule: PermissionRuleValue,
  destination: PermissionUpdateDestination,
): string {
  const scope = destination === 'session' ? 'for this session' : 'for this project';
  return rule.ruleContent
    ? `Allows ${rule.toolName}(${rule.ruleContent}) ${scope}`
    // The case worth spelling out: a rule with no pattern is every use of the
    // tool, and it is what an unclamped suggestion used to grant silently.
    : `Allows every ${rule.toolName} call ${scope}`;
}

export function buildPermissionUpdates(
  toolName: string,
  input: Record<string, unknown>,
  decision: 'allow' | 'allow-always',
  suggestions?: PermissionUpdate[]
): PermissionUpdate[] {
  const destination: PermissionUpdateDestination =
    decision === 'allow-always' ? 'projectSettings' : 'session';
  const approved = resolveApprovalRule(toolName, input);

  const processed: PermissionUpdate[] = [];
  let hasRuleUpdate = false;

  if (suggestions) {
    for (const suggestion of suggestions) {
      if (suggestion.type === 'addRules') {
        // Kept only where the agent asked for exactly what the person was
        // shown. A suggestion is the *agent* proposing its own permissions, and
        // the agent is the party being restrained — so a rule that reaches
        // wider than the approved action is not a convenience, it is the
        // request edited after the click. `{toolName: 'Bash'}` with no pattern
        // was the extreme: permanent approval of every command, granted by a
        // button that said "allow this one".
        // `length` first, because `[].every(...)` is vacuously true: an empty
        // suggestion passed the clamp, claimed to be the rule update, and
        // suppressed the explicit grant below — so "Always allow" granted
        // nothing at all and the same call asked again.
        if (
          suggestion.rules.length === 0
          || !suggestion.rules.every(rule => grantsNoMoreThan(rule, approved))
        ) {
          continue;
        }
        hasRuleUpdate = true;
        processed.push({ ...suggestion, behavior: 'allow', destination });
      } else if (suggestion.type === 'replaceRules') {
        // Never promoted. Replacing the rule set can remove denials the person
        // put there, and no approval button offers that.
        continue;
      } else if (suggestion.type === 'setMode') {
        // A mode that widens is the same hazard through another door: one
        // approval must not put the session into a mode that stops asking.
        if (suggestion.mode === 'bypassPermissions' || suggestion.mode === 'acceptEdits') {
          continue;
        }
        processed.push(suggestion);
      } else if (suggestion.type === 'removeRules' || suggestion.type === 'addDirectories') {
        // The last two that reached wider than the click. `removeRules` can
        // delete a `deny` the person wrote — the same hazard `replaceRules` is
        // dropped for, through a narrower door — and `addDirectories` grants
        // access to paths the prompt never named.
        //
        // What this costs when the agent meant well: it is asked again, per
        // directory, and the person answers a prompt that says which one. What
        // keeping it costs is a denial removed by a button that said "allow
        // this one".
        continue;
      } else {
        processed.push(suggestion);
      }
    }
  }

  if (!hasRuleUpdate) {
    processed.unshift({
      type: 'addRules',
      behavior: 'allow',
      rules: [approved],
      destination,
    });
  }

  return processed;
}

/** Whether a suggested rule permits nothing the approved action did not. */
function grantsNoMoreThan(rule: PermissionRuleValue, approved: PermissionRuleValue): boolean {
  if (rule.toolName !== approved.toolName) {
    return false;
  }
  // A missing pattern means every use of the tool, so it is narrower than the
  // approved action only when the approved action was itself unpatterned.
  return (rule.ruleContent ?? '') === (approved.ruleContent ?? '');
}
