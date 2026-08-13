import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';
import { createApplicationRuntime } from '@/app/runtime/ApplicationRuntimeFactory';
import { ChatInputCommandAdapter } from '@/features/chat/application/ChatInputCommandAdapter';
import { ChatProjectionAttachment } from '@/features/chat/application/ChatProjectionAttachment';
import { ChatProjectionViewController } from '@/features/chat/application/ChatProjectionViewController';
import type { ChatProjectionRenderTarget } from '@/features/chat/rendering/ChatProjectionRenderer';
import { ChatProjectionRenderer } from '@/features/chat/rendering/ChatProjectionRenderer';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('ChatProjectionViewController', () => {
  it('loads a conversation and detaches without owning lifecycle', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });
    // Create a conversation in the revisioned repository so loadConversation succeeds.
    await composition.conversations.create({
      id: 'conversation-1',
      providerId: 'claude',
      title: 'Test',
      createdAt: 1,
      updatedAt: 1,
      sessionId: null,
      messages: [],
    });
    await runtime.start();

    const target: ChatProjectionRenderTarget = { replace: () => undefined };
    const source = {
      attach: async (_conversationId: string, _listener: (p: never) => void) => () => undefined,
    };
    const attachment = new ChatProjectionAttachment(source, 'conversation-1');
    const controller = new ChatProjectionViewController({
      runtime,
      conversationId: 'conversation-1',
      inputAdapter: new ChatInputCommandAdapter(
        { submitTurn: runtime.submitChatTurn.bind(runtime) },
        () => 'cmd-1',
      ),
      renderer: new ChatProjectionRenderer(target),
    }, attachment);

    const projection = await controller.load();
    expect(projection.conversationId).toBe('conversation-1');
    expect(controller.isDisposed).toBe(false);
    controller.detach();
    expect(controller.isDisposed).toBe(true);

    await runtime.shutdown();
  });
});
