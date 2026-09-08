import type { AcpTurnRefusalOrigin } from '@/providers/acp/execution/AcpContentPayload';

/**
 * What the tab says when the session a turn needs would not open.
 *
 * One copy for six providers, because it was six copies of the same two
 * sentences and the fix below had to land in all of them. The provider's
 * display name is the only thing that differed.
 *
 * The advice — start a new chat — is right for the case it was written for: an
 * agent that answers a `session/load` with something vague about a session it
 * cannot find, where the binding is deliberately kept and the conversation
 * would otherwise repeat a neutral sentence forever. It is **wrong** when the
 * agent refused for a reason that has nothing to do with the session, which a
 * live run against an unauthenticated `kimi acp` is what showed: it answers the
 * load with "Authentication required", and a new chat fails identically.
 *
 * So where the agent said anything, it is said first and the advice is
 * conditioned on it out loud. Nothing is dropped, because in one case the
 * agent's words are the only actionable thing and in the other the advice is.
 */
export function describeAcpSessionOpenFailure(
  providerName: string,
  refusal?: string,
  origin?: AcpTurnRefusalOrigin,
): string {
  const said = refusal?.trim();
  // No session was opened, refused or resumed here: the agent never finished
  // starting. Both sentences below are about a session, so both are wrong, and
  // the advice to start a new chat sends a user to a chat that fails the same
  // way — which is what a slow CLI produced on every turn it was given.
  if (origin === 'startup') {
    return `${providerName} did not finish starting, so this turn never began. `
      + 'This is not a missing session and a new chat will not help: check that the CLI path in '
      + `the ${providerName} settings is correct and that the CLI starts.`;
  }
  if (!said) {
    return `${providerName} could not start this turn. If this conversation was resumed from a `
      + 'saved session, that session may no longer exist — starting a new chat will create one.';
  }
  return `${providerName} could not open the session this conversation was resumed from. `
    + `${providerName} said: ${asSentence(said)} Starting a new chat helps only if the session `
    + 'itself is gone.';
}

/**
 * The agent's words, ending the way a sentence does.
 *
 * Vendors are inconsistent about it — "Authentication required" against
 * "Authentication required: Use Qwen Code CLI to authenticate first." — and the
 * next sentence follows immediately.
 */
function asSentence(message: string): string {
  return /[.!?…:]$/.test(message) ? message : `${message}.`;
}
