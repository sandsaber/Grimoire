import '@/providers';

import type { StreamChunk } from '@/core/types';
import {
  createTabProjectionExecution,
  resolveTabProjectionExecution,
} from '@/features/chat/tabs/tabProjectionExecution';
import type { TabData } from '@/features/chat/tabs/types';

/**
 * What a tab brings to the projection path.
 *
 * **There is no switch left.** `projectionChatProviders` gated this one
 * provider at a time until all nine were on it, and with the legacy send path
 * gone the list could no longer revert a flip — removing a provider from it
 * stopped that provider sending. What remains is the second question: what a
 * tab knows that nothing else does — its column, its streaming cursor, and the
 * provider ports its runtime was built with.
 */

function tabOf(overrides: Partial<TabData> = {}): TabData {
  return {
    id: 'tab-1',
    providerId: 'claude',
    conversationId: null,
    service: null,
    renderer: null,
    state: { currentConversationId: null },
    controllers: {},
    ui: {},
    ...overrides,
  } as unknown as TabData;
}

const plugin = {
  settings: {},
  getChatExecution: () => ({ bindSurface: () => ({ detach: () => undefined }) }),
} as never;

describe('tab projection execution', () => {
  it('builds nothing for a provider the catalog does not have', () => {

    expect(createTabProjectionExecution(tabOf({ providerId: 'not-a-provider' }), plugin)).toBeNull();
  });

  it('builds nothing before the chat path exists', () => {
    // A restored workspace builds its tabs while `loadSettings` is still
    // running, so the composition may not be there yet. A tab without one runs
    // the legacy path, which is what it would have done anyway.
    const beforeLoad = {
      settings: {},
      getChatExecution: () => {
        throw new Error('Chat execution is not available before plugin load.');
      },
    } as never;

    expect(createTabProjectionExecution(tabOf(), beforeLoad)).toBeNull();
  });

  it('builds one for a provider the catalog has', () => {
    expect(createTabProjectionExecution(tabOf(), plugin)).not.toBeNull();
  });

  describe('resolving which path a tab is on', () => {
    it('builds a new one when the tab changes provider', () => {
      // A blank tab derives its provider from the model that is picked, and a
      // bound one changes with the conversation. Built once, a tab that
      // switched *away* would keep submitting turns under the provider it left.
      const tab = tabOf({ providerId: 'codex' });

      const first = resolveTabProjectionExecution(tab, plugin);
      expect(first).not.toBeNull();
      expect(resolveTabProjectionExecution(tab, plugin)).toBe(first);

      tab.providerId = 'claude';
      const second = resolveTabProjectionExecution(tab, plugin);
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });

    it('detaches the one it replaces', () => {
      const tab = tabOf({ providerId: 'codex' });
      const first = resolveTabProjectionExecution(tab, plugin);
      const detach = jest.spyOn(first!, 'detach');

      tab.providerId = 'claude';
      resolveTabProjectionExecution(tab, plugin);

      // A binding left attached draws the old provider's projection into a
      // column the new one is now writing.
      expect(detach).toHaveBeenCalledTimes(1);
    });
  });

  it('drops the turn framing a provider still sends down the content channel', () => {
    // The presenter returns the whole `StreamChunk` union. A turn's shape is
    // what the projection states here, so framing arriving as content would be
    // a second opinion about where this turn begins and ends.
    //
    // Three of the variants this listed no longer exist. `user_message_start`
    // and `assistant_message_start` were deleted with the emitters that put
    // them here, and `status` never had one. What is left of the lifecycle half
    // is the terminal pair, which the filter still has to drop.
    const presented: StreamChunk[] = [
      { type: 'text', content: 'answer' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      { type: 'error', content: 'boom' },
      { type: 'usage', usage: { inputTokens: 1, contextWindow: 2, contextTokens: 1, percentage: 1 } },
    ];
    type BoundSurface = { presentProviderContent(payload: unknown): readonly { type: string }[] };
    let bound: BoundSurface | undefined;
    const tab = tabOf({
      service: {
        surfacePorts: { presentProviderContent: () => presented },
        turnEncoder: {},
      } as never,
    });

    createTabProjectionExecution(tab, {
      settings: {},
      getChatExecution: () => ({
        bindSurface: (surface: BoundSurface) => {
          bound = surface;
          return { detach: () => undefined };
        },
      }),
    } as never);

    expect(bound?.presentProviderContent({}).map((item: { type: string }) => item.type))
      .toEqual(['text', 'tool_use', 'usage']);
  });
});
