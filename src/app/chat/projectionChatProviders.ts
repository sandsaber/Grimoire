import type { ProviderId } from '@/core/types/provider';

/**
 * The providers whose chat tabs run on the projection path.
 *
 * **This list is the switch.** Every piece of the path is built, composed end
 * to end and reachable; what decides whether a tab takes it is membership here.
 * Adding a provider is that provider's flip and removing it reverts that flip
 * for everyone without touching code, which is why the entries are certified
 * against a live CLI with `docs/chat-projection-flip-smoke-matrix.md` rather
 * than by a gate: what changes is what a person sees while their turn runs.
 *
 * A list rather than a boolean because the chat surface is provider-neutral
 * while the risk is not: a provider's content presenter, its interaction
 * presenter and its failure wording are its own, and the branch's rule is one
 * provider per checkpoint, proven before the pattern is repeated.
 *
 * **Antigravity is first because it is the smallest whole turn.** Print mode
 * has no provider-native session to resume, no interaction channel — approval
 * is refused before a process exists — and one `output-delta` carrying the
 * whole answer, so it exercises submit, draw, barrier and terminal without any
 * of the couplings that would confound a first reading of them. It is also the
 * only provider certified end to end on the machine this branch is built on.
 */
export const PROJECTION_CHAT_PROVIDERS: readonly ProviderId[] = ['antigravity'];

export function usesProjectionChat(providerId: ProviderId): boolean {
  return PROJECTION_CHAT_PROVIDERS.includes(providerId);
}
