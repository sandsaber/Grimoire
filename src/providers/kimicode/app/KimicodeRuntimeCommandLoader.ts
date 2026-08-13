import type {
  ProviderRuntimeCommandLoader,
  ProviderRuntimeCommandLoaderContext,
} from '../../../core/providers/types';
import type { SlashCommand } from '../../../core/types';
import { getKimicodeProviderSettings } from '../settings';

// KimicodeChatRuntime removed. Runtime command discovery now
// resolves through the application runtime; this loader reports no commands.
// `ChatRuntime` is now opaque (`unknown`), so the minimal runtime surface this
// loader touches is described locally to keep access type-safe.
interface StubRuntime {
  providerId?: string;
  syncConversationState(state: unknown): void;
  ensureReady(options: { allowSessionCreation: boolean }): Promise<boolean>;
  getSupportedCommands(): Promise<SlashCommand[]>;
  cleanup(): void;
}

function createStubRuntime(): StubRuntime {
  return {
    syncConversationState: () => {},
    ensureReady: async () => false,
    getSupportedCommands: async () => [] as SlashCommand[],
    cleanup: () => {},
  };
}

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

    // Rebinding an already-live tab runtime to a history-backed conversation with
    // no session id must stay cold until the first send. If command discovery
    // creates a real session on that bound runtime, the first turn can skip
    // history bootstrap. Keep this warmup isolated instead.
    const contextRuntime = context.runtime as StubRuntime | null;
    const canReuseRuntime = contextRuntime?.providerId === 'kimicode'
      && !shouldWarmPreSessionConversation;
    const runtime = canReuseRuntime
      ? contextRuntime
      : createStubRuntime();

    try {
      if (context.conversation) {
        // runtime sync removed
      } else if (shouldWarmBlankSession) {
        // Blank-tab warmup uses an isolated in-memory session to fetch metadata
        // without binding a persisted Kimi Code session to the tab.
        runtime.syncConversationState({
          providerState: { databasePath: ':memory:' },
          sessionId: null,
        });
      }

      const ready = await runtime.ensureReady({
        allowSessionCreation: shouldWarmBlankSession || shouldWarmPreSessionConversation,
      });
      if (!ready) {
        return [];
      }

      return await Promise.resolve([]);
    } finally {
      // runtime cleanup removed
    }
  }
}
