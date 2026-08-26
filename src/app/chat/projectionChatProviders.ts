import type { ProviderId } from '@/core/types/provider';

/**
 * The providers whose chat tabs run on the projection path.
 *
 * **Empty, and that is the switch.** Every piece of the path is built, composed
 * end to end and reachable; what decides whether a tab takes it is this list.
 * Adding a provider here is that provider's flip, and it is certified the way
 * every flip on this branch is certified — against a live CLI, with its smoke
 * matrix — rather than by a gate, because what changes is what a person sees
 * while their turn runs.
 *
 * A list rather than a boolean because the chat surface is provider-neutral
 * while the risk is not: a provider's content presenter, its interaction
 * presenter and its failure wording are its own, and the branch's rule is one
 * provider per checkpoint, proven before the pattern is repeated.
 */
export const PROJECTION_CHAT_PROVIDERS: readonly ProviderId[] = [];

export function usesProjectionChat(providerId: ProviderId): boolean {
  return PROJECTION_CHAT_PROVIDERS.includes(providerId);
}
