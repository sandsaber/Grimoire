import type { ChatMessage, Conversation } from '@/core/types';
import { GrokConversationHistoryService } from '@/providers/grok/history/GrokConversationHistoryService';
import { loadGrokSessionMessages } from '@/providers/grok/history/GrokHistoryStore';

jest.mock('@/providers/grok/history/GrokHistoryStore', () => ({
  loadGrokSessionMessages: jest.fn(),
  normalizeImportedGrokUserMessage: jest.fn((message: ChatMessage) => message),
}));

const loadGrokSessionMessagesMock = loadGrokSessionMessages as jest.MockedFunction<
  typeof loadGrokSessionMessages
>;

function createConversation(messages: ChatMessage[]): Conversation {
  return {
    createdAt: 1,
    id: 'conv-1',
    messages,
    providerId: 'grok',
    providerState: {
      sessionDirPath: '/tmp/grok-session',
      workspacePath: '/tmp/vault',
    },
    sessionId: 'session-1',
    title: 'Grok chat',
    updatedAt: 2,
  };
}

function createMessage(id: string, role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    content,
    id,
    role,
    timestamp: 1,
  };
}

describe('GrokConversationHistoryService', () => {
  beforeEach(() => {
    loadGrokSessionMessagesMock.mockReset();
  });

  it('keeps a longer Grimoire transcript when Grok never recorded the last question', async () => {
    const service = new GrokConversationHistoryService();
    const conversation = createConversation([
      createMessage('u1', 'user', 'First question'),
      createMessage('a1', 'assistant', 'First answer'),
      createMessage('u2', 'user', 'Question that never reached Grok'),
    ]);
    loadGrokSessionMessagesMock.mockResolvedValue([
      createMessage('u1', 'user', 'First question'),
      createMessage('a1', 'assistant', 'First answer'),
    ]);

    await service.hydrateConversationHistory(conversation, '/tmp/vault');

    expect(conversation.messages).toHaveLength(3);
    expect(conversation.messages[2]?.content).toBe('Question that never reached Grok');
  });

  it('replaces an empty or shorter Grimoire transcript with native Grok history', async () => {
    const service = new GrokConversationHistoryService();
    const conversation = createConversation([]);
    loadGrokSessionMessagesMock.mockResolvedValue([
      createMessage('u1', 'user', 'First question'),
      createMessage('a1', 'assistant', 'First answer'),
    ]);

    await service.hydrateConversationHistory(conversation, '/tmp/vault');

    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[1]?.content).toBe('First answer');
  });
});
