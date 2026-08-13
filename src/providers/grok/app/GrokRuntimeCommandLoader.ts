import type {
  ChatRuntime,
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import type { SlashCommand } from '../../../core/types';
import { getGrokProviderSettings } from '../settings';

// Phase 9 cutover — GrokChatRuntime removed. Runtime command discovery now
// resolves through the application runtime; this loader reports no commands.
function createStubRuntime(): Pick<
  ChatRuntime,
  'syncConversationState' | 'ensureReady' | 'getSupportedCommands' | 'cleanup'
> {
  return {
    syncConversationState: () => {},
    ensureReady: async () => false,
    getSupportedCommands: async () => [] as SlashCommand[],
    cleanup: () => {},
  };
}



export class GrokRuntimeCommandLoader implements ProviderRuntimeCommandLoader {
  isAvailable(settings: Record<string, unknown>): boolean {
    return getGrokProviderSettings(settings).enabled;
  }

  async loadCommands(context: ProviderRuntimeCommandLoaderContext) {
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

    // Rebinding an already-live tab runtime to a history-backed conversation with
    // no session id must stay cold until the first send. If command discovery
    // creates a real session on that bound runtime, the first turn can skip
    // history bootstrap. Keep this warmup isolated instead.
    const canReuseRuntime = context.runtime?.providerId === 'grok'
      && !shouldWarmPreSessionConversation;
    const runtime = canReuseRuntime
      ? context.runtime!
      : createStubRuntime();

    try {
      if (context.conversation) {
        runtime.syncConversationState(context.conversation, context.externalContextPaths);
      } else if (shouldWarmBlankSession) {
        // Blank-tab warmup uses an isolated in-memory session to fetch metadata
        // without binding a persisted Grok session to the tab.
        runtime.syncConversationState({
          providerState: {},
          sessionId: null,
        });
      }

      const ready = await runtime.ensureReady({
        allowSessionCreation: shouldWarmBlankSession || shouldWarmPreSessionConversation,
      });
      if (!ready) {
        return [];
      }

      return await runtime.getSupportedCommands();
    } finally {
      if (runtime !== context.runtime) {
        runtime.cleanup();
      }
    }
  }
}
