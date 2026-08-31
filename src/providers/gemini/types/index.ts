/**
 * What a Gemini conversation carries beside its session id.
 *
 * **One field, and it exists for one reason.** This provider writes no session
 * paths and no database — a session id is the whole binding, which is what
 * `GeminiProviderModule` says where it builds the patch. But a session the
 * agent no longer has is replaced during a dispatch, and the tab that has to
 * say so is usually a later one; without somewhere to keep that, a reload would
 * show a conversation quietly continuing in a session that does not remember
 * it.
 */
export interface GeminiProviderState {
  /**
   * Set when a saved session failed to load and a fresh one was opened in its
   * place. Read back when the conversation is next bound, so the
   * session-restart notice survives the tab that learned it.
   */
  sessionDropped?: boolean;
}

export function getGeminiState(
  providerState?: Record<string, unknown>,
): GeminiProviderState {
  return providerState ?? {};
}
