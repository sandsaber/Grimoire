import type {
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import type { SlashCommand } from '../../../core/types';
import type { ProviderId } from '../../../core/types/provider';
import type { SlashCommandSource } from '../../../core/types/settings';

/** One announced command, as every ACP metadata session reports it. */
export interface AnnouncedAcpCommand {
  readonly name: string;
  readonly description?: string;
}

export interface AcpRuntimeCommandLoaderOptions {
  readonly providerId: ProviderId;
  readonly isEnabled: (settings: Record<string, unknown>) => boolean;
  /** The provider's own metadata session, asked without a conversation. */
  readonly listAnnounced: (
    context: ProviderRuntimeCommandLoaderContext,
  ) => Promise<readonly AnnouncedAcpCommand[]>;
  /**
   * The id this provider mints for a command it listed cold.
   *
   * **Parameterized because the four disagree, and the disagreement is
   * preserved rather than settled here.** Grok mints `acp:<name>`, matching
   * what `AcpSessionUpdateNormalizer` mints for a command announced to a live
   * session, with a comment saying that is the point. The other three mint
   * `<provider>:<name>`. Neither is a defect: the catalog dedupes runtime
   * commands by *name*, so the two paths cannot produce a pair, and only one of
   * them is ever the winner. Unifying it is a behaviour change with no test
   * that would notice, which is the wrong kind to make while consolidating.
   */
  readonly commandId: (name: string) => string;
  /** Also disagreed on, and also inert: the catalog reads an absent one as `sdk`. */
  readonly source?: SlashCommandSource;
}

/**
 * Listing an ACP provider's slash commands, for a tab that may have no session.
 *
 * **One implementation for four providers that had four.** OpenCode, MiMoCode
 * and Kimi Code's loaders were byte-identical once their own names were
 * normalized away; Grok's differed in a comment, the command id, and one field.
 * Four copies of a rule about when it is safe to open a session is four places
 * for that rule to drift, and the rule is the delicate part.
 */
export class AcpRuntimeCommandLoader implements ProviderRuntimeCommandLoader {
  constructor(private readonly options: AcpRuntimeCommandLoaderOptions) {}

  isAvailable(settings: Record<string, unknown>): boolean {
    return this.options.isEnabled(settings);
  }

  /**
   * The commands the tab can offer, from the session it is on or from one
   * opened to ask.
   *
   * A live tab runtime answers from the session it already holds — the ACP
   * agent announced them when that session opened. Anything else is a question
   * with no session behind it, and it is asked in an isolated process rather
   * than on the tab's own: a conversation with history and no session id must
   * stay cold until its first send, or the session created to list commands is
   * the one that turn resumes, and the history is never bootstrapped into it.
   */
  async loadCommands(context: ProviderRuntimeCommandLoaderContext): Promise<SlashCommand[]> {
    const shouldWarmBlankSession = context.allowSessionCreation === true
      && !context.conversation?.sessionId;
    const shouldWarmPreSessionConversation = !!context.conversation
      && !context.conversation.sessionId
      && context.conversation.messages.length > 0;

    if (
      !context.runtime
      && !context.conversation?.sessionId
      && !shouldWarmBlankSession
      && !shouldWarmPreSessionConversation
    ) {
      return [];
    }

    // A live tab answers from the session it already holds — and only then. A
    // blank tab has a runtime and no session, and asking it returns nothing at
    // all, which is how a fresh tab ends up with an empty slash-command menu
    // until the first message is sent.
    const boundRuntime = context.runtime?.providerId === this.options.providerId
      && !shouldWarmPreSessionConversation
      && Boolean(context.runtime.getSessionId?.())
      ? context.runtime
      : null;
    if (boundRuntime) {
      return await boundRuntime.getSupportedCommands();
    }

    // Opportunistic, like every other question asked without a conversation: a
    // plugin whose kernel has not started yet has no session to ask in, and a
    // tab that cannot list commands must still open.
    const announced = await this.announcedCommands(context);
    return announced.map(command => ({
      id: this.options.commandId(command.name),
      name: command.name,
      // The provider owns the expansion; an empty template is the honest value.
      content: '',
      ...(this.options.source ? { source: this.options.source } : {}),
      ...(command.description === undefined ? {} : { description: command.description }),
    }));
  }

  private async announcedCommands(
    context: ProviderRuntimeCommandLoaderContext,
  ): Promise<readonly AnnouncedAcpCommand[]> {
    try {
      return await this.options.listAnnounced(context);
    } catch {
      return [];
    }
  }
}
