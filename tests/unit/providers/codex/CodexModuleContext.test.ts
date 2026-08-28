import type { BoundConversation } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { createCodexModuleContext } from '@/providers/codex/app/CodexModuleContext';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

/**
 * What the module can answer about the conversation a runtime serves.
 *
 * The contributions are asked about a conversation *id*, and a runtime serves
 * exactly one conversation. Answering for any other would be answering for a
 * tab this runtime knows nothing about.
 */
describe('Codex module context', () => {
  function plugin(): any {
    return {
      settings: {},
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/codex',
    };
  }

  function contextFor(conversation: BoundConversation | null) {
    return createCodexModuleContext(plugin(), () => conversation);
  }

  it('reports the thread this tab is bound to', () => {
    const context = contextFor({ id: 'conv-1', sessionId: 'thread-7' });

    expect(context.resolveSessionId('conv-1')).toBe('thread-7');
    expect(context.isPendingFork('conv-1')).toBe(false);
  });

  it('says nothing about a conversation this runtime does not serve', () => {
    // One runtime, one tab: answering for another conversation would report a
    // thread that belongs to a different tab's daemon session.
    const context = contextFor({ id: 'conv-1', sessionId: 'thread-7' });

    expect(context.resolveSessionId('conv-2')).toBeNull();
    expect(context.isPendingFork('conv-2')).toBe(false);
    expect(contextFor(null).resolveSessionId('conv-1')).toBeNull();
  });

  it('reports a fork that has not been taken yet', () => {
    // Until the fork happens the conversation has no thread of its own, and
    // the next dispatch has to fork rather than resume.
    const context = contextFor({
      id: 'conv-1',
      providerState: { forkSource: { sessionId: 'thread-source', resumeAt: 'assistant-2' } },
    });

    expect(context.isPendingFork('conv-1')).toBe(true);
    expect(context.resolveSessionId('conv-1')).toBeNull();
  });

  it('offers nothing where the workspace services are not registered', async () => {
    // Before their registration, and in any test that never registered them:
    // an empty list is what a provider with no workspace has to offer, and it
    // is not an error.
    const context = contextFor(null);

    await expect(context.commandsPort().listDropdownEntries({ includeBuiltIns: false }))

      .resolves.toEqual([]);
    await expect(context.listAgentMentions()).resolves.toEqual([]);
    await expect(context.listModels()).resolves.toEqual([]);
    // Cached is synchronous now: the indicator reads it while a tab paints,
    // and a promise there is a paint that waits.
    expect(context.cachedPlanUsage()).toBeNull();
    await expect(context.refreshPlanUsage()).resolves.toBeNull();
    await expect(context.refreshAgentMentions()).resolves.toBeUndefined();
    expect(() => context.renderSettingsTab({ container: null, context: null })).not.toThrow();
  });

  it('leaves a conversation alone when the sync gave it only a binding', async () => {
    // `syncConversationState` is typed as a binding but handed the whole
    // conversation; a caller that really passes only a binding has no messages
    // to hydrate, and hydrating one would read fields that are not there.
    const context = contextFor({ id: 'conv-1', sessionId: 'thread-7' });

    await expect(context.hydrateConversation('conv-1')).resolves.toEqual({ outcome: 'absent' });
    await expect(context.deleteConversationSession('conv-1')).resolves.toBeUndefined();
  });

  it('no longer carries subagent recognition, which needs no plugin', () => {
    // Moved to `codexProviderModule.declarations.nativeAgents` at M3, where its
    // own test lives: reaching a plugin to answer a question about a tool name
    // is what kept that row on the legacy registration.
    expect(contextFor(null)).not.toHaveProperty('recognizesSubagentTool');
  });
});
