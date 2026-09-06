import type {
  ProviderWorkspaceContribution,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';

/**
 * A provider's workspace slots, initialized once and released once.
 *
 * Every composition needs the same four things around
 * `module.workspace.initialize(context, signal)` — build it at most once,
 * hand the same object to every later caller, abort an initialization the
 * unload overtakes, and call the `dispose` half the contract makes mandatory.
 * Codex had them written out; the other eight had none of it, because nothing
 * initialized their workspace at all.
 *
 * **Lazy, and that is the point.** Initialization was eager for Codex because a
 * synchronous `createRuntime` needed the slots to already exist. Nothing else
 * does: the consumers that will read these are asynchronous, so a workspace is
 * built the first time something asks a provider a question — which means a
 * provider the user never opens costs nothing, and a provider whose workspace
 * fails to build fails where the question was asked.
 */
export class ProviderWorkspaceHolder<TContext> {
  private aborter: AbortController | undefined;
  private pending: Promise<ProviderWorkspaceSlots> | undefined;
  private slots: ProviderWorkspaceSlots | undefined;

  constructor(
    private readonly contribution: ProviderWorkspaceContribution<TContext>,
    private readonly context: () => TContext,
  ) {}

  /** The slots, building them if nobody has yet. One build, however many ask. */
  async resolve(): Promise<ProviderWorkspaceSlots> {
    if (this.slots) {
      return this.slots;
    }
    this.aborter ??= new AbortController();
    // The promise is held rather than the result, so two callers that arrive
    // together share one initialization instead of racing two.
    this.pending ??= this.contribution.initialize(this.context(), this.aborter.signal)
      .then(slots => {
        this.slots = slots;
        return slots;
      })
      .catch(error => {
        // Not cached: a workspace that failed to build is retried by the next
        // question, which is what makes a transient failure transient.
        this.pending = undefined;
        throw error;
      });
    return this.pending;
  }

  /** What was built, or nothing. For callers that cannot wait. */
  peek(): ProviderWorkspaceSlots | undefined {
    return this.slots;
  }

  /**
   * Releases what was built, and abandons what is still building.
   *
   * The abort is why the contribution takes a signal: an unload that arrives
   * mid-initialization must not leave a provider holding handles nobody will
   * dispose, and awaiting the initialization first would make unload wait on a
   * provider that may never answer.
   */
  async dispose(): Promise<void> {
    this.aborter?.abort();
    this.aborter = undefined;
    this.pending = undefined;
    const slots = this.slots;
    this.slots = undefined;
    if (slots) {
      await this.contribution.dispose(slots);
    }
  }
}
