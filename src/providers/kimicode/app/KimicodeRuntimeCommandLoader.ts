import type {
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import { KimicodeChatRuntime } from '../runtime/KimicodeChatRuntime';
import { getKimicodeProviderSettings } from '../settings';

const KIMICODE_METADATA_WARMUP_DB = ':memory:';

export class KimicodeRuntimeCommandLoader implements ProviderRuntimeCommandLoader {
  isAvailable(settings: Record<string, unknown>): boolean {
    return getKimicodeProviderSettings(settings).enabled;
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

    // **Pre-flip by design.** OpenCode's flipped loader gates on an existing
    // session and asks through an isolated metadata session; this one reuses a
    // session-less tab runtime and opens a warmup ACP session on it, with an
    // in-memory database so nothing persists. That difference is the legacy
    // path, not a defect in it — Kimi Code has no kernel composition to ask yet,
    // and porting the shape without the flip would mean maintaining two.
    //
    // Rebinding an already-live tab runtime to a history-backed conversation with
    // no session id must stay cold until the first send. If command discovery
    // creates a real session on that bound runtime, the first turn can skip
    // history bootstrap. Keep this warmup isolated instead.
    const canReuseRuntime = context.runtime?.providerId === 'kimicode'
      && !shouldWarmPreSessionConversation;
    const runtime = canReuseRuntime
      ? context.runtime!
      : new KimicodeChatRuntime(context.plugin);

    try {
      if (context.conversation) {
        runtime.syncConversationState(context.conversation, context.externalContextPaths);
      } else if (shouldWarmBlankSession) {
        // Blank-tab warmup uses an isolated in-memory session to fetch metadata
        // without binding a persisted Kimi Code session to the tab.
        runtime.syncConversationState({
          providerState: { databasePath: KIMICODE_METADATA_WARMUP_DB },
          sessionId: null,
        });
      }

      // Wrapped, because this is the slash menu warming up. `ensureReady`
      // launches a CLI, and a spawn failure there rejected all the way out
      // through opening a menu — OpenCode's flipped loader answers an empty
      // list instead, which is what a menu with nothing to show looks like.
      const ready = await runtime.ensureReady({
        allowSessionCreation: shouldWarmBlankSession || shouldWarmPreSessionConversation,
      });
      if (!ready) {
        return [];
      }

      return await runtime.getSupportedCommands();
    } catch {
      return [];
    } finally {
      if (runtime !== context.runtime) {
        runtime.cleanup();
      }
    }
  }
}
