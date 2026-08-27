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
 * presenter and its failure wording are its own.
 *
 * **All nine are on it, and they arrived in that order for a reason.**
 * Antigravity first, as the smallest whole turn — print mode has no session to
 * resume and no interaction channel, so submit, draw, barrier and terminal are
 * read without the couplings that would confound them. Then Codex, the first
 * with content and a thread; then Claude, the first that stops to ask, whose
 * row found that nothing on this path was listening for the question. Then Grok
 * Build, the first over ACP — which is the transport the last five speak, so
 * they went together once that held.
 *
 * **Certification is account-bound, and `chat-projection-flip-smoke-matrix.md`
 * is where it is written down**, per provider: four fully certified, Gemini on
 * the turns its quota allowed, OpenCode intermittently against a vendor that
 * kept dropping, and three flipped under the owner's standing override with no
 * row their accounts could run.
 */
export const PROJECTION_CHAT_PROVIDERS: readonly ProviderId[] = [
  'antigravity',
  'claude',
  'codex',
  'gemini',
  'grok',
  'kimicode',
  'mimocode',
  'opencode',
  'qwen',
];

export function usesProjectionChat(providerId: ProviderId): boolean {
  return PROJECTION_CHAT_PROVIDERS.includes(providerId);
}
