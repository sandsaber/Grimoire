import '@/providers';

import { usesProjectionChat } from '@/app/chat/projectionChatProviders';
import type { StreamChunk } from '@/core/types';
import { createTabProjectionExecution } from '@/features/chat/tabs/tabProjectionExecution';
import type { TabData } from '@/features/chat/tabs/types';

jest.mock('@/app/chat/projectionChatProviders', () => ({
  PROJECTION_CHAT_PROVIDERS: [],
  usesProjectionChat: jest.fn().mockReturnValue(false),
}));

/**
 * Whether a tab takes the projection path, and what it brings if it does.
 *
 * The switch is the whole of the first question: every piece of the path is
 * built and in the bundle, and this is the only place that decides. The second
 * question is what a tab knows that nothing else does — its column, its
 * streaming cursor, and the provider ports its runtime was built with.
 */

const asked = usesProjectionChat as jest.MockedFunction<typeof usesProjectionChat>;

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
  beforeEach(() => {
    asked.mockReturnValue(false);
  });

  it('builds nothing for a provider that is not on the path', () => {
    // The switch, and the reason every tab still runs on the presentation
    // adapter today.
    expect(createTabProjectionExecution(tabOf(), plugin)).toBeNull();
    expect(asked).toHaveBeenCalledWith('claude');
  });

  it('builds nothing for a provider the catalog does not have', () => {
    asked.mockReturnValue(true);

    expect(createTabProjectionExecution(tabOf({ providerId: 'not-a-provider' }), plugin)).toBeNull();
  });

  it('builds nothing before the chat path exists', () => {
    // A restored workspace builds its tabs while `loadSettings` is still
    // running, so the composition may not be there yet. A tab without one runs
    // the legacy path, which is what it would have done anyway.
    asked.mockReturnValue(true);
    const beforeLoad = {
      settings: {},
      getChatExecution: () => {
        throw new Error('Chat execution is not available before plugin load.');
      },
    } as never;

    expect(createTabProjectionExecution(tabOf(), beforeLoad)).toBeNull();
  });

  it('builds one for a provider on the path', () => {
    asked.mockReturnValue(true);

    expect(createTabProjectionExecution(tabOf(), plugin)).not.toBeNull();
  });

  it('drops the turn framing a provider still sends down the content channel', () => {
    // The presenter returns the whole `StreamChunk` union, because
    // `InputController` reads framing off that channel on the legacy path. A
    // turn's shape is what the projection states here, so framing arriving as
    // content would be a second opinion about where this turn begins and ends.
    asked.mockReturnValue(true);
    const presented: StreamChunk[] = [
      { type: 'user_message_start', content: 'typed' },
      { type: 'text', content: 'answer' },
      { type: 'assistant_message_start' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      { type: 'status', content: 'thinking' },
      { type: 'error', content: 'boom' },
      { type: 'done' },
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
