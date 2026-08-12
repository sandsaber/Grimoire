import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ChatInputCommandAdapter } from '@/features/chat/application/ChatInputCommandAdapter';

describe('ChatInputCommandAdapter', () => {
  it('adds command identity and delegates lifecycle ownership to the coordinator', async () => {
    const submitTurn = jest.fn().mockResolvedValue({ commandId: 'command-1' });
    const adapter = new ChatInputCommandAdapter(
      { submitTurn },
      () => 'command-1',
    );

    await adapter.submit({
      conversationId: 'conversation-1',
      backendId: executionBackendId('backend-1'),
      requestRef: 'request-1',
      resultExpectation: 'required',
      userMessage: {
        id: 'user-1',
        role: 'user',
        content: 'hello',
        timestamp: 1,
      },
    });

    expect(submitTurn).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'command-1',
      conversationId: 'conversation-1',
      requestRef: 'request-1',
    }));
  });
});
