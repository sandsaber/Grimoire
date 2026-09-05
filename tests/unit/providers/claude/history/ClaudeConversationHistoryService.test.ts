import type { ChatMessage, Conversation } from '@/core/types';
import { ClaudeConversationHistoryService } from '@/providers/claude/history/ClaudeConversationHistoryService';

jest.mock('@/providers/claude/history/ClaudeHistoryStore', () => ({
  deleteSDKSession: jest.fn(),
  loadSDKSessionMessages: jest.fn(),
  loadSubagentToolCalls: jest.fn().mockResolvedValue([]),
  locateSDKSessions: jest.fn(),
}));

jest.mock('@/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: { getServices: jest.fn().mockReturnValue(null) },
}));

import {
  loadSDKSessionMessages,
  locateSDKSessions,
} from '@/providers/claude/history/ClaudeHistoryStore';

const USER_UUID = 'f428a7aa-c360-4b0f-9d1e-000000000001';
const ASSISTANT_UUID = 'ecb3966c-cfdb-4790-8a2b-000000000002';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'x',
    role: 'user',
    content: 'who are you?',
    timestamp: 1000,
    ...overrides,
  };
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conv-1',
    providerId: 'claude',
    title: 'Session',
    createdAt: 0,
    updatedAt: 0,
    sessionId: 'session-1',
    messages,
  };
}

function transcriptReturns(messages: ChatMessage[]): void {
  (locateSDKSessions as jest.Mock).mockResolvedValue(
    new Map([['session-1', { availability: 'present', sessionPath: '/tmp/session-1.jsonl' }]]),
  );
  (loadSDKSessionMessages as jest.Mock).mockResolvedValue({ messages, error: null });
}

describe('ClaudeConversationHistoryService.hydrateConversationHistory', () => {
  let service: ClaudeConversationHistoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClaudeConversationHistoryService();
  });

  it('does not append a second copy of a message the transcript already describes', async () => {
    // The transcript keys a message by its own uuid, which never equals the id
    // Grimoire gave it, so only the SDK-side identifiers tie the two together.
    const conv = conversation([
      message({ id: 'msg-1', role: 'user', userMessageId: USER_UUID }),
      message({ id: 'msg-2', role: 'assistant', content: 'I am Claude', timestamp: 1001, assistantMessageId: ASSISTANT_UUID }),
    ]);
    transcriptReturns([
      message({ id: USER_UUID, role: 'user', userMessageId: USER_UUID, timestamp: 1002 }),
      message({ id: 'b9d8d624-1d51-4f46-b000-000000000003', role: 'assistant', content: 'I am Claude', timestamp: 1003, assistantMessageId: ASSISTANT_UUID }),
    ]);

    await service.hydrateConversationHistory(conv, '/vault');

    expect(conv.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('keeps the conversation copy, which is the one the UI and the attachment store refer to', async () => {
    const conv = conversation([
      message({
        id: 'msg-1',
        role: 'user',
        userMessageId: USER_UUID,
        images: [{ id: 'i1', name: 'shot.webp', mediaType: 'image/webp', data: '', hash: 'a'.repeat(64), size: 10, source: 'paste' }],
      }),
    ]);
    transcriptReturns([
      message({
        id: USER_UUID,
        role: 'user',
        userMessageId: USER_UUID,
        timestamp: 1002,
        images: [{ id: 'sdk-img', name: 'image-1', mediaType: 'image/webp', data: 'YmFzZTY0', size: 10, source: 'paste' }],
      }),
    ]);

    await service.hydrateConversationHistory(conv, '/vault');

    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].id).toBe('msg-1');
    expect(conv.messages[0].images?.[0].hash).toBe('a'.repeat(64));
  });

  it('collapses a conversation that was already saved with duplicates', async () => {
    // What a vault holds today: both copies persisted, sharing an identifier.
    const conv = conversation([
      message({ id: 'msg-1', role: 'user', userMessageId: USER_UUID }),
      message({ id: 'msg-2', role: 'assistant', content: 'I am Claude', timestamp: 1001, assistantMessageId: ASSISTANT_UUID }),
      message({ id: USER_UUID, role: 'user', userMessageId: USER_UUID, timestamp: 1002 }),
      message({ id: 'b9d8d624-1d51-4f46-b000-000000000003', role: 'assistant', content: 'I am Claude', timestamp: 1003, assistantMessageId: ASSISTANT_UUID }),
    ]);
    transcriptReturns([]);

    await service.hydrateConversationHistory(conv, '/vault');

    expect(conv.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('still adds transcript messages the conversation has never seen', async () => {
    const conv = conversation([
      message({ id: 'msg-1', role: 'user', userMessageId: USER_UUID }),
    ]);
    transcriptReturns([
      message({ id: USER_UUID, role: 'user', userMessageId: USER_UUID, timestamp: 1002 }),
      message({ id: 'later-uuid', role: 'assistant', content: 'resumed elsewhere', timestamp: 1004 }),
    ]);

    await service.hydrateConversationHistory(conv, '/vault');

    expect(conv.messages.map(m => m.id)).toEqual(['msg-1', 'later-uuid']);
  });

  it('keeps two genuinely repeated prompts apart', async () => {
    // Identical content, different turns: matching on text would lose one.
    const conv = conversation([
      message({ id: 'msg-1', role: 'user', content: 'what is this?', userMessageId: USER_UUID }),
      message({ id: 'msg-3', role: 'user', content: 'what is this?', timestamp: 1005, userMessageId: 'aaaaaaaa-0000-0000-0000-000000000009' }),
    ]);
    transcriptReturns([]);

    await service.hydrateConversationHistory(conv, '/vault');

    expect(conv.messages).toHaveLength(2);
  });

  it('leaves a message with no SDK identifier alone rather than merging it into another', async () => {
    const conv = conversation([
      message({ id: 'msg-1', role: 'assistant', content: 'interrupted', timestamp: 1000 }),
      message({ id: 'msg-2', role: 'assistant', content: 'also interrupted', timestamp: 1001 }),
    ]);
    transcriptReturns([]);

    await service.hydrateConversationHistory(conv, '/vault');

    expect(conv.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2']);
  });
});
