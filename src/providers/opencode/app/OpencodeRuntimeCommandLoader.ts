import type {
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import type { SlashCommand } from '../../../core/types';
import { getOpencodeProviderSettings } from '../settings';

export class OpencodeRuntimeCommandLoader implements ProviderRuntimeCommandLoader {
  isAvailable(settings: Record<string, unknown>): boolean {
    return getOpencodeProviderSettings(settings).enabled;
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

    const boundRuntime = context.runtime?.providerId === 'opencode'
      && !shouldWarmPreSessionConversation
      ? context.runtime
      : null;
    if (boundRuntime) {
      return await boundRuntime.getSupportedCommands();
    }

    const announced = await context.plugin.getOpencodeExecution().metadata.listCommands();
    return announced.map(command => ({
      id: `opencode:${command.name}`,
      name: command.name,
      // The provider owns the expansion; an empty template is the honest value.
      content: '',
      ...(command.description === undefined ? {} : { description: command.description }),
    }));
  }
}
