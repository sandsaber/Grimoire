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
  | { readonly kind: 'session-config'; readonly session: AcpNewSessionResponse };
