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
/**
 * Where a refusal came from, where that changes what the tab should say.
 *
 * Absent for the refusals whose words *are* the answer — a refused prompt, and a
 * `session/new` the agent would not open. Nothing Grimoire could add to
 * "Authentication required" would help, and a new chat demonstrably fails the
 * same way.
 *
 * `'session-load'` is the one that is different, and a live run is what showed
 * it. The composition's own sentence for a session that will not open says the
 * saved session may be gone and a new chat will make one — true and actionable
 * when the agent is being vague about a session it cannot find, which is the
 * case it was written for (OpenCode answers `Internal error: OpenCode service
 * failure`). But an unauthenticated `kimi acp` refuses the *load* with
 * "Authentication required", and then that advice is not merely unhelpful, it
 * is wrong: a new chat fails identically. Neither half can be dropped, so the
 * origin travels and the composition says both, the agent's words first.
 */
export type AcpTurnRefusalOrigin = 'session-load';

/** What the agent said, and which refusal it was. */
export interface AcpTurnRefusal {
  readonly message: string;
  readonly origin?: AcpTurnRefusalOrigin;
}

export type AcpContentPayload =
  | { readonly kind: 'session-update'; readonly notification: AcpSessionNotification }
  | { readonly kind: 'prompt-result'; readonly response: AcpPromptResponse }
  | { readonly kind: 'session-config'; readonly session: AcpNewSessionResponse }
  /**
   * What became of the saved session a dispatch tried to resume.
   *
   * `replaced` says the agent no longer had it and a fresh one took its place,
   * which is the only way a conversation learns that the history on screen is
   * no longer the agent's memory. `resumed` is the same fact answered the other
   * way, and it is what takes the notice back down.
   *
   * On the content channel because that is what reaches the tab the run belongs
   * to: a backend serves every tab, and the fact belongs to one conversation.
   */
  | { readonly kind: 'session-resume'; readonly outcome: 'resumed' | 'replaced' }
  /**
   * What the agent said when it refused the turn.
   *
   * A fourth shape, and the one the flips lost: every legacy ACP runtime yielded
   * the provider's own error text, and the kernel path replaced it with a
   * terminal reason that has room for no words at all. `429 You have exhausted
   * your daily quota on this model` became "Grimoire could not establish
   * whether this run completed."
   *
   * **Both refusals, not only the prompt.** An agent that will not open a
   * session refuses the turn just as completely, and its reason is usually the
   * one a first-run user needs most: `qwen 0.21.15` answers `session/new` with
   * "Authentication required: Use Qwen Code CLI to authenticate first", where
   * the classification alone could only guess that a saved session had gone.
   *
   * Carried here rather than on the terminal because a terminal reason is an
   * enum and this is a sentence. The presenter keeps it and the composition
   * hands it back through `describeFailure`, so the tab still renders exactly
   * one error for one failure.
   *
   * `origin` is why a refusal is not always the whole answer: see
   * `AcpTurnRefusalOrigin`.
   */
  | {
    readonly kind: 'turn-refused';
    readonly message: string;
    readonly origin?: AcpTurnRefusalOrigin;
  }
  /**
   * A mode the session would not take, on the turn that asked for it.
   *
   * Not a failed turn: the turn runs, under the mode the session already has.
   * What it is instead is the toolbar and the session disagreeing, which nobody
   * would otherwise see — Gemini refuses `yolo` and `autoEdit` in a folder it
   * has not been told to trust, so Auto-approve silently becomes Default.
   */
  | {
    readonly kind: 'mode-refused';
    readonly modeId: string;
    /** What the agent said about why, where it said anything. */
    readonly detail?: string;
  };
