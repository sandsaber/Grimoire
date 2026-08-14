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
const WIRED = ['opencode', 'mimocode', 'kimicode', 'gemini', 'qwen', 'grok', 'claude', 'codex', 'antigravity'] as const;

describe('createChatTurnRequestPreparers', () => {
  it('registers every managed-ACP provider whose launch pipeline is wired', () => {
    const registry = createRegistry();

    for (const providerId of WIRED) {
      expect(registry.has(providerId)).toBe(true);
    }
  });

  it('covers every provider in the catalog', () => {
    const registry = createRegistry();
    const missing = builtInProviderCatalog.list()
      .map(module => module.manifest.id)
      .filter(providerId => !registry.has(providerId));

    // A provider present in the catalog but absent here would reach its backend
    // and fail there as an unresolvable request reference.
    expect(missing).toEqual([]);
  });

  it('fails closed by name for a provider with no preparer', async () => {
    const registry = createRegistry();

    expect(registry.has('not-a-provider')).toBe(false);
    await expect(registry.prepare('not-a-provider', {
      conversationId: 'conv-1',
      prompt: 'hello',
      cwd: '/vault',
      settings: {},
    })).rejects.toThrow(ChatTurnPreparationUnsupportedError);
  });

  it('rejects a duplicate preparer for the same provider', () => {
    const registry = createRegistry();
    expect(() => registry.register({
      providerId: 'opencode',
      prepare: async () => { throw new Error('unreachable'); },
    })).toThrow(/Duplicate chat turn preparer/);
  });
});
