import '@/providers';

import {
  createMockStream,
  createSendableDeps,
} from '@test/helpers/inputControllerHarness';

import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';

/**
 * Characterization of today's `ChatRuntime` behavior, as the UI observes it.
 *
 * This suite pins what the current runtime path does — including the defect
 * the migration exists to fix — so the presentation adapter cannot change it
 * by accident. Its sibling, `adapterContractTarget.test.ts`, pins what the
 * adapter must do instead. The two disagree at exactly the defect-fix points,
 * deliberately: merging them would either freeze the defect or silently change
 * the UI.
 *
 * Mapping and rationale: `docs/provider-execution-adapter-contract.md`.
 */
describe('ChatRuntime characterization (current behavior)', () => {
  let deps: InputControllerDeps & { mockAgentService: ReturnType<typeof createSendableDeps>['mockAgentService'] };
  let controller: InputController;

  function prepareSend(text: string): void {
    deps = createSendableDeps();
    deps.mockAgentService.prepareTurn = jest.fn().mockImplementation((request: unknown) => ({
      request,
      prompt: text,
      persistedContent: text,
      isCompact: false,
    }));
    deps.getInputEl().value = text;
    controller = new InputController(deps);
  }

  describe('generator end is the completion signal', () => {
    it('finalizes the turn as completed when the generator simply ends', async () => {
      prepareSend('hello');
      deps.mockAgentService.query = jest
        .fn()
        .mockImplementation(() => createMockStream([{ type: 'text', content: 'hi' }]));

      await controller.sendMessage();

      // No terminal fact is consulted anywhere on this path.
      expect(deps.streamController.finalizeProgressBlocks).toHaveBeenCalledWith(
        expect.anything(),
        'completed',
      );
      expect(deps.conversationController.save).toHaveBeenCalled();
      expect(deps.state.isStreaming).toBe(false);
    });

    it('treats a generator that yields nothing at all as a completed turn', async () => {
      // The sharpest form of the defect: a provider process that dies without
      // emitting anything is indistinguishable from one that answered.
      prepareSend('hello');
      deps.mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([]));

      await controller.sendMessage();

      expect(deps.streamController.finalizeProgressBlocks).toHaveBeenCalledWith(
        expect.anything(),
        'completed',
      );
      expect(deps.conversationController.save).toHaveBeenCalled();
    });

    it('stamps a completion time on the assistant message', async () => {
      prepareSend('hello');
      deps.mockAgentService.query = jest
        .fn()
        .mockImplementation(() => createMockStream([{ type: 'text', content: 'hi' }]));

      await controller.sendMessage();

      expect(deps.renderer.updateMessageCompletionTime).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: expect.any(Number) }),
      );
    });
  });

  describe('turn metadata', () => {
    it('consumes turn metadata exactly once per turn', async () => {
      prepareSend('hello');
      deps.mockAgentService.query = jest
        .fn()
        .mockImplementation(() => createMockStream([{ type: 'text', content: 'hi' }]));

      await controller.sendMessage();

      expect(deps.mockAgentService.consumeTurnMetadata).toHaveBeenCalledTimes(1);
    });

    it('consumes turn metadata even when the generator throws', async () => {
      prepareSend('hello');
      deps.mockAgentService.query = jest.fn().mockImplementation(async function* () {
        yield { type: 'text', content: 'partial' };
        throw new Error('provider exploded');
      });

      await controller.sendMessage();

      expect(deps.mockAgentService.consumeTurnMetadata).toHaveBeenCalledTimes(1);
      expect(deps.streamController.appendText).toHaveBeenCalledWith(
        expect.stringContaining('**Error:**'),
      );
    });
  });

  describe('cancellation', () => {
    it('calls cancel() synchronously and never waits for acknowledgement', async () => {
      prepareSend('hello');
      // The executor runs synchronously, so `releaseSecondChunk` is assigned
      // before the generator can await the gate.
      let releaseSecondChunk!: () => void;
      const secondChunkGate = new Promise<void>(resolve => {
        releaseSecondChunk = resolve;
      });
      deps.mockAgentService.query = jest.fn().mockImplementation(async function* () {
        yield { type: 'text', content: 'first' };
        await secondChunkGate;
        yield { type: 'text', content: 'second' };
      });

      const sending = controller.sendMessage();
      await Promise.resolve();
      await Promise.resolve();

      controller.cancelStreaming();

      // cancel() returns void; nothing confirms the provider stopped.
      expect(deps.mockAgentService.cancel).toHaveBeenCalledTimes(1);
      expect(deps.state.cancelRequested).toBe(true);

      releaseSecondChunk();
      await sending;

      expect(deps.streamController.finalizeProgressBlocks).toHaveBeenCalledWith(
        expect.anything(),
        'blocked',
      );
    });

    it('ignores a cancel request when no turn is streaming', () => {
      prepareSend('hello');

      controller.cancelStreaming();

      expect(deps.mockAgentService.cancel).not.toHaveBeenCalled();
    });
  });

  describe('turn preparation', () => {
    it('writes the prepared persisted content back onto the user message', async () => {
      prepareSend('hello');
      deps.mockAgentService.prepareTurn = jest.fn().mockImplementation((request: unknown) => ({
        request,
        prompt: 'hello',
        persistedContent: 'hello, rewritten by the provider',
        isCompact: false,
      }));
      deps.mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([]));

      await controller.sendMessage();

      expect(deps.state.messages.some(message => message.content === 'hello, rewritten by the provider')).toBe(true);
    });
  });
});
