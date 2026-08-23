import type { AcpNewSessionResponse, AcpPromptResponse, AcpSessionNotification } from '@/providers/acp/types';

/**
 * What an ACP connection delivered, in the three shapes it delivers it.
 *
 * A session update is a notification; the tokens a prompt cost arrive only in
 * the answer to `session/prompt`; and the models and modes a tab can choose
 * from are answered once, by `session/new` or `session/load`, and by nothing
 * afterwards. All three are the wire, none is interpreted before a provider's
 * own presenter reads it.
 *
 * Shared rather than per provider: the backend that emits these is shared, and
 * a second copy of this union would be a second thing to keep in step.
 */
export type AcpContentPayload =
  | { readonly kind: 'session-update'; readonly notification: AcpSessionNotification }
  | { readonly kind: 'prompt-result'; readonly response: AcpPromptResponse }
  | { readonly kind: 'session-config'; readonly session: AcpNewSessionResponse }
  /**
   * What the agent said when it refused the turn.
   *
   * A fourth shape, and the one the flips lost: every legacy ACP runtime yielded
   * the provider's own error text, and the kernel path replaced it with a
   * terminal reason that has room for no words at all. `429 You have exhausted
   * your daily quota on this model` became "Grimoire could not establish
   * whether this run completed."
   *
   * Carried here rather than on the terminal because a terminal reason is an
   * enum and this is a sentence. The presenter keeps it and the composition
   * hands it back through `describeFailure`, so the tab still renders exactly
   * one error for one failure.
   */
  | { readonly kind: 'prompt-failed'; readonly message: string };
