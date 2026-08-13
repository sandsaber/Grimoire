import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { createChatTurnRequestPreparers } from '@/app/runtime/ChatTurnPreparerComposition';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import { ChatTurnPreparationUnsupportedError } from '@/core/providers/ChatTurnRequestPreparer';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

function createRegistry() {
  let sequence = 0;
  return createChatTurnRequestPreparers({
    requests: new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      { nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never },
    ),
  });
}

/** Providers with a preparer. Kept here so both assertions stay in step. */
const WIRED = ['opencode', 'mimocode', 'kimicode', 'gemini', 'qwen', 'grok', 'claude'] as const;

describe('createChatTurnRequestPreparers', () => {
  it('registers every managed-ACP provider whose launch pipeline is wired', () => {
    const registry = createRegistry();

    for (const providerId of WIRED) {
      expect(registry.has(providerId)).toBe(true);
    }
  });

  it('fails closed by name for providers whose launch pipeline is not wired', async () => {
    const registry = createRegistry();
    const wired = new Set<string>(WIRED);
    const unwired = builtInProviderCatalog.list()
      .map(module => module.manifest.id)
      .filter(providerId => !wired.has(providerId));

    // Every remaining provider must announce itself rather than fail later as
    // an unresolvable request reference inside its backend.
    expect(unwired.length).toBeGreaterThan(0);
    for (const providerId of unwired) {
      expect(registry.has(providerId)).toBe(false);
      await expect(registry.prepare(providerId, {
        conversationId: 'conv-1',
        prompt: 'hello',
        cwd: '/vault',
        settings: {},
      })).rejects.toThrow(ChatTurnPreparationUnsupportedError);
    }
  });

  it('rejects a duplicate preparer for the same provider', () => {
    const registry = createRegistry();
    expect(() => registry.register({
      providerId: 'opencode',
      prepare: async () => { throw new Error('unreachable'); },
    })).toThrow(/Duplicate chat turn preparer/);
  });
});
