import type {
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import type { SlashCommand } from '../../../core/types';
import { getMimocodeProviderSettings } from '../settings';

export class MimocodeRuntimeCommandLoader implements ProviderRuntimeCommandLoader {
  isAvailable(settings: Record<string, unknown>): boolean {
    return getMimocodeProviderSettings(settings).enabled;
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
    const boundRuntime = context.runtime?.providerId === 'mimocode'
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
      id: `mimocode:${command.name}`,
      name: command.name,
      // The provider owns the expansion; an empty template is the honest value.
      content: '',
      ...(command.description === undefined ? {} : { description: command.description }),
    }));
  }

  private async announcedCommands(
    context: ProviderRuntimeCommandLoaderContext,
  ): Promise<readonly { readonly name: string; readonly description?: string }[]> {
    try {
      return await context.plugin.getMimocodeExecution().metadata.listCommands();
    } catch {
      return [];
    }
  }
}
