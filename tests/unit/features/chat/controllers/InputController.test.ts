import '@/providers';

import type { createMockInputEl } from '@test/helpers/inputControllerHarness';
import {
  createMockAgentService,
  createMockDeps,
  createMockFileContextManager,
  createMockImageContextManager,
  createMockInstructionModeManager,
  createMockInstructionRefineService,
  createMockStream,
  createMockWelcomeEl,
  createSendableDeps,
} from '@test/helpers/inputControllerHarness';
import { createMockEl } from '@test/helpers/mockElement';
import * as fs from 'fs';
import { Notice } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type { ChatMessage } from '@/core/types';
import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ResumeSessionDropdown } from '@/shared/components/ResumeSessionDropdown';

jest.mock('@/shared/components/ResumeSessionDropdown', () => ({
  ResumeSessionDropdown: jest.fn(),
}));

beforeAll(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
});

const mockNotice = Notice as jest.Mock;


describe('InputController on the projection path', () => {
  /**
   * The branch a provider takes once it is on the projection path.
   *
   * Everything in it is `if (projection)`, so a provider that is not on the
   * path runs the generator loop exactly as it always has — which is every
   * provider today, and which is what makes this a per-provider flip rather
   * than a rewrite.
   */
  let deps: InputControllerDeps;

  function projectionOf(overrides: Record<string, unknown> = {}) {
    return {
      send: jest.fn().mockResolvedValue({
        ticket: {
          started: Promise.resolve({}),
          completion: Promise.resolve({ terminal: { kind: 'succeeded', reason: 'completed' } }),
        },
        userMessage: { content: 'what the provider composed', currentNote: 'Note.md' },
      }),
      cancel: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createMockDeps();
  });

  it('sends through the coordinator and never opens the generator', async () => {
    const projection = projectionOf();
    deps.getProjectionExecution = () => projection as never;
    const inputEl = deps.getInputEl();
    inputEl.value = 'are tomatoes a fruit?';
    const controller = new InputController(deps);

    await controller.sendMessage();

    expect(projection.send).toHaveBeenCalledTimes(1);
    // The generator is the thing this path replaces. One call to it is the
    // whole turn running twice.
    expect(deps.getAgentService?.()?.query).not.toHaveBeenCalled();
  });

  it('draws neither message itself, because the projection draws both', async () => {
    // The question arrives from the projection once the coordinator has made it
    // durable, and the answer as a turn the target opens. Drawing either here
    // would draw it twice — and the question before it was recorded, which is
    // the one thing the barrier exists to stop being possible.
    const projection = projectionOf();
    deps.getProjectionExecution = () => projection as never;
    deps.getInputEl().value = 'are tomatoes a fruit?';
    const controller = new InputController(deps);

    await controller.sendMessage();

    expect(deps.renderer.addMessage).not.toHaveBeenCalled();
  });

  it('takes what the provider composed onto the message it is holding', async () => {
    const projection = projectionOf();
    deps.getProjectionExecution = () => projection as never;
    deps.getInputEl().value = 'are tomatoes a fruit?';
    const controller = new InputController(deps);

    await controller.sendMessage();

    const [, userMessage] = (projection.send).mock.calls[0] as [unknown, ChatMessage];
    expect(userMessage.displayContent).toBe('are tomatoes a fruit?');
    // The surface keeps its own copy in step with what was sent, the way the
    // legacy path overwrites it after preparing the turn.
    expect(userMessage.content).toBe('what the provider composed');
  });

  it('asks the kernel to stop, and does not also cancel the runtime', async () => {
    const projection = projectionOf();
    deps.getProjectionExecution = () => projection as never;
    deps.state.isStreaming = true;
    const controller = new InputController(deps);

    controller.cancelStreaming();

    // The kernel owns the run. Cancelling the runtime as well is a second
    // opinion about a run this tab no longer drives.
    expect(projection.cancel).toHaveBeenCalledTimes(1);
    expect(deps.getAgentService?.()?.cancel).not.toHaveBeenCalled();
  });
});

describe('InputController - Message Queue', () => {
  let controller: InputController;
  let deps: InputControllerDeps;
  let inputEl: ReturnType<typeof createMockInputEl>;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createMockDeps();
    inputEl = deps.getInputEl();
    controller = new InputController(deps);
  });

  describe('Queuing messages while streaming', () => {
    it('should queue message when isStreaming is true', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'queued message';

      await controller.sendMessage();

      expect(deps.state.queuedMessage).toMatchObject({
        content: 'queued message',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      });
      expect(deps.state.queuedMessage?.turnRequest).toMatchObject({
        text: 'queued message',
        editorSelection: null,
        browserSelection: null,
        canvasSelection: null,
      });
      expect(inputEl.value).toBe('');
    });

    it('should queue message with images when streaming', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'queued with images';
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(true);
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue(mockImages);

      await controller.sendMessage();

      expect(deps.state.queuedMessage).toMatchObject({
        content: 'queued with images',
        images: mockImages,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      });
      expect(deps.state.queuedMessage?.turnRequest).toMatchObject({
        text: 'queued with images',
        images: mockImages,
      });
      expect(imageContextManager.clearImages).toHaveBeenCalled();
    });

    it('should append new message to existing queued message', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'first message';
      await controller.sendMessage();

      inputEl.value = 'second message';
      await controller.sendMessage();

      expect(deps.state.queuedMessage!.content).toBe('first message\n\nsecond message');
    });

    it('should merge images when appending to queue', async () => {
      deps.state.isStreaming = true;
      const imageContextManager = deps.getImageContextManager()!;

      inputEl.value = 'first';
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(true);
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue([{ id: 'img1' }]);
      await controller.sendMessage();

      inputEl.value = 'second';
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue([{ id: 'img2' }]);
      await controller.sendMessage();

      expect(deps.state.queuedMessage!.images).toHaveLength(2);
      expect(deps.state.queuedMessage!.images![0].id).toBe('img1');
      expect(deps.state.queuedMessage!.images![1].id).toBe('img2');
    });

    it('should not queue empty message', async () => {
      deps.state.isStreaming = true;
      inputEl.value = '';
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(false);

      await controller.sendMessage();

      expect(deps.state.queuedMessage).toBeNull();
    });
  });

  describe('Queued message processing', () => {
    it('should send queued message in non-plan mode', async () => {
      jest.useFakeTimers();
      try {
        deps.plugin.settings.permissionMode = 'normal';
        deps.state.queuedMessage = {
          content: 'queued plan',
          images: undefined,
          editorContext: null,
          canvasContext: null,
        };

        const sendSpy = jest.spyOn(controller, 'sendMessage').mockResolvedValue(undefined);

        (controller as any).processQueuedMessage();
        jest.runAllTimers();
        await Promise.resolve();

        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
          content: 'queued plan',
          turnRequestOverride: expect.objectContaining({
            text: 'queued plan',
            editorSelection: null,
            canvasSelection: null,
          }),
        }));
        sendSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Queue indicator UI', () => {
    it('should show queue indicator when message is queued', () => {
      deps.state.queuedMessage = { content: 'test message', images: undefined, editorContext: null, canvasContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.querySelector('.grimoire-queue-indicator-text')?.textContent).toBe('⌙ Queued: test message');
      expect(queueIndicatorEl.style.display).toBe('flex');
    });

    it('should hide queue indicator when no message is queued', () => {
      deps.state.queuedMessage = null;

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.style.display).toBe('none');
    });

    it('should withdraw queued message to the composer for editing', () => {
      const mockImages = [{ id: 'img1', name: 'queued.png' }];
      const draftImages = [{ id: 'img2', name: 'draft.png' }];
      deps.state.queuedMessage = {
        content: 'queued content',
        images: mockImages as any,
        editorContext: null,
        canvasContext: null,
      };
      inputEl.value = 'draft content';
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue(draftImages);

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      const editButton = queueIndicatorEl
        .querySelectorAll('.grimoire-queue-indicator-icon-action')
        .find((button: any) => button.getAttribute('aria-label') === 'Edit queued message');
      editButton?.click();

      expect(deps.state.queuedMessage).toBeNull();
      expect(inputEl.value).toBe('queued content\n\ndraft content');
      expect(imageContextManager.setImages).toHaveBeenCalledWith([...mockImages, ...draftImages]);
      expect(deps.resetInputHeight).toHaveBeenCalled();
      expect(inputEl.focus).toHaveBeenCalled();
      expect(queueIndicatorEl.style.display).toBe('none');
    });

    it('should discard queued message without changing the composer', () => {
      deps.state.queuedMessage = {
        content: 'queued content',
        images: undefined,
        editorContext: null,
        canvasContext: null,
      };
      inputEl.value = 'draft content';

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      const discardButton = queueIndicatorEl
        .querySelectorAll('.grimoire-queue-indicator-icon-action')
        .find((button: any) => button.getAttribute('aria-label') === 'Discard queued message');
      discardButton?.click();

      expect(deps.state.queuedMessage).toBeNull();
      expect(inputEl.value).toBe('draft content');
      expect(queueIndicatorEl.style.display).toBe('none');
    });

    it('should truncate long message preview in indicator', () => {
      const longMessage = 'a'.repeat(100);
      deps.state.queuedMessage = { content: longMessage, images: undefined, editorContext: null, canvasContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      const text = queueIndicatorEl.querySelector('.grimoire-queue-indicator-text')?.textContent as string;
      expect(text).toContain('...');
    });

    it('should include [images] when queue message has images', () => {
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      deps.state.queuedMessage = { content: 'queued content', images: mockImages as any, editorContext: null, canvasContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      const text = queueIndicatorEl.querySelector('.grimoire-queue-indicator-text')?.textContent as string;
      expect(text).toContain('queued content');
      expect(text).toContain('[images]');
    });

    it('should show [images] when queue message has only images', () => {
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      deps.state.queuedMessage = { content: '', images: mockImages as any, editorContext: null, canvasContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.querySelector('.grimoire-queue-indicator-text')?.textContent).toBe('⌙ Queued: [images]');
    });

    it('should show Codex steer action when queued message can be steered', () => {
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.getCapabilities = jest.fn().mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: false,
        supportsFork: true,
        supportsProviderCommands: false,
        supportsTurnSteer: true,
        reasoningControl: 'effort',
      });
      deps.state.isStreaming = true;
      deps.state.queuedMessage = { content: 'queued content', images: undefined, editorContext: null, canvasContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')?.textContent).toBe('Steer Now');
    });

    it('should steer the queued Codex message when the action is clicked', async () => {
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.getCapabilities = jest.fn().mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: false,
        supportsFork: true,
        supportsProviderCommands: false,
        supportsTurnSteer: true,
        reasoningControl: 'effort',
      });
      mockAgentService.prepareTurn = jest.fn().mockReturnValue({
        request: { text: 'queued follow-up' },
        persistedContent: 'queued follow-up',
        prompt: 'queued follow-up',
        isCompact: false,
        mcpMentions: new Set(),
      });
      mockAgentService.steer = jest.fn().mockResolvedValue(true);

      deps.state.isStreaming = true;
      deps.state.messages = [
        {
          id: 'user-1',
          role: 'user',
          content: 'original',
          displayContent: 'original',
          timestamp: Date.now(),
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        },
      ];
      deps.state.queuedMessage = {
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockAgentService.prepareTurn).toHaveBeenCalledWith(expect.objectContaining({
        text: 'queued follow-up',
      }));
      expect(mockAgentService.steer).toHaveBeenCalled();
      expect(deps.state.queuedMessage).toBeNull();
      expect(queueIndicatorEl.querySelector('.grimoire-queue-indicator-text')?.textContent)
        .toBe('⌙ Steering: queued follow-up');
      expect(queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')).toBeNull();
      expect(queueIndicatorEl.style.display).toBe('flex');
      expect(deps.state.messages).toHaveLength(2);
      expect(deps.state.messages[0]).toMatchObject({
        id: 'user-1',
        role: 'user',
        content: 'original',
        displayContent: 'original',
      });
      expect((deps.renderer as any).addMessage).not.toHaveBeenCalled();
      expect((deps.renderer as any).updateLiveUserMessage).not.toHaveBeenCalled();
    });

    it('should restore the queued message when steering fails', async () => {
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.getCapabilities = jest.fn().mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: false,
        supportsFork: true,
        supportsProviderCommands: false,
        supportsTurnSteer: true,
        reasoningControl: 'effort',
      });
      mockAgentService.prepareTurn = jest.fn().mockReturnValue({
        request: { text: 'queued follow-up' },
        persistedContent: 'queued follow-up',
        prompt: 'queued follow-up',
        isCompact: false,
        mcpMentions: new Set(),
      });
      mockAgentService.steer = jest.fn().mockRejectedValue(new Error('boom'));

      deps.state.isStreaming = true;
      deps.state.queuedMessage = {
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(deps.state.queuedMessage).toEqual({
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      });
      expect(mockNotice).toHaveBeenCalledWith(
        'Failed to steer the queued Codex message. It is still available.',
      );
    });

    it('should not mark the current note as sent when steering is rejected', async () => {
      const fileContextManager = createMockFileContextManager();
      (fileContextManager.getCurrentNotePath).mockReturnValue('notes/session.md');
      (fileContextManager.shouldSendCurrentNote).mockReturnValue(true);
      deps = createSendableDeps({
        getFileContextManager: () => fileContextManager as any,
      });

      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.getCapabilities = jest.fn().mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: false,
        supportsFork: true,
        supportsProviderCommands: false,
        supportsTurnSteer: true,
        reasoningControl: 'effort',
      });
      mockAgentService.prepareTurn = jest.fn().mockReturnValue({
        request: { text: 'queued follow-up', currentNotePath: 'notes/session.md' },
        persistedContent: 'queued follow-up',
        prompt: 'queued follow-up',
        isCompact: false,
        mcpMentions: new Set(),
      });
      mockAgentService.steer = jest.fn().mockResolvedValue(false);

      deps.state.isStreaming = true;
      deps.state.queuedMessage = {
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      };
      controller = new InputController(deps);
      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(fileContextManager.markCurrentNoteSent).not.toHaveBeenCalled();
      expect(deps.state.queuedMessage).toEqual({
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      });
    });

    it('should route subsequent live chunks to a new assistant bubble after steering', async () => {
      deps = createSendableDeps();
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.getCapabilities = jest.fn().mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: false,
        supportsFork: true,
        supportsProviderCommands: false,
        supportsTurnSteer: true,
        reasoningControl: 'effort',
      });
      mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request: {
          ...request,
          currentNotePath: 'notes/steer.md',
        },
        persistedContent: 'persisted steer prompt',
        prompt: request.text,
        isCompact: false,
        mcpMentions: new Set(),
      }));
      mockAgentService.steer = jest.fn().mockResolvedValue(true);

      let releaseSecondChunk: () => void = () => {
        throw new Error('Second chunk gate was not initialized');
      };
      const secondChunkGate = new Promise<void>((resolve) => {
        releaseSecondChunk = () => resolve();
      });
      const firstChunkHandled = new Promise<void>((resolve) => {
        let handledCount = 0;
        (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async () => {
          handledCount += 1;
          if (handledCount === 1) {
            resolve();
          }
        });
      });

      mockAgentService.query = jest.fn().mockImplementation(() => {
        return (async function* () {
          yield { type: 'user_message_start', content: 'first prompt', itemId: 'user-1' };
          yield { type: 'assistant_message_start', itemId: 'assistant-1' };
          yield { type: 'text', content: 'partial' };
          await secondChunkGate;
          yield { type: 'user_message_start', content: 'steer prompt', itemId: 'user-2' };
          yield { type: 'thinking', content: 'thinking after steer' };
          yield { type: 'assistant_message_start', itemId: 'assistant-2' };
          yield { type: 'text', content: 'after steer' };
          yield { type: 'done' };
        })();
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'first prompt';
      controller = new InputController(deps);

      const sendPromise = controller.sendMessage();
      await firstChunkHandled;

      deps.state.queuedMessage = {
        content: 'steer prompt',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
        turnRequest: {
          text: 'steer prompt',
          editorSelection: null,
          browserSelection: null,
          canvasSelection: null,
          vaultSearchContext: {
            query: 'roadmap',
            snippets: [{
              source: {
                id: 'v1',
                path: 'Roadmap.md',
                title: 'Roadmap',
                kind: 'vault-note',
              },
              text: 'Roadmap context',
              score: 10,
              matchedTerms: ['roadmap'],
            }],
          },
        },
      };
      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(deps.state.messages).toHaveLength(2);

      const firstAssistant = deps.state.messages[1];

      releaseSecondChunk();
      await sendPromise;

      expect(deps.state.messages).toHaveLength(4);
      const steerUser = deps.state.messages[2];
      const secondAssistant = deps.state.messages[3];
      expect(steerUser).toMatchObject({
        role: 'user',
        content: 'persisted steer prompt',
        displayContent: 'steer prompt',
        currentNote: 'notes/steer.md',
        vaultSearchContext: {
          query: 'roadmap',
          snippets: [
            expect.objectContaining({
              text: 'Roadmap context',
            }),
          ],
        },
      });
      expect(secondAssistant).toMatchObject({
        role: 'assistant',
      });

      expect(deps.streamController.handleStreamChunk).toHaveBeenNthCalledWith(
        1,
        { type: 'text', content: 'partial' },
        firstAssistant,
      );
      expect(deps.streamController.handleStreamChunk).toHaveBeenNthCalledWith(
        2,
        { type: 'thinking', content: 'thinking after steer' },
        secondAssistant,
      );
      expect(deps.streamController.handleStreamChunk).toHaveBeenNthCalledWith(
        3,
        { type: 'text', content: 'after steer' },
        secondAssistant,
      );
      expect(deps.streamController.finalizeCurrentThinkingBlock).toHaveBeenCalledWith(firstAssistant);
      expect(deps.streamController.finalizeCurrentTextBlock).toHaveBeenCalledWith(firstAssistant);
      expect(queueIndicatorEl.style.display).toBe('none');
    });

    it('should discard the empty assistant placeholder when steer lands before assistant output', async () => {
      deps = createSendableDeps();
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.getCapabilities = jest.fn().mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: false,
        supportsFork: true,
        supportsProviderCommands: false,
        supportsTurnSteer: true,
        reasoningControl: 'effort',
      });
      mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request: {
          ...request,
          currentNotePath: 'notes/steer.md',
        },
        persistedContent: request.text === 'steer prompt'
          ? 'persisted steer prompt'
          : request.text,
        prompt: request.text,
        isCompact: false,
        mcpMentions: new Set(),
      }));
      mockAgentService.steer = jest.fn().mockResolvedValue(true);

      let releaseSecondChunk: () => void = () => {
        throw new Error('Second chunk gate was not initialized');
      };
      const secondChunkGate = new Promise<void>((resolve) => {
        releaseSecondChunk = () => resolve();
      });
      mockAgentService.query = jest.fn().mockImplementation(() => {
        return (async function* () {
          yield { type: 'user_message_start', content: 'first prompt', itemId: 'user-1' };
          await secondChunkGate;
          yield { type: 'user_message_start', content: 'steer prompt', itemId: 'user-2' };
          yield { type: 'assistant_message_start', itemId: 'assistant-2' };
          yield { type: 'text', content: 'after steer' };
          yield { type: 'done' };
        })();
      });
      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content += chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'first prompt';
      controller = new InputController(deps);

      const sendPromise = controller.sendMessage();
      await Promise.resolve();
      await Promise.resolve();

      expect(deps.state.messages).toHaveLength(2);
      const discardedAssistant = deps.state.messages[1];

      deps.state.queuedMessage = {
        content: 'steer prompt',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      };
      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      queueIndicatorEl.querySelector('.grimoire-queue-indicator-action')?.click();
      await Promise.resolve();
      await Promise.resolve();

      releaseSecondChunk();
      await sendPromise;

      expect((deps.renderer as any).removeMessage).toHaveBeenCalledWith(discardedAssistant.id);
      expect(deps.state.messages).toHaveLength(3);
      expect(deps.state.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
      expect(deps.state.messages[1]).toMatchObject({
        content: 'persisted steer prompt',
        displayContent: 'steer prompt',
        currentNote: 'notes/steer.md',
      });
      expect(deps.state.messages[2]).toMatchObject({
        role: 'assistant',
        content: 'after steer',
      });
      expect(deps.streamController.handleStreamChunk).toHaveBeenCalledTimes(2);
      expect(deps.streamController.handleStreamChunk).toHaveBeenNthCalledWith(
        1,
        { type: 'text', content: 'after steer' },
        deps.state.messages[2],
      );
    });
  });

  describe('Clearing queued message', () => {
    it('should clear queued message and update indicator', () => {
      deps.state.queuedMessage = { content: 'test', images: undefined, editorContext: null, canvasContext: null };

      controller.clearQueuedMessage();

      expect(deps.state.queuedMessage).toBeNull();
      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.style.display).toBe('none');
    });
  });

  describe('Cancel streaming', () => {
    it('should clear queue on cancel', () => {
      deps.state.queuedMessage = { content: 'test', images: undefined, editorContext: null, canvasContext: null };
      deps.state.isStreaming = true;

      controller.cancelStreaming();

      expect(deps.state.queuedMessage).toBeNull();
      expect(deps.state.cancelRequested).toBe(true);
      expect((deps as any).mockAgentService.cancel).toHaveBeenCalled();
    });

    it('should restore a pending steer message to input on cancel', () => {
      deps.state.isStreaming = true;
      (controller as any).pendingSteerMessage = {
        content: 'steered follow-up',
        images: undefined,
        editorContext: null,
        browserContext: null,
        canvasContext: null,
      };
      (controller as any).steerInFlight = true;

      controller.cancelStreaming();

      expect(inputEl.value).toBe('steered follow-up');
      expect(deps.state.queuedMessage).toBeNull();
      expect((deps.state.queueIndicatorEl as any).style.display).toBe('none');
      expect((deps as any).mockAgentService.cancel).toHaveBeenCalled();
    });

    it('should not cancel if not streaming', () => {
      deps.state.isStreaming = false;

      controller.cancelStreaming();

      expect((deps as any).mockAgentService.cancel).not.toHaveBeenCalled();
    });
  });

  describe('Sending messages', () => {
    it('should send message, hide welcome, and save conversation', async () => {
      const welcomeEl = createMockWelcomeEl();
      const fileContextManager = createMockFileContextManager();
      const imageContextManager = deps.getImageContextManager()!;

      deps.getWelcomeEl = () => welcomeEl;
      deps.getFileContextManager = () => fileContextManager as any;
      deps.state.currentConversationId = 'conv-1';
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl.value = 'See ![[image.png]]';

      await controller.sendMessage();

      expect(welcomeEl.style.display).toBe('none');
      expect(fileContextManager.startSession).toHaveBeenCalled();
      expect(deps.renderer.addMessage).toHaveBeenCalledTimes(2);
      expect(deps.state.messages).toHaveLength(2);
      // Without XML context tags, content equals displayContent (no <query> wrapper)
      expect(deps.state.messages[0].content).toBe('See ![[image.png]]');
      expect(deps.state.messages[0].displayContent).toBe('See ![[image.png]]');
      expect(deps.state.messages[0].images).toBeUndefined();
      expect(imageContextManager.clearImages).toHaveBeenCalled();
      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Test Title');
      // No user_message_sent in stream → save without clearing resumeAtMessageId
      expect(deps.conversationController.save).toHaveBeenCalledWith(true, undefined);
      expect((deps as any).mockAgentService.query).toHaveBeenCalled();
      expect(deps.streamController.startTurnSilenceIndicator).toHaveBeenCalledWith('claude');
      expect(deps.streamController.noteTurnActivity).toHaveBeenCalledWith();
      expect(deps.streamController.stopTurnSilenceIndicator).toHaveBeenCalledWith();
      expect(deps.state.isStreaming).toBe(false);
    });

    it('should send long chat input without truncating it', async () => {
      deps = createSendableDeps();
      const longMessage = 'long-chat-input '.repeat(1500);
      (deps as any).mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request,
        prompt: request.text,
        isCompact: false,
      }));
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = longMessage;
      controller = new InputController(deps);

      await controller.sendMessage();

      const userMessage = deps.state.messages.find(message => message.role === 'user');
      const queryArg = ((deps as any).mockAgentService.query as jest.Mock).mock.calls[0]?.[0];
      expect(userMessage?.displayContent).toBe(longMessage.trim());
      expect(queryArg.prompt).toBe(longMessage.trim());
    });

    it('should persist replay-safe user content instead of transport-only prompt', async () => {
      deps = createSendableDeps();
      (deps as any).mockAgentService.prepareTurn = jest.fn().mockReturnValue({
        request: { text: '@server-a hello' },
        persistedContent: '@server-a hello',
        prompt: '@server-a MCP hello',
        isCompact: false,
        mcpMentions: new Set(['server-a']),
      });
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = '@server-a hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.state.messages[0].content).toBe('@server-a hello');
      expect(deps.state.messages[0].content).not.toBe('@server-a MCP hello');
    });

    it('should prepend current note only once per session', async () => {
      const prompts: string[] = [];
      let currentNoteSent = false;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('notes/session.md'),
        shouldSendCurrentNote: jest.fn().mockImplementation(() => !currentNoteSent),
        markCurrentNoteSent: jest.fn().mockImplementation(() => { currentNoteSent = true; }),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };

      deps.getFileContextManager = () => fileContextManager as any;
      (deps as any).mockAgentService.query = jest.fn().mockImplementation((turn: any) => {
        prompts.push(turn.prompt);
        return createMockStream([{ type: 'done' }]);
      });

      inputEl.value = 'First message';
      await controller.sendMessage();

      inputEl.value = 'Second message';
      await controller.sendMessage();

      expect(prompts[0]).toContain('<current_note>');
      expect(prompts[1]).not.toContain('<current_note>');
    });

    it('should not persist currentNote metadata for /compact turns', async () => {
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('notes/session.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };

      deps = createSendableDeps({
        getFileContextManager: () => fileContextManager as any,
      });
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = '/compact';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.state.messages[0].content).toBe('/compact');
      expect(deps.state.messages[0].currentNote).toBeUndefined();
    });

    it('should include MCP options in query when mentions are present', async () => {
      const mcpMentions = new Set(['server-a']);
      const enabledServers = new Set(['server-b']);

      (deps as any).mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request,
        persistedContent: request.text,
        prompt: request.text,
        isCompact: false,
        mcpMentions,
      }));
      deps.getMcpServerSelector = () => ({
        getEnabledServers: () => enabledServers,
      }) as any;
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl.value = 'hello';

      await controller.sendMessage();

      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0].enabledMcpServers).toBe(enabledServers);
      const queryCall = ((deps as any).mockAgentService.query as jest.Mock).mock.calls[0];
      expect(queryCall[0].mcpMentions).toBe(mcpMentions);
    });

    it('attaches vault search context for @vault turns', async () => {
      deps = createSendableDeps();
      deps.plugin.settings.contextEngine = {
        vaultSearchEnabled: true,
        vaultSearchMaxResults: 3,
        vaultSearchMaxSnippetChars: 250,
      } as any;
      deps.plugin.settings.excludedTags = ['private'];
      deps.plugin.settings.excludedFolders = ['Archive'];
      const vaultSearchService = {
        extractVaultQuery: jest.fn().mockReturnValue('roadmap'),
        search: jest.fn().mockResolvedValue({
          snippets: [
            {
              source: {
                id: 'v1',
                path: 'Roadmap.md',
                title: 'Roadmap',
                kind: 'vault-note',
              },
              text: 'Roadmap context',
              score: 10,
              matchedTerms: ['roadmap'],
            },
          ],
        }),
      };
      deps.getVaultSearchService = () => vaultSearchService as any;
      (deps as any).mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request,
        persistedContent: request.text,
        prompt: request.text,
        isCompact: false,
        mcpMentions: new Set(),
      }));
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = '@vault roadmap';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(vaultSearchService.extractVaultQuery).toHaveBeenCalledWith('@vault roadmap');
      expect(vaultSearchService.search).toHaveBeenCalledWith({
        raw: 'roadmap',
        terms: ['roadmap'],
        maxResults: 3,
        maxSnippetChars: 250,
        excludedTags: ['private'],
        excludedFolders: ['Archive'],
      });
      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0]).toMatchObject({
        excludedFolders: ['Archive'],
        text: '@vault roadmap',
        vaultSearchContext: {
          query: 'roadmap',
          snippets: [
            expect.objectContaining({
              text: 'Roadmap context',
            }),
          ],
        },
      });
      expect(deps.state.messages[0].displayContent).toBe('@vault roadmap');
      expect(deps.state.messages[0].vaultSearchContext).toEqual({
        query: 'roadmap',
        snippets: [
          expect.objectContaining({
            text: 'Roadmap context',
          }),
        ],
      });
    });

    it('does not search or attach vault context for bare @vault', async () => {
      deps = createSendableDeps();
      const vaultSearchService = {
        extractVaultQuery: jest.fn().mockReturnValue(''),
        search: jest.fn().mockResolvedValue({ snippets: [] }),
      };
      deps.getVaultSearchService = () => vaultSearchService as any;
      (deps as any).mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request,
        persistedContent: request.text,
        prompt: request.text,
        isCompact: false,
        mcpMentions: new Set(),
      }));
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = '@vault';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(vaultSearchService.extractVaultQuery).toHaveBeenCalledWith('@vault');
      expect(vaultSearchService.search).not.toHaveBeenCalled();
      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0]).toMatchObject({
        text: '@vault',
      });
      expect(prepareTurnCall[0].vaultSearchContext).toBeUndefined();
    });

    it('does not search vault context for /compact turns', async () => {
      deps = createSendableDeps();
      const vaultSearchService = {
        extractVaultQuery: jest.fn().mockReturnValue('roadmap'),
        search: jest.fn(),
      };
      deps.getVaultSearchService = () => vaultSearchService as any;
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = '/compact @vault roadmap';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(vaultSearchService.extractVaultQuery).not.toHaveBeenCalled();
      expect(vaultSearchService.search).not.toHaveBeenCalled();
    });

    it('attaches active project workspace context and merges external paths', async () => {
      deps = createSendableDeps();
      const workspace = {
        id: 'workspace-1',
        name: 'Project Alpha',
        systemPrompt: 'Use project conventions.',
        vaultFolders: ['Projects/Alpha'],
        vaultFiles: ['Projects/Alpha/README.md'],
        tags: ['alpha'],
        externalContextPaths: ['/repo', '/shared'],
      };
      deps.getActiveProjectWorkspace = jest.fn().mockReturnValue(workspace) as any;
      deps.getExternalContextSelector = () => ({
        getExternalContexts: () => ['/shared', '/selected'],
        addExternalContext: jest.fn(),
      });
      (deps as any).mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request,
        persistedContent: request.text,
        prompt: request.text,
        isCompact: false,
        mcpMentions: new Set(),
      }));
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0].projectWorkspaceContext).toEqual({ workspace });
      expect(prepareTurnCall[0].externalContextPaths).toEqual(['/shared', '/selected', '/repo']);
      expect(workspace.externalContextPaths).toEqual(['/repo', '/shared']);
      expect(deps.state.messages[0].displayContent).toBe('hello');
    });

    it('removes excluded vault paths from every automatic turn context', async () => {
      const fileContextManager = createMockFileContextManager();
      fileContextManager.getCurrentNotePath.mockReturnValue('Climate/Ocean.md');
      fileContextManager.shouldSendCurrentNote.mockReturnValue(true);
      const workspace = {
        id: 'workspace-1',
        name: 'Mixed workspace',
        systemPrompt: '',
        vaultFolders: ['Climate', 'Projects'],
        vaultFiles: ['Climate/Forecast.md', 'Notes/Keep.md'],
        tags: [],
        externalContextPaths: [],
      };
      deps = createSendableDeps({
        getActiveProjectWorkspace: () => workspace,
        getFileContextManager: () => fileContextManager as any,
        selectionController: {
          getContext: jest.fn().mockReturnValue({
            mode: 'selection',
            notePath: 'Climate/Ocean.md',
            selectedText: 'private selection',
          }),
        } as any,
        canvasSelectionController: {
          getContext: jest.fn().mockReturnValue({
            canvasPath: 'Climate/Map.canvas',
            nodeIds: ['node-1'],
          }),
        } as any,
      });
      deps.plugin.settings.excludedFolders = ['/Climate/'];
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(
        () => createMockStream([{ type: 'done' }]),
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'What is in the vault?';
      controller = new InputController(deps);

      await controller.sendMessage();

      const request = (
        (deps as any).mockAgentService.prepareTurn as jest.Mock
      ).mock.calls[0][0];
      expect(request).toMatchObject({
        canvasSelection: null,
        editorSelection: null,
        excludedFolders: ['Climate'],
      });
      expect(request.currentNotePath).toBeUndefined();
      expect(request.projectWorkspaceContext.workspace).toMatchObject({
        vaultFolders: ['Projects'],
        vaultFiles: ['Notes/Keep.md'],
      });
    });

    it('passes the active project workspace model as a query override', async () => {
      deps = createSendableDeps();
      const workspace = {
        id: 'workspace-1',
        name: 'Project Alpha',
        providerId: 'claude',
        model: 'opus',
        systemPrompt: 'Use project conventions.',
        vaultFolders: [],
        vaultFiles: [],
        tags: [],
        externalContextPaths: [],
      };
      deps.getActiveProjectWorkspace = jest.fn().mockReturnValue(workspace) as any;
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        { model: 'opus' },
      );
    });

    it('passes the active bound-tab model even after the provider default changes', async () => {
      deps = createSendableDeps({
        getActiveProviderSettings: () => ({ model: 'sonnet' }),
      });
      (deps.plugin as any).settings.model = 'opus';
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).toHaveBeenCalledWith(
        expect.anything(), expect.any(Array), { model: 'sonnet' },
      );
    });

    it('routes a blank tab to the project workspace provider before creating the conversation', async () => {
      let activeProviderId = 'claude';
      deps = createSendableDeps({
        getTabProviderId: () => activeProviderId,
        applyProjectWorkspaceRouting: jest.fn().mockImplementation(async ({ providerId }) => {
          activeProviderId = providerId;
          (deps as any).mockAgentService.providerId = providerId;
          return providerId;
        }),
      }, null);
      (deps.plugin as any).settings.providerConfigs = {
        codex: { enabled: true },
      };
      const workspace = {
        id: 'workspace-1',
        name: 'Project Alpha',
        providerId: 'codex',
        model: 'gpt-5.5',
        systemPrompt: '',
        vaultFolders: [],
        vaultFiles: [],
        tags: [],
        externalContextPaths: [],
      };
      deps.getActiveProjectWorkspace = jest.fn().mockReturnValue(workspace) as any;
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.applyProjectWorkspaceRouting).toHaveBeenCalledWith({
        providerId: 'codex',
        model: 'gpt-5.5',
      });
      expect(deps.plugin.createConversation).toHaveBeenCalledWith({
        providerId: 'codex',
        sessionId: undefined,
      });
      expect((deps as any).mockAgentService.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        { model: 'gpt-5.5' },
      );
    });

    it('does not silently send when a bound session has a different workspace provider', async () => {
      deps = createSendableDeps();
      (deps.plugin as any).settings.providerConfigs = {
        codex: { enabled: true },
      };
      const workspace = {
        id: 'workspace-1',
        name: 'Project Alpha',
        providerId: 'codex',
        systemPrompt: '',
        vaultFolders: [],
        vaultFiles: [],
        tags: [],
        externalContextPaths: [],
      };
      deps.getActiveProjectWorkspace = jest.fn().mockReturnValue(workspace) as any;

      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
      expect(mockNotice).toHaveBeenCalledWith(
        expect.stringContaining('this session is bound to Claude'),
      );
    });

    it('does not attach project workspace context or paths for /compact turns', async () => {
      deps = createSendableDeps();
      const workspace = {
        id: 'workspace-1',
        name: 'Project Alpha',
        systemPrompt: 'Use project conventions.',
        vaultFolders: [],
        vaultFiles: [],
        tags: [],
        externalContextPaths: ['/repo'],
      };
      deps.getActiveProjectWorkspace = jest.fn().mockReturnValue(workspace) as any;
      deps.getExternalContextSelector = () => ({
        getExternalContexts: () => ['/selected'],
        addExternalContext: jest.fn(),
      });
      (deps as any).mockAgentService.prepareTurn = jest.fn().mockImplementation((request: any) => ({
        request,
        persistedContent: request.text,
        prompt: request.text,
        isCompact: true,
        mcpMentions: new Set(),
      }));
      (deps as any).mockAgentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl = deps.getInputEl();
      inputEl.value = '/compact summarize';
      controller = new InputController(deps);

      await controller.sendMessage();

      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0].projectWorkspaceContext).toBeUndefined();
      expect(prepareTurnCall[0].externalContextPaths).toEqual(['/selected']);
    });

    it('should append browser selection context when available', async () => {
      const mockAgentService = createMockAgentService();
      const localDeps = createSendableDeps({
        browserSelectionController: {
          getContext: jest.fn().mockReturnValue({
            source: 'surfing-view',
            selectedText: 'selected from browser',
            title: 'Surfing',
          }),
        } as any,
        getAgentService: () => mockAgentService as any,
      });
      const localController = new InputController(localDeps);

      mockAgentService.query.mockImplementation((turn: any) => {
        expect(turn.prompt).toContain('<browser_selection source="surfing-view" title="Surfing">');
        expect(turn.prompt).toContain('selected from browser');
        return createMockStream([{ type: 'done' }]);
      });

      const localInput = localDeps.getInputEl();
      localInput.value = 'Summarize this';

      await localController.sendMessage();

      expect(mockAgentService.query).toHaveBeenCalled();
    });
  });

  describe('Conversation operation guards', () => {
    it('should not send message when isCreatingConversation is true', async () => {
      deps.state.isCreatingConversation = true;
      inputEl.value = 'test message';

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
      // Input should be preserved for retry
      expect(inputEl.value).toBe('test message');
    });

    it('should not send message when isSwitchingConversation is true', async () => {
      deps.state.isSwitchingConversation = true;
      inputEl.value = 'test message';

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
      // Input should be preserved for retry
      expect(inputEl.value).toBe('test message');
    });

    it('should preserve images when blocked by conversation operation', async () => {
      deps.state.isCreatingConversation = true;
      inputEl.value = 'test message';
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(true);
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue(mockImages);

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
      // Images should NOT be cleared
      expect(imageContextManager.clearImages).not.toHaveBeenCalled();
    });
  });

  describe('Title generation', () => {
    it('should set pending status and fallback title after first user message', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };

      // conversationId=null to test the conversation creation path
      deps = createSendableDeps({
        getTitleGenerationService: () => mockTitleService,
      }, null);

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Hello, how can I help?' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.plugin.createConversation).toHaveBeenCalled();
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: 'pending' });
      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Test Title');
    });

    it('should find messages by role, not by index', async () => {
      deps = createSendableDeps();
      deps.plugin.settings.model = 'opus';
      deps.plugin.settings.effortLevel = 'xhigh';

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      const userMsg = deps.state.messages.find(m => m.role === 'user');
      const assistantMsg = deps.state.messages.find(m => m.role === 'assistant');
      expect(userMsg).toBeDefined();
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.responseMetadata).toMatchObject({
        providerId: 'claude',
        providerLabel: 'Claude Code',
        model: 'opus',
        modelLabel: 'Opus 5',
        effort: 'xhigh',
        effortLabel: 'XHigh',
      });
    });

    it('should use active tab provider settings for assistant response metadata', async () => {
      deps = createSendableDeps({
        getTabProviderId: () => 'codex',
      });
      const mockAgentService = (deps as ReturnType<typeof createSendableDeps>).mockAgentService;
      (mockAgentService as any).providerId = 'codex';
      mockAgentService.getCapabilities.mockReturnValue({
        providerId: 'codex',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: true,
        supportsRewind: true,
        supportsFork: true,
        supportsProviderCommands: true,
        supportsTurnSteer: false,
        supportsImageAttachments: true,
        supportsInstructionMode: true,
        supportsMcpTools: true,
        reasoningControl: 'effort',
      });
      deps.plugin.settings.model = 'antigravity';
      deps.plugin.settings.effortLevel = 'medium';
      (deps as any).getActiveProviderSettings = jest.fn().mockReturnValue({
        ...deps.plugin.settings,
        settingsProvider: 'codex',
        model: 'gpt-5.5',
        effortLevel: 'high',
        providerConfigs: {
          codex: { enabled: true },
        },
      });

      mockAgentService.query.mockReturnValue(createMockStream([{ type: 'done' }]));
      inputEl = deps.getInputEl();
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      const assistantMsg = deps.state.messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.responseMetadata).toMatchObject({
        providerId: 'codex',
        providerLabel: 'Codex',
        model: 'gpt-5.5',
        modelLabel: 'GPT-5.5',
        effort: 'high',
        effortLabel: 'High',
      });
    });

    it('should call title generation service when available', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };

      deps = createSendableDeps({
        getTitleGenerationService: () => mockTitleService,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response text' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockTitleService.generateTitle).toHaveBeenCalled();
      const callArgs = mockTitleService.generateTitle.mock.calls[0];
      expect(callArgs[0]).toBe('conv-1');
      expect(callArgs[1]).toContain('Hello world');
    });

    it('should lazily create the conversation with the active runtime provider', async () => {
      const sendableDeps = createSendableDeps({}, null);
      sendableDeps.mockAgentService.providerId = 'codex';
      deps = sendableDeps;
      (deps.plugin.createConversation as jest.Mock).mockResolvedValue({ id: 'conv-codex', providerId: 'codex' });

      (sendableDeps.mockAgentService.query).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response text' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.plugin.createConversation).toHaveBeenCalledWith({
        providerId: 'codex',
        sessionId: undefined,
      });
    });

    it('should prefer the blank-tab provider over a stale runtime when lazily creating a conversation', async () => {
      const sendableDeps = createSendableDeps({
        getTabProviderId: () => 'claude',
      }, null);
      sendableDeps.mockAgentService.providerId = 'codex';
      deps = sendableDeps;
      (deps.plugin.createConversation as jest.Mock).mockResolvedValue({ id: 'conv-claude', providerId: 'claude' });

      (sendableDeps.mockAgentService.query).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response text' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.plugin.createConversation).toHaveBeenCalledWith({
        providerId: 'claude',
        sessionId: undefined,
      });
    });

    it('should not overwrite user-renamed title in callback', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };

      deps = createSendableDeps({
        getTitleGenerationService: () => mockTitleService,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      // Simulate user having renamed the conversation
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        title: 'User Custom Title',
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Test';
      controller = new InputController(deps);

      await controller.sendMessage();

      const callback = mockTitleService.generateTitle.mock.calls[0][2];
      await callback('conv-1', { success: true, title: 'AI Generated Title' });

      // Should clear status since user manually renamed (not apply AI title)
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: undefined });
    });

    it('should not set pending status when titleService is null', async () => {
      deps = createSendableDeps({
        getTitleGenerationService: () => null,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      const updateCalls = (deps.plugin.updateConversation as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((call: [string, { titleGenerationStatus?: string }]) =>
        call[1]?.titleGenerationStatus === 'pending'
      );
      expect(pendingCall).toBeUndefined();
    });

    it('should NOT call title generation service when enableAutoTitleGeneration is false', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };

      deps = createSendableDeps({
        getTitleGenerationService: () => mockTitleService,
      });
      deps.plugin.settings.enableAutoTitleGeneration = false;

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response text' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();

      const updateCalls = (deps.plugin.updateConversation as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((call: [string, { titleGenerationStatus?: string }]) =>
        call[1]?.titleGenerationStatus === 'pending'
      );
      expect(pendingCall).toBeUndefined();

      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Test Title');
    });
  });

  describe('Auto-hide status panels on response end', () => {
    it('should clear currentTodos when all todos are completed', async () => {
      deps = createSendableDeps();
      deps.state.currentTodos = [
        { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
        { content: 'Task 2', status: 'completed', activeForm: 'Task 2' },
      ];

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.state.currentTodos).toBeNull();
    });

    it('should NOT clear currentTodos when some todos are pending', async () => {
      deps = createSendableDeps();
      deps.state.currentTodos = [
        { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
        { content: 'Task 2', status: 'pending', activeForm: 'Task 2' },
      ];

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.state.currentTodos).not.toBeNull();
      expect(deps.state.currentTodos).toHaveLength(2);
    });

    it('should handle null statusPanel gracefully', async () => {
      deps = createSendableDeps({
        getStatusPanel: () => null,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await expect(controller.sendMessage()).resolves.not.toThrow();
    });
  });

  describe('Approval inline tracking', () => {
    it('should dismiss pending inline and clear reference', () => {
      controller = new InputController(deps);
      const mockInline = { destroy: jest.fn() };
      (controller as any).pendingApprovalInline = mockInline;

      controller.dismissPendingApproval();

      expect(mockInline.destroy).toHaveBeenCalled();
      expect((controller as any).pendingApprovalInline).toBeNull();
    });

    it('should dismiss pending ask inline and clear reference', () => {
      controller = new InputController(deps);
      const mockAskInline = { destroy: jest.fn() };
      (controller as any).pendingAskInline = mockAskInline;

      controller.dismissPendingApproval();

      expect(mockAskInline.destroy).toHaveBeenCalled();
      expect((controller as any).pendingAskInline).toBeNull();
    });

    it('should dismiss both approval and ask inlines', () => {
      controller = new InputController(deps);
      const mockApproval = { destroy: jest.fn() };
      const mockAsk = { destroy: jest.fn() };
      (controller as any).pendingApprovalInline = mockApproval;
      (controller as any).pendingAskInline = mockAsk;

      controller.dismissPendingApproval();

      expect(mockApproval.destroy).toHaveBeenCalled();
      expect(mockAsk.destroy).toHaveBeenCalled();
      expect((controller as any).pendingApprovalInline).toBeNull();
      expect((controller as any).pendingAskInline).toBeNull();
    });

    it('should be a no-op when no inline is pending', () => {
      controller = new InputController(deps);
      expect((controller as any).pendingApprovalInline).toBeNull();
      expect(() => controller.dismissPendingApproval()).not.toThrow();
    });
  });

  describe('Built-in commands - /add-dir', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('should work on codex tabs', async () => {
      const mockExternalContextSelector = {
        getExternalContexts: jest.fn().mockReturnValue([]),
        addExternalContext: jest.fn().mockReturnValue({ success: true, normalizedPath: '/some/path' }),
      };
      deps.getExternalContextSelector = () => mockExternalContextSelector;
      deps.getAgentService = () => ({
        ...(deps as any).mockAgentService,
        providerId: 'codex',
        getCapabilities: jest.fn().mockReturnValue({
          providerId: 'codex',
          supportsPersistentRuntime: true,
          supportsNativeHistory: true,
          supportsPlanMode: false,
          supportsRewind: false,
          supportsFork: false,
          supportsProviderCommands: false,
          reasoningControl: 'effort',
        }),
      });
      inputEl.value = '/add-dir /some/path';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockExternalContextSelector.addExternalContext).toHaveBeenCalledWith('/some/path');
      expect(mockNotice).toHaveBeenCalledWith('Added external context: /some/path');
    });

    it('should show error notice when external context selector is not available', async () => {
      deps.getExternalContextSelector = () => null;
      inputEl.value = '/add-dir /some/path';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('External context selector not available.');
      expect(inputEl.value).toBe('');
    });

    it('should show success notice when path is added successfully', async () => {
      const mockExternalContextSelector = {
        getExternalContexts: jest.fn().mockReturnValue([]),
        addExternalContext: jest.fn().mockReturnValue({ success: true, normalizedPath: '/some/path' }),
      };
      deps.getExternalContextSelector = () => mockExternalContextSelector;
      inputEl.value = '/add-dir /some/path';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockExternalContextSelector.addExternalContext).toHaveBeenCalledWith('/some/path');
      expect(mockNotice).toHaveBeenCalledWith('Added external context: /some/path');
      expect(inputEl.value).toBe('');
    });

    it('should show error notice when /add-dir is called without path', async () => {
      const mockExternalContextSelector = {
        getExternalContexts: jest.fn().mockReturnValue([]),
        addExternalContext: jest.fn().mockReturnValue({
          success: false,
          error: 'No path provided. Usage: /add-dir /absolute/path',
        }),
      };
      deps.getExternalContextSelector = () => mockExternalContextSelector;
      inputEl.value = '/add-dir';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockExternalContextSelector.addExternalContext).toHaveBeenCalledWith('');
      expect(mockNotice).toHaveBeenCalledWith('No path provided. Usage: /add-dir /absolute/path');
      expect(inputEl.value).toBe('');
    });

    it('should show error notice when path addition fails', async () => {
      const mockExternalContextSelector = {
        getExternalContexts: jest.fn().mockReturnValue([]),
        addExternalContext: jest.fn().mockReturnValue({
          success: false,
          error: 'Path must be absolute. Usage: /add-dir /absolute/path',
        }),
      };
      deps.getExternalContextSelector = () => mockExternalContextSelector;
      inputEl.value = '/add-dir relative/path';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockExternalContextSelector.addExternalContext).toHaveBeenCalledWith('relative/path');
      expect(mockNotice).toHaveBeenCalledWith('Path must be absolute. Usage: /add-dir /absolute/path');
      expect(inputEl.value).toBe('');
    });

    it('should handle /add-dir with home path expansion', async () => {
      const expandedPath = '/Users/test/projects';
      const mockExternalContextSelector = {
        getExternalContexts: jest.fn().mockReturnValue([]),
        addExternalContext: jest.fn().mockReturnValue({ success: true, normalizedPath: expandedPath }),
      };
      deps.getExternalContextSelector = () => mockExternalContextSelector;
      inputEl.value = '/add-dir ~/projects';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockExternalContextSelector.addExternalContext).toHaveBeenCalledWith('~/projects');
      expect(mockNotice).toHaveBeenCalledWith(`Added external context: ${expandedPath}`);
    });

    it('should handle /add-dir with quoted path', async () => {
      const normalizedPath = '/path/with spaces';
      const mockExternalContextSelector = {
        getExternalContexts: jest.fn().mockReturnValue([]),
        addExternalContext: jest.fn().mockReturnValue({ success: true, normalizedPath }),
      };
      deps.getExternalContextSelector = () => mockExternalContextSelector;
      inputEl.value = '/add-dir "/path/with spaces"';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockExternalContextSelector.addExternalContext).toHaveBeenCalledWith('"/path/with spaces"');
      expect(mockNotice).toHaveBeenCalledWith(`Added external context: ${normalizedPath}`);
    });
  });

  describe('Built-in commands - /clear', () => {
    it('should call conversationController.createNew on /clear', async () => {
      (deps.conversationController as any).createNew = jest.fn().mockResolvedValue(undefined);
      inputEl.value = '/clear';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect((deps.conversationController as any).createNew).toHaveBeenCalled();
      expect(inputEl.value).toBe('');
    });
  });

  describe('Built-in commands - /resume', () => {
    const mockConversations = [
      { id: 'conv-1', title: 'Chat 1', createdAt: 1000, updatedAt: 1000, messageCount: 1, preview: '' },
    ];

    let mockDropdownInstance: {
      isVisible: jest.Mock;
      handleKeydown: jest.Mock;
      destroy: jest.Mock;
    };

    beforeEach(() => {
      mockNotice.mockClear();
      mockDropdownInstance = {
        isVisible: jest.fn().mockReturnValue(true),
        handleKeydown: jest.fn().mockReturnValue(false),
        destroy: jest.fn(),
      };
      (ResumeSessionDropdown as jest.Mock).mockImplementation(() => mockDropdownInstance);
    });

    it('should reject /resume when the provider lacks native history support', async () => {
      deps.getAgentService = () => ({
        ...(deps as any).mockAgentService,
        providerId: 'codex',
        getCapabilities: jest.fn().mockReturnValue({
          providerId: 'codex',
          supportsPersistentRuntime: true,
          supportsNativeHistory: false,
          supportsPlanMode: false,
          supportsRewind: false,
          supportsFork: false,
          supportsProviderCommands: false,
          reasoningControl: 'effort',
        }),
      });
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('/resume is not supported by this provider.');
      expect(ResumeSessionDropdown).not.toHaveBeenCalled();
    });

    it('should show notice when no conversations exist', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue([]);
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('No conversations to resume');
      expect(ResumeSessionDropdown).not.toHaveBeenCalled();
      expect(inputEl.value).toBe('');
    });

    it('should create dropdown when conversations exist', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue(mockConversations);
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(ResumeSessionDropdown).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockConversations,
        deps.state.currentConversationId,
        expect.objectContaining({ onSelect: expect.any(Function), onDismiss: expect.any(Function) }),
      );
      expect(controller.isResumeDropdownVisible()).toBe(true);
    });

    it('should call switchTo on select callback', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue(mockConversations);
      (deps.conversationController as any).switchTo = jest.fn().mockResolvedValue(undefined);
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      const callbacks = (ResumeSessionDropdown as jest.Mock).mock.calls[0][4];
      callbacks.onSelect('conv-1');

      expect((deps.conversationController as any).switchTo).toHaveBeenCalledWith('conv-1');
      expect(mockDropdownInstance.destroy).toHaveBeenCalled();
    });

    it('should call openConversation on select callback when provided', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue(mockConversations);
      (deps.conversationController as any).switchTo = jest.fn().mockResolvedValue(undefined);
      deps.openConversation = jest.fn().mockResolvedValue(undefined);
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      const callbacks = (ResumeSessionDropdown as jest.Mock).mock.calls[0][4];
      callbacks.onSelect('conv-1');

      expect(deps.openConversation).toHaveBeenCalledWith('conv-1');
      expect((deps.conversationController as any).switchTo).not.toHaveBeenCalled();
      expect(mockDropdownInstance.destroy).toHaveBeenCalled();
    });

    it('should destroy dropdown on dismiss callback', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue(mockConversations);
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      const callbacks = (ResumeSessionDropdown as jest.Mock).mock.calls[0][4];
      callbacks.onDismiss();

      expect(mockDropdownInstance.destroy).toHaveBeenCalled();
      expect(controller.isResumeDropdownVisible()).toBe(false);
    });

    it('should show notice with error message when openConversation rejects', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue(mockConversations);
      deps.openConversation = jest.fn().mockRejectedValue(new Error('session not found'));
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();

      const callbacks = (ResumeSessionDropdown as jest.Mock).mock.calls[0][4];
      callbacks.onSelect('conv-1');

      await Promise.resolve();

      expect(mockNotice).toHaveBeenCalledWith('Failed to open conversation: session not found');
    });

    it('should destroy existing dropdown before creating new one', async () => {
      (deps.plugin as any).getConversationList = jest.fn().mockReturnValue(mockConversations);
      inputEl.value = '/resume';
      controller = new InputController(deps);

      await controller.sendMessage();
      const firstInstance = mockDropdownInstance;

      // Create new mock instance for second call
      const secondInstance = { isVisible: jest.fn().mockReturnValue(true), handleKeydown: jest.fn(), destroy: jest.fn() };
      (ResumeSessionDropdown as jest.Mock).mockImplementation(() => secondInstance);

      inputEl.value = '/resume';
      await controller.sendMessage();

      expect(firstInstance.destroy).toHaveBeenCalled();
      expect(ResumeSessionDropdown).toHaveBeenCalledTimes(2);
    });
  });

  describe('Built-in commands - /fork', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('should call onForkAll callback when /fork is executed', async () => {
      const mockOnForkAll = jest.fn().mockResolvedValue(undefined);
      deps.onForkAll = mockOnForkAll;
      inputEl.value = '/fork';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockOnForkAll).toHaveBeenCalled();
      expect(inputEl.value).toBe('');
    });

    it('should show notice when onForkAll is not available', async () => {
      deps.onForkAll = undefined;
      inputEl.value = '/fork';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('Fork not available.');
      expect(inputEl.value).toBe('');
    });
  });

  describe('Cancel streaming - restore behavior', () => {
    it('should set cancelRequested and call agent cancel', () => {
      deps.state.isStreaming = true;
      controller = new InputController(deps);

      controller.cancelStreaming();

      expect(deps.state.cancelRequested).toBe(true);
      expect((deps as any).mockAgentService.cancel).toHaveBeenCalled();
    });

    it('should restore queued message to input when cancelling', () => {
      deps.state.isStreaming = true;
      deps.state.queuedMessage = { content: 'restored text', images: undefined, editorContext: null, canvasContext: null };
      controller = new InputController(deps);

      controller.cancelStreaming();

      expect(deps.state.queuedMessage).toBeNull();
      expect(inputEl.value).toBe('restored text');
    });

    it('should restore queued images to image context manager when cancelling', () => {
      deps.state.isStreaming = true;
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      deps.state.queuedMessage = { content: 'msg', images: mockImages as any, editorContext: null, canvasContext: null };

      controller = new InputController(deps);
      controller.cancelStreaming();

      const imageContextManager = deps.getImageContextManager()!;
      expect(imageContextManager.setImages).toHaveBeenCalledWith(mockImages);
    });

    it('should hide thinking indicator when cancelling', () => {
      deps.state.isStreaming = true;
      controller = new InputController(deps);

      controller.cancelStreaming();

      expect(deps.streamController.hideThinkingIndicator).toHaveBeenCalled();
      expect(deps.streamController.stopTurnSilenceIndicator).toHaveBeenCalled();
    });

    it('should be a no-op when not streaming', () => {
      deps.state.isStreaming = false;
      controller = new InputController(deps);

      controller.cancelStreaming();

      expect(deps.state.cancelRequested).toBe(false);
      expect((deps as any).mockAgentService.cancel).not.toHaveBeenCalled();
    });
  });

  describe('ensureServiceInitialized failure', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('should show Notice and reset streaming when ensureServiceInitialized returns false', async () => {
      deps = createSendableDeps({
        ensureServiceInitialized: jest.fn().mockResolvedValue(false),
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('Failed to initialize agent service. Please try again.');
      expect(deps.streamController.hideThinkingIndicator).toHaveBeenCalled();
      expect(deps.state.isStreaming).toBe(false);
      expect(deps.state.hasPendingConversationSave).toBe(true);
      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
    });
  });

  describe('Agent service null', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('should show Notice when getAgentService returns null', async () => {
      deps = createSendableDeps({
        getAgentService: () => null,
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('Agent service not available. Please reload the plugin.');
      expect(deps.state.hasPendingConversationSave).toBe(true);
      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
    });
  });

  describe('Streaming error handling', () => {
    it('should catch errors and display via appendText', async () => {
      deps = createSendableDeps();

      ((deps as any).mockAgentService.query as jest.Mock).mockImplementation(() => {
        throw new Error('Network timeout');
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.streamController.appendText).toHaveBeenCalledWith('\n\n**Error:** Network timeout');
      expect(deps.state.isStreaming).toBe(false);
    });

    it('should handle non-Error thrown values', async () => {
      deps = createSendableDeps();

      ((deps as any).mockAgentService.query as jest.Mock).mockImplementation(() => {
        throw 'string error';
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.streamController.appendText).toHaveBeenCalledWith('\n\n**Error:** Unknown error');
    });
  });

  describe('Stream interruption', () => {
    it('should append interrupted text when cancelRequested is true', async () => {
      deps = createSendableDeps();

      ((deps as any).mockAgentService.query as jest.Mock).mockImplementation(() => {
        return (async function* () {
          // Simulate cancel requested during streaming
          deps.state.cancelRequested = true;
          yield { type: 'text', content: 'partial' };
        })();
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.streamController.appendText).toHaveBeenCalledWith(
        expect.stringContaining('Interrupted')
      );
      expect(deps.state.isStreaming).toBe(false);
      expect(deps.state.cancelRequested).toBe(false);
    });

    it('should append interrupted text when cancelRequested is set after last stream chunk', async () => {
      deps = createSendableDeps();

      ((deps as any).mockAgentService.query as jest.Mock).mockImplementation(() => {
        return (async function* () {
          yield { type: 'text', content: 'partial' };
        })();
      });
      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async () => {
        deps.state.cancelRequested = true;
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(deps.streamController.appendText).toHaveBeenCalledWith(
        expect.stringContaining('Interrupted')
      );
      expect(deps.state.isStreaming).toBe(false);
      expect(deps.state.cancelRequested).toBe(false);
    });
  });

  describe('Duration footer', () => {
    it('should render response duration footer when durationSeconds > 0', async () => {
      deps = createSendableDeps();

      // First call sets responseStartTime; must be non-zero (0 is falsy and skips duration)
      let callCount = 0;
      jest.spyOn(performance, 'now').mockImplementation(() => {
        callCount++;
        // Returns 1000 for responseStartTime, 6000 for elapsed (5 seconds)
        return callCount <= 1 ? 1000 : 6000;
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      const assistantMsg = deps.state.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.durationSeconds).toBe(5);
      expect(assistantMsg!.durationFlavorWord).toBeDefined();
      expect(assistantMsg!.completedAt).toEqual(expect.any(Number));
      expect(deps.renderer.updateMessageCompletionTime).toHaveBeenCalledWith(assistantMsg);

      jest.spyOn(performance, 'now').mockRestore();
    });

    it('should sync to the true bottom after response completion UI updates', async () => {
      const messagesEl = createMockEl();
      messagesEl.scrollTop = 120;
      messagesEl.scrollHeight = 640;
      messagesEl.clientHeight = 400;

      deps = createSendableDeps({
        getMessagesEl: () => messagesEl,
      });

      let callCount = 0;
      jest.spyOn(performance, 'now').mockImplementation(() => {
        callCount++;
        return callCount <= 1 ? 1000 : 6000;
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(messagesEl.scrollTop).toBe(messagesEl.scrollHeight);
      jest.spyOn(performance, 'now').mockRestore();
    });
  });

  describe('External context in query', () => {
    it('should pass externalContextPaths in queryOptions', async () => {
      const externalPaths = ['/external/path1', '/external/path2'];

      deps = createSendableDeps({
        getExternalContextSelector: () => ({
          getExternalContexts: () => externalPaths,
          addExternalContext: jest.fn(),
        }),
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0].externalContextPaths).toEqual(externalPaths);
    });

    it('should pass selected files as context files and expose their parent directories', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-selected-file-'));
      const selectedFile = path.join(tempDir, 'brief.pdf');
      fs.writeFileSync(selectedFile, 'pdf content');

      try {
        deps = createSendableDeps({
          getExternalContextSelector: () => ({
            getExternalContexts: () => [selectedFile],
            addExternalContext: jest.fn(),
          }),
        });

        ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
          createMockStream([{ type: 'done' }])
        );

        inputEl = deps.getInputEl();
        inputEl.value = 'test message';
        controller = new InputController(deps);

        await controller.sendMessage();

        const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
        expect(prepareTurnCall[0].externalContextPaths).toEqual([tempDir]);
        expect(prepareTurnCall[0].contextFiles).toEqual([selectedFile]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should pass pinned vault @mention files as context files alongside the current note', async () => {
      const fileContextManager = {
        ...createMockFileContextManager(),
        getCurrentNotePath: jest.fn().mockReturnValue('notes/target.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        getAttachedFiles: jest.fn().mockReturnValue(new Set([
          'notes/instructions.md',
          'notes/target.md',
        ])),
      };

      deps = createSendableDeps({
        getFileContextManager: () => fileContextManager as any,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'apply these instructions';
      controller = new InputController(deps);

      await controller.sendMessage();

      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0].currentNotePath).toBe('notes/target.md');
      expect(prepareTurnCall[0].contextFiles).toEqual(['notes/instructions.md']);
    });
  });

  describe('Orchestrator mode', () => {
    it('passes the tab orchestrator flag into the prepared turn request', async () => {
      deps = createSendableDeps({
        getOrchestratorMode: () => true,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'plan this work';
      controller = new InputController(deps);

      await controller.sendMessage();

      const prepareTurnCall = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0];
      expect(prepareTurnCall[0].orchestratorMode).toBe(true);
    });
  });

  describe('Editor context', () => {
    it('should append editorContext to prompt when available', async () => {
      const editorContext = {
        notePath: 'test/note.md',
        mode: 'selection' as const,
        selectedText: 'selected text content',
      };

      deps = createSendableDeps();
      (deps.selectionController.getContext as jest.Mock).mockReturnValue(editorContext);

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      const queryCall = ((deps as any).mockAgentService.query as jest.Mock).mock.calls[0];
      const promptSent = queryCall[0].prompt;
      expect(promptSent).toContain('selected text content');
      expect(promptSent).toContain('test/note.md');
    });

    it('should preserve preview selection text without fabricating line attributes', async () => {
      const editorContext = {
        notePath: 'test/note.md',
        mode: 'selection' as const,
        selectedText: '  selected text\nsecond line  ',
        lineCount: 2,
      };

      deps = createSendableDeps();
      (deps.selectionController.getContext as jest.Mock).mockReturnValue(editorContext);

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = 'hello';
      controller = new InputController(deps);

      await controller.sendMessage();

      const queryCall = ((deps as any).mockAgentService.query as jest.Mock).mock.calls[0];
      const promptSent = queryCall[0].prompt;
      expect(promptSent).toContain('<editor_selection path="test/note.md">\n  selected text\nsecond line  \n</editor_selection>');
      expect(promptSent).not.toContain('lines=');
    });
  });

  describe('Built-in commands - unknown', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('should show Notice for unknown built-in command', async () => {
      // Directly call the private method since there's no public API to trigger unknown commands
      controller = new InputController(deps);

      await (controller as any).executeBuiltInCommand({ action: 'nonexistent-command', name: 'nonexistent-command' }, '');

      expect(mockNotice).toHaveBeenCalledWith('Unknown command: nonexistent-command');
    });
  });

  describe('Built-in commands - image generation', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('routes /image through the active runtime with provider-neutral generation instructions', async () => {
      deps = createSendableDeps({
        plugin: {
          ...createMockDeps().plugin,
          settings: {
            permissionMode: 'full_access',
            enableAutoTitleGeneration: false,
            mediaFolder: 'assets/generated',
          },
        } as any,
      });
      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = '/image silver owl in a clockwork forest';
      controller = new InputController(deps);

      await controller.sendMessage();

      const prepareRequest = ((deps as any).mockAgentService.prepareTurn as jest.Mock).mock.calls[0][0];
      expect(prepareRequest.text).toContain('silver owl in a clockwork forest');
      expect(prepareRequest.text).toContain('Use any image-generation capability available to the active CLI/provider');
      expect(prepareRequest.text).toContain('assets/generated');
      expect(deps.state.messages[0].displayContent).toBe('/image silver owl in a clockwork forest');
    });

    it('shows usage notice when /image has no prompt', async () => {
      inputEl.value = '/image';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockNotice).toHaveBeenCalledWith('Usage: /image <prompt>');
      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
    });
  });

  describe('Title generation callback branches', () => {
    it('should rename conversation when title generation callback succeeds', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockImplementation(
          async (convId: string, _user: string, callback: any) => {
            (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
              id: convId,
              title: 'Test Title',
            });
            await callback(convId, { success: true, title: 'AI Generated Title' });
          }
        ),
        cancel: jest.fn(),
      };

      deps = createSendableDeps({
        getTitleGenerationService: () => mockTitleService,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'text', content: 'Response' }, { type: 'done' }])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') msg.content = chunk.content;
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();
      await new Promise(resolve => window.setTimeout(resolve, 0));

      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'AI Generated Title');
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', {
        titleGenerationStatus: 'success',
      });
    });

    it('should mark as failed when title generation callback fails', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockImplementation(
          async (convId: string, _user: string, callback: any) => {
            (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
              id: convId,
              title: 'Test Title',
            });
            await callback(convId, { success: false, title: '' });
          }
        ),
        cancel: jest.fn(),
      };

      deps = createSendableDeps({
        getTitleGenerationService: () => mockTitleService,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'text', content: 'Response' }, { type: 'done' }])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') msg.content = chunk.content;
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();
      await new Promise(resolve => window.setTimeout(resolve, 0));

      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', {
        titleGenerationStatus: 'failed',
      });
    });
  });

  describe('handleApprovalRequest', () => {
    it('docks the permission request over the composer and locks input until a decision', async () => {
      const composerEl = createMockEl();
      composerEl.addClass('grimoire-composer-surface');
      const inputContainerEl = createMockEl();
      inputContainerEl.addClass('grimoire-input-container');
      const sendButtonEl = composerEl.createEl('button', { cls: 'grimoire-send-button' });
      sendButtonEl.removeAttribute('disabled');
      (inputContainerEl).parentElement = composerEl;
      const inputEl = {
        value: '',
        placeholder: 'Ask Grimoire...',
        disabled: false,
        focus: jest.fn(),
      } as unknown as HTMLTextAreaElement;
      const toolEl = createMockEl();
      toolEl.addClass('grimoire-tool-step is-running');
      const toolHeaderEl = toolEl.createDiv({ cls: 'grimoire-tool-header' });
      toolHeaderEl.createSpan({ cls: 'grimoire-tool-summary', text: 'grep -ril "рыб" ~/vault --include="*.md"' });
      const toolResultEl = toolHeaderEl.createSpan({ cls: 'grimoire-tool-result' });
      deps.state.toolCallElements.set('bash-1', toolEl as HTMLElement);

      deps.getInputContainerEl = () => inputContainerEl;
      deps.getInputEl = () => inputEl;
      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'bash',
        { command: 'grep -ril "рыб" ~/vault --include="*.md"' },
        'Recursive case-insensitive search across ~/vault. Reads file contents; makes no changes.',
      );

      expect(deps.streamController.flushPendingToolsForPermission).toHaveBeenCalled();
      expect(deps.streamController.pauseTurnSilenceIndicator).toHaveBeenCalledWith(true);
      expect(composerEl.hasClass('grimoire-composer--asking')).toBe(true);
      expect(toolEl.hasClass('is-awaiting')).toBe(true);
      expect(toolResultEl.textContent).toBe('Awaiting you');
      expect((inputEl as any).disabled).toBe(true);
      expect((inputEl as any).placeholder).toBe('Resolve the request to continue...');
      expect(sendButtonEl.getAttribute('disabled')).toBe('true');

      const cardEl = composerEl.querySelector('.grimoire-permission-request');
      expect(cardEl).not.toBeNull();
      expect(cardEl?.querySelector('.grimoire-permission-title')?.textContent).toBe('Permission required');
      expect(cardEl?.querySelector('.grimoire-permission-tool-label')?.textContent)
        .toBe('grep · рыб, vault');
      expect(cardEl?.querySelector('.grimoire-permission-command-code')?.textContent).toContain('grep -ril "рыб"');

      const allowButton = composerEl.querySelector('.grimoire-permission-button--allow');
      expect(allowButton).not.toBeNull();
      allowButton!.click();

      await expect(approvalPromise).resolves.toBe('allow');
      expect(deps.streamController.pauseTurnSilenceIndicator).toHaveBeenLastCalledWith(false);
      expect(composerEl.hasClass('grimoire-composer--asking')).toBe(false);
      expect(toolEl.hasClass('is-awaiting')).toBe(false);
      expect(toolResultEl.textContent).toBe('');
      expect((inputEl as any).disabled).toBe(false);
      expect((inputEl as any).placeholder).toBe('Ask Grimoire...');
      expect(sendButtonEl.getAttribute('disabled')).toBeNull();
    });

    it('should create inline approval and store as pending', async () => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'bash',
        { command: 'ls -la' },
        'Run shell command'
      );

      expect((controller as any).pendingApprovalInline).not.toBeNull();

      controller.dismissPendingApproval();
      expect((controller as any).pendingApprovalInline).toBeNull();

      const result = await approvalPromise;
      expect(result).toBe('cancel');
    });

    it('auto-allows trusted Obsidian MCP read tools in safe mode without rendering approval UI', async () => {
      deps.plugin.settings.permissionMode = 'normal';
      const inputContainerEl = createMockEl();
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      await expect(controller.handleApprovalRequest(
        'mcp__obsidian__obsidian_simple_search',
        { query: 'рыбы' },
        'Search Obsidian vault',
      )).resolves.toBe('allow');

      expect(deps.streamController.flushPendingToolsForPermission).not.toHaveBeenCalled();
      expect((controller as any).pendingApprovalInline).toBeNull();
    });

    it('still renders approval UI for Obsidian MCP write tools in safe mode', async () => {
      deps.plugin.settings.permissionMode = 'normal';
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'mcp__obsidian__obsidian_append_content',
        { filepath: 'note.md', content: 'new text' },
        'Append note content',
      );

      expect((controller as any).pendingApprovalInline).not.toBeNull();
      controller.dismissPendingApproval();
      await expect(approvalPromise).resolves.toBe('cancel');
    });

    it('should throw when input container has no parent', async () => {
      const inputContainerEl = createMockEl();
      // no parentElement set
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);
      await expect(controller.handleApprovalRequest('bash', {}, 'test'))
        .rejects.toThrow('Input container is detached from DOM');
    });

    it.each([
      ['Deny', 'deny'],
      ['Allow once', 'allow'],
      ['Always allow', 'allow-always'],
    ] as const)('should return "%s" → "%s"', async (optionLabel, expected) => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'bash',
        { command: 'ls -la' },
        'Run shell command',
      );

      const items = parentEl.querySelectorAll('grimoire-ask-item');
      const target = items.find((item: any) => {
        const label = item.querySelector('grimoire-ask-item-label');
        return label?.textContent === optionLabel;
      });
      expect(target).toBeDefined();
      target!.click();

      const result = await approvalPromise;
      expect(result).toBe(expected);
    });

    it('should render header metadata when approvalOptions provided', async () => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'bash',
        { command: 'rm -rf /' },
        'Run dangerous command',
        {
          decisionReason: 'Command is destructive',
          blockedPath: '/usr/bin/rm',
          agentID: 'agent-42',
        },
      );

      const reasonEl = parentEl.querySelector('grimoire-ask-approval-reason');
      expect(reasonEl?.textContent).toBe('Command is destructive');

      const pathEl = parentEl.querySelector('grimoire-ask-approval-blocked-path');
      expect(pathEl?.textContent).toBe('/usr/bin/rm');

      const agentEl = parentEl.querySelector('grimoire-ask-approval-agent');
      expect(agentEl?.textContent).toBe('Agent: agent-42');

      controller.dismissPendingApproval();
      await approvalPromise;
    });

    it('should render provider-supplied approval options and network-specific context', async () => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'Bash',
        { command: 'curl https://api.openai.com' },
        'Allow https access to api.openai.com',
        {
          networkApprovalContext: { host: 'api.openai.com', protocol: 'https' },
          decisionOptions: [
            { label: 'Allow once', decision: 'allow' },
            {
              label: 'Allow similar commands',
              description: 'Approve and store an exec policy amendment.',
              decision: {
                type: 'allow-with-exec-policy-amendment',
                execPolicyAmendment: ['curl', 'https://api.openai.com/*'],
              },
            },
            { label: 'Deny', decision: 'deny' },
          ],
        } as any,
      );

      const descEl = parentEl.querySelector('grimoire-ask-approval-desc');
      expect(descEl?.textContent).toContain('api.openai.com');

      const items = parentEl.querySelectorAll('grimoire-ask-item');
      const labels = items
        .map((item: any) => item.querySelector('grimoire-ask-item-label')?.textContent)
        .filter(Boolean);
      expect(labels).toEqual(expect.arrayContaining([
        'Allow once',
        'Allow similar commands',
        'Deny',
      ]));

      controller.dismissPendingApproval();
      await approvalPromise;
    });

    it.each([
      ['Allow once', 'approval-allow-once'],
      ['Always allow for this project', 'approval-project'],
      ['Always allow for this user', 'approval-user'],
      ['Reject', 'approval-reject'],
    ] as const)(
      'preserves the exact provider option value for "%s"',
      async (optionLabel, optionValue) => {
        const parentEl = createMockEl();
        const inputContainerEl = createMockEl();
        (inputContainerEl).parentElement = parentEl;
        deps.getInputContainerEl = () => inputContainerEl;

        controller = new InputController(deps);

        const approvalPromise = controller.handleApprovalRequest(
          'External Directory',
          { filepath: '/tmp/outside' },
          'OpenCode wants to access a path outside the working directory.',
          {
            decisionOptions: [
              { label: 'Allow once', presentation: 'allow', value: 'approval-allow-once' },
              { label: 'Always allow for this project', presentation: 'always', value: 'approval-project' },
              { label: 'Always allow for this user', presentation: 'always', value: 'approval-user' },
              { label: 'Reject', presentation: 'reject', value: 'approval-reject' },
            ],
          },
        );

        const items = parentEl.querySelectorAll('grimoire-ask-item');
        const target = items.find((item: any) => {
          const label = item.querySelector('grimoire-ask-item-label');
          return label?.textContent === optionLabel;
        });
        expect(target).toBeDefined();
        target!.click();

        await expect(approvalPromise).resolves.toEqual({
          type: 'select-option',
          value: optionValue,
        });
      },
    );

    it('should return provider-specific amendment decisions from supplied approval options', async () => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'Bash',
        { command: 'npm test' },
        'Run test command',
        {
          decisionOptions: [
            {
              label: 'Allow similar commands',
              decision: {
                type: 'allow-with-exec-policy-amendment',
                execPolicyAmendment: ['npm', 'test'],
              },
            },
            { label: 'Deny', decision: 'deny' },
          ],
        } as any,
      );

      const items = parentEl.querySelectorAll('grimoire-ask-item');
      const target = items.find((item: any) => {
        const label = item.querySelector('grimoire-ask-item-label');
        return label?.textContent === 'Allow similar commands';
      });
      expect(target).toBeDefined();
      target!.click();

      await expect(approvalPromise).resolves.toEqual({
        type: 'allow-with-exec-policy-amendment',
        execPolicyAmendment: ['npm', 'test'],
      });
    });

    it('should restore input visibility after overlapping inline prompts are dismissed', async () => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'bash',
        { command: 'ls -la' },
        'Run shell command',
      );
      const askPromise = controller.handleAskUserQuestion({
        questions: [
          {
            question: 'Select one option',
            options: ['Option A', 'Option B'],
          },
        ],
      });

      expect(parentEl.hasClass('grimoire-asking')).toBe(true);

      controller.dismissPendingApproval();

      await expect(approvalPromise).resolves.toBe('cancel');
      await expect(askPromise).resolves.toBeNull();
      expect(parentEl.hasClass('grimoire-asking')).toBe(false);
    });

    it('should keep input hidden until overlapping exit-plan prompt is dismissed', async () => {
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      (inputContainerEl).parentElement = parentEl;
      deps.getInputContainerEl = () => inputContainerEl;

      controller = new InputController(deps);

      const approvalPromise = controller.handleApprovalRequest(
        'bash',
        { command: 'ls -la' },
        'Run shell command',
      );
      const exitPlanPromise = controller.handleExitPlanMode({});

      expect(inputContainerEl.style.display).toBe('none');

      const items = parentEl.querySelectorAll('grimoire-ask-item');
      const allowOnceItem = items.find((item: any) => {
        const label = item.querySelector('grimoire-ask-item-label');
        return label?.textContent === 'Allow once';
      });
      expect(allowOnceItem).toBeDefined();

      allowOnceItem!.click();
      await expect(approvalPromise).resolves.toBe('allow');
      expect(inputContainerEl.style.display).toBe('none');

      controller.dismissPendingApproval();
      await expect(exitPlanPromise).resolves.toBeNull();
      expect(inputContainerEl.style.display).toBe('');
    });
  });

  describe('handleInstructionSubmit', () => {
    it('should create InstructionModal and call refineInstruction', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService({
        refineInstruction: jest.fn().mockResolvedValue({
          success: true,
          refinedInstruction: 'refined instruction',
        }),
      });
      const mockInstructionModeManager = createMockInstructionModeManager();

      deps = createMockDeps({
        getInstructionRefineService: () => mockInstructionRefineService,
        getInstructionModeManager: () => mockInstructionModeManager as any,
      });
      deps.plugin.settings.systemPrompt = '';

      controller = new InputController(deps);

      await controller.handleInstructionSubmit('add logging');

      expect(mockInstructionRefineService.resetConversation).toHaveBeenCalled();
      expect(mockInstructionRefineService.refineInstruction).toHaveBeenCalledWith(
        'add logging',
        ''
      );
    });

    it('should pass the active chat model into instruction refine service', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService({
        refineInstruction: jest.fn().mockResolvedValue({
          success: true,
          refinedInstruction: 'refined instruction',
        }),
      });

      deps = createMockDeps({
        getAuxiliaryModel: () => 'opencode:openai/gpt-5.4',
        getInstructionRefineService: () => mockInstructionRefineService,
      });
      deps.plugin.settings.systemPrompt = '';

      controller = new InputController(deps);

      await controller.handleInstructionSubmit('add logging');

      expect(mockInstructionRefineService.setModelOverride).toHaveBeenCalledWith(
        'opencode:openai/gpt-5.4',
      );
    });

    it('should return early when instructionRefineService is null', async () => {
      deps = createMockDeps({
        getInstructionRefineService: () => null,
      });
      controller = new InputController(deps);

      await expect(controller.handleInstructionSubmit('test')).resolves.not.toThrow();
    });
  });

  describe('processQueuedMessage sends the queued snapshot', () => {
    it('should send images from the queued message without rebuilding composer state', () => {
      jest.useFakeTimers();
      try {
        const mockImages = [{ id: 'img1', name: 'test.png' }];
        deps.state.queuedMessage = {
          content: 'queued content',
          images: mockImages as any,
          editorContext: null,
          canvasContext: null,
        };
        const sendSpy = jest.spyOn(controller, 'sendMessage').mockResolvedValue(undefined);

        (controller as any).processQueuedMessage();
        jest.runAllTimers();

        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
          content: 'queued content',
          images: mockImages,
          turnRequestOverride: expect.objectContaining({
            text: 'queued content',
            images: mockImages,
          }),
        }));
        sendSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Sending messages - edge cases', () => {
    it('should not send empty message without images', async () => {
      inputEl.value = '';
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(false);

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).not.toHaveBeenCalled();
    });

    it('should send message with only images (empty text)', async () => {
      const imageContextManager = createMockImageContextManager();
      (imageContextManager.hasImages).mockReturnValue(true);
      (imageContextManager.getAttachedImages).mockReturnValue([{ id: 'img1', name: 'test.png' }]);

      deps = createSendableDeps({
        getImageContextManager: () => imageContextManager as any,
      });

      ((deps as any).mockAgentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl();
      inputEl.value = '';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect((deps as any).mockAgentService.query).toHaveBeenCalled();
      expect(deps.state.messages).toHaveLength(2);
      expect(deps.state.messages[0].images).toHaveLength(1);
    });
  });

  describe('Stream invalidation', () => {
    it('should break from stream loop and skip cleanup when stream generation changes', async () => {
      deps = createSendableDeps();

      ((deps as any).mockAgentService.query as jest.Mock).mockImplementation(() => {
        return (async function* () {
          yield { type: 'text', content: 'partial' };
          // Simulate stream invalidation (e.g. tab closed during stream)
          deps.state.bumpStreamGeneration();
          yield { type: 'text', content: 'should not be processed' };
        })();
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      // The stream was invalidated, so isStreaming should still be true
      // (cleanup was skipped) and no interrupt text should appear
      expect(deps.streamController.appendText).not.toHaveBeenCalledWith(
        expect.stringContaining('Interrupted')
      );
    });
  });

  describe('handleInstructionSubmit - advanced paths', () => {
    it('should show clarification when result has clarification', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService({
        refineInstruction: jest.fn().mockResolvedValue({
          success: true,
          clarification: 'Please clarify what you mean',
        }),
      });
      const mockInstructionModeManager = createMockInstructionModeManager();

      deps = createMockDeps({
        getInstructionRefineService: () => mockInstructionRefineService,
        getInstructionModeManager: () => mockInstructionModeManager as any,
      });
      controller = new InputController(deps);

      await controller.handleInstructionSubmit('ambiguous instruction');

      expect(mockInstructionRefineService.refineInstruction).toHaveBeenCalledWith(
        'ambiguous instruction',
        undefined
      );
    });

    it('should show error when result has no clarification or instruction', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService();
      const mockInstructionModeManager = createMockInstructionModeManager();

      deps = createMockDeps({
        getInstructionRefineService: () => mockInstructionRefineService,
        getInstructionModeManager: () => mockInstructionModeManager as any,
      });
      controller = new InputController(deps);
      mockNotice.mockClear();

      await controller.handleInstructionSubmit('empty result');

      expect(mockNotice).toHaveBeenCalledWith('No instruction received');
      expect(mockInstructionModeManager.clear).toHaveBeenCalled();
    });

    it('should handle cancelled result from refineInstruction', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService({
        refineInstruction: jest.fn().mockResolvedValue({
          success: false,
          error: 'Cancelled',
        }),
      });
      const mockInstructionModeManager = createMockInstructionModeManager();

      deps = createMockDeps({
        getInstructionRefineService: () => mockInstructionRefineService,
        getInstructionModeManager: () => mockInstructionModeManager as any,
      });
      controller = new InputController(deps);

      await controller.handleInstructionSubmit('cancelled instruction');

      expect(mockInstructionModeManager.clear).toHaveBeenCalled();
      expect(mockNotice).not.toHaveBeenCalledWith(expect.stringContaining('Cancelled'));
    });

    it('should handle non-cancelled error from refineInstruction', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService({
        refineInstruction: jest.fn().mockResolvedValue({
          success: false,
          error: 'API Error',
        }),
      });
      const mockInstructionModeManager = createMockInstructionModeManager();

      deps = createMockDeps({
        getInstructionRefineService: () => mockInstructionRefineService,
        getInstructionModeManager: () => mockInstructionModeManager as any,
      });
      controller = new InputController(deps);
      mockNotice.mockClear();

      await controller.handleInstructionSubmit('error instruction');

      expect(mockNotice).toHaveBeenCalledWith('API Error');
      expect(mockInstructionModeManager.clear).toHaveBeenCalled();
    });

    it('should handle exception thrown during refineInstruction', async () => {
      const mockInstructionRefineService = createMockInstructionRefineService({
        refineInstruction: jest.fn().mockRejectedValue(new Error('Unexpected error')),
      });
      const mockInstructionModeManager = createMockInstructionModeManager();

      deps = createMockDeps({
        getInstructionRefineService: () => mockInstructionRefineService,
        getInstructionModeManager: () => mockInstructionModeManager as any,
      });
      controller = new InputController(deps);
      mockNotice.mockClear();

      await controller.handleInstructionSubmit('error instruction');

      expect(mockNotice).toHaveBeenCalledWith('Error: Unexpected error');
      expect(mockInstructionModeManager.clear).toHaveBeenCalled();
    });
  });

  describe('resumeAtMessageId lifecycle', () => {
    beforeEach(() => {
      mockNotice.mockClear();
    });

    it('should call setResumeCheckpoint when resumeAtMessageId points to last assistant (still-needed)', async () => {
      deps = createSendableDeps();
      const { mockAgentService } = deps as any;
      mockAgentService.setResumeCheckpoint = jest.fn();
      mockAgentService.query = jest.fn().mockReturnValue(createMockStream([{ type: 'done' }]));

      // Pre-populate messages: user → assistant (with assistantMessageId matching resumeAtMessageId)
      deps.state.messages = [
        { id: 'msg-u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'u1' },
        { id: 'msg-a1', role: 'assistant', content: 'hi', timestamp: 2, assistantMessageId: 'a1' },
      ];

      // Set conversation with resumeAtMessageId
      (deps.plugin.getConversationSync as any) = jest.fn().mockReturnValue({
        id: 'conv-1',
        resumeAtMessageId: 'a1',
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'follow up';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockAgentService.setResumeCheckpoint).toHaveBeenCalledWith('a1');
      // Should NOT clear metadata eagerly (clearing is done by save(true))
      expect(deps.plugin.updateConversation).not.toHaveBeenCalledWith('conv-1', { resumeAtMessageId: undefined });
    });

    it('should NOT call setResumeCheckpoint when follow-up already exists (stale)', async () => {
      deps = createSendableDeps();
      const { mockAgentService } = deps as any;
      mockAgentService.setResumeCheckpoint = jest.fn();
      mockAgentService.query = jest.fn().mockReturnValue(createMockStream([{ type: 'done' }]));

      // Messages: user → assistant(a1) → user(follow-up) → assistant
      // resumeAtMessageId=a1 is stale because there's a follow-up after a1
      deps.state.messages = [
        { id: 'msg-u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'u1' },
        { id: 'msg-a1', role: 'assistant', content: 'hi', timestamp: 2, assistantMessageId: 'a1' },
        { id: 'msg-u2', role: 'user', content: 'follow up', timestamp: 3, userMessageId: 'u2' },
        { id: 'msg-a2', role: 'assistant', content: 'response', timestamp: 4, assistantMessageId: 'a2' },
      ];

      (deps.plugin.getConversationSync as any) = jest.fn().mockReturnValue({
        id: 'conv-1',
        resumeAtMessageId: 'a1',
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'another message';
      controller = new InputController(deps);

      await controller.sendMessage();

      expect(mockAgentService.setResumeCheckpoint).not.toHaveBeenCalled();
      // Should clear stale metadata
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { resumeAtMessageId: undefined });
    });

    it('should clear resumeAtMessageId on save when turn metadata reports the message was sent', async () => {
      deps = createSendableDeps();
      const { mockAgentService } = deps as any;
      mockAgentService.setResumeCheckpoint = jest.fn();
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ wasSent: true });
      mockAgentService.query = jest.fn().mockReturnValue(
        createMockStream([
          { type: 'text', content: 'hi' },
          { type: 'done' },
        ])
      );

      deps.state.messages = [
        { id: 'msg-u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'u1' },
        { id: 'msg-a1', role: 'assistant', content: 'hi', timestamp: 2, assistantMessageId: 'a1' },
      ];

      (deps.plugin.getConversationSync as any) = jest.fn().mockReturnValue({
        id: 'conv-1',
        resumeAtMessageId: 'a1',
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'follow up';
      controller = new InputController(deps);

      await controller.sendMessage();

      // save(true) should include { resumeAtMessageId: undefined } because the turn metadata reports a sent message
      expect(deps.conversationController.save).toHaveBeenCalledWith(true, { resumeAtMessageId: undefined });
    });

    it('should NOT clear resumeAtMessageId on save when query fails before enqueue', async () => {
      deps = createSendableDeps();
      const { mockAgentService } = deps as any;
      mockAgentService.setResumeCheckpoint = jest.fn();
      // Stream throws before yielding user_message_sent
      mockAgentService.query = jest.fn().mockImplementation(() => {
        throw new Error('Connection failed');
      });

      deps.state.messages = [
        { id: 'msg-u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'u1' },
        { id: 'msg-a1', role: 'assistant', content: 'hi', timestamp: 2, assistantMessageId: 'a1' },
      ];

      (deps.plugin.getConversationSync as any) = jest.fn().mockReturnValue({
        id: 'conv-1',
        resumeAtMessageId: 'a1',
      });

      inputEl = deps.getInputEl();
      inputEl.value = 'follow up';
      controller = new InputController(deps);

      await controller.sendMessage();

      // save(true) should NOT clear resumeAtMessageId because user_message_sent was never received
      expect(deps.conversationController.save).toHaveBeenCalledWith(true, undefined);
    });

    it('should not block send when stale metadata clear fails', async () => {
      deps = createSendableDeps();
      const { mockAgentService } = deps as any;
      mockAgentService.setResumeCheckpoint = jest.fn();
      mockAgentService.query = jest.fn().mockReturnValue(createMockStream([{ type: 'done' }]));

      deps.state.messages = [
        { id: 'msg-u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'u1' },
        { id: 'msg-a1', role: 'assistant', content: 'hi', timestamp: 2, assistantMessageId: 'a1' },
        { id: 'msg-u2', role: 'user', content: 'next', timestamp: 3, userMessageId: 'u2' },
        { id: 'msg-a2', role: 'assistant', content: 'resp', timestamp: 4, assistantMessageId: 'a2' },
      ];

      (deps.plugin.getConversationSync as any) = jest.fn().mockReturnValue({
        id: 'conv-1',
        resumeAtMessageId: 'a1',
      });
      // Make updateConversation throw
      (deps.plugin.updateConversation as jest.Mock).mockRejectedValueOnce(new Error('disk error'));

      inputEl = deps.getInputEl();
      inputEl.value = 'test';
      controller = new InputController(deps);

      // Should not throw
      await expect(controller.sendMessage()).resolves.not.toThrow();
      expect(mockAgentService.query).toHaveBeenCalled();
    });
  });

  describe('Codex plan_completed flow', () => {
    it('opens the Codex approval UI after a successful plan turn', async () => {
      const deps = createSendableDeps({
        restorePrePlanPermissionModeIfNeeded: jest.fn(),
      });
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ planCompleted: true, wasSent: true });
      mockAgentService.query = jest.fn().mockImplementation(() =>
        createMockStream([
          { type: 'text', content: 'Here is my plan...' },
          { type: 'done' },
        ]),
      );
      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan the migration';
      const controller = new InputController(deps);
      const showPlanApproval = jest.spyOn(controller as any, 'showPlanApproval').mockResolvedValue({
        decision: null,
        invalidated: false,
      });

      await controller.sendMessage();

      expect(showPlanApproval).toHaveBeenCalled();
    });

    it('implement restores mode and auto-sends follow-up', async () => {
      const restoreFn = jest.fn();
      const deps = createSendableDeps({
        restorePrePlanPermissionModeIfNeeded: restoreFn,
      });
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn()
        .mockReturnValueOnce({ planCompleted: true, wasSent: true })
        .mockReturnValueOnce({ wasSent: true });

      let callCount = 0;
      mockAgentService.query = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockStream([
            { type: 'text', content: 'Plan content' },
            { type: 'done' },
          ]);
        }
        return createMockStream([{ type: 'done' }]);
      });

      const controller = new InputController(deps);

      // Mock the showPlanApproval to return 'implement'
      (controller as any).showPlanApproval = jest.fn().mockResolvedValue({
        decision: { type: 'implement' },
        invalidated: false,
      });

      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan this feature';
      await controller.sendMessage();
      await new Promise(resolve => window.setTimeout(resolve, 0));

      expect(restoreFn).toHaveBeenCalled();
      // Auto-send should have been triggered
      expect(mockAgentService.query).toHaveBeenCalledTimes(2);
    });

    it('revise keeps plan mode active and populates input', async () => {
      const restoreFn = jest.fn();
      const deps = createSendableDeps({
        restorePrePlanPermissionModeIfNeeded: restoreFn,
      });
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ planCompleted: true, wasSent: true });
      mockAgentService.query = jest.fn().mockImplementation(() =>
        createMockStream([
          { type: 'text', content: 'Plan content' },
          { type: 'done' },
        ]),
      );

      const controller = new InputController(deps);
      (controller as any).showPlanApproval = jest.fn().mockResolvedValue({
        decision: {
          type: 'revise',
          text: 'Add more tests',
        },
        invalidated: false,
      });

      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan this';
      await controller.sendMessage();

      expect(restoreFn).not.toHaveBeenCalled();
      expect(inputEl.value).toBe('Add more tests');
    });

    it('revise does not let queued input overwrite the revision text', async () => {
      const restoreFn = jest.fn();
      const deps = createSendableDeps({
        restorePrePlanPermissionModeIfNeeded: restoreFn,
      });
      deps.state.queuedMessage = {
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        canvasContext: null,
      };

      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ planCompleted: true, wasSent: true });
      mockAgentService.query = jest.fn().mockImplementation(() =>
        createMockStream([
          { type: 'text', content: 'Plan content' },
          { type: 'done' },
        ]),
      );

      const controller = new InputController(deps);
      (controller as any).showPlanApproval = jest.fn().mockResolvedValue({
        decision: { type: 'revise', text: 'Add more tests' },
        invalidated: false,
      });

      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan this';
      await controller.sendMessage();

      expect(restoreFn).not.toHaveBeenCalled();
      expect(inputEl.value).toBe('Add more tests');
      expect(deps.state.queuedMessage).toEqual({
        content: 'queued follow-up',
        images: undefined,
        editorContext: null,
        canvasContext: null,
      });
      expect(mockAgentService.query).toHaveBeenCalledTimes(1);
    });

    it('cancel restores mode and does not auto-send', async () => {
      const restoreFn = jest.fn();
      const deps = createSendableDeps({
        restorePrePlanPermissionModeIfNeeded: restoreFn,
      });
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ planCompleted: true, wasSent: true });
      mockAgentService.query = jest.fn().mockImplementation(() =>
        createMockStream([
          { type: 'text', content: 'Plan content' },
          { type: 'done' },
        ]),
      );

      const controller = new InputController(deps);
      (controller as any).showPlanApproval = jest.fn().mockResolvedValue({
        decision: { type: 'cancel' },
        invalidated: false,
      });

      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan this';
      await controller.sendMessage();

      expect(restoreFn).toHaveBeenCalled();
      expect(mockAgentService.query).toHaveBeenCalledTimes(1);
    });

    it('external dismissal while the approval UI is open bails out without save or restore', async () => {
      const restoreFn = jest.fn();
      const parentEl = createMockEl();
      const inputContainerEl = createMockEl();
      inputContainerEl.parentElement = parentEl;

      const deps = createSendableDeps({
        getInputContainerEl: () => inputContainerEl,
        restorePrePlanPermissionModeIfNeeded: restoreFn,
      });
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ planCompleted: true, wasSent: true });
      mockAgentService.query = jest.fn().mockImplementation(() =>
        createMockStream([
          { type: 'text', content: 'Plan content' },
          { type: 'done' },
        ]),
      );

      const controller = new InputController(deps);
      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan this';

      const sendPromise = controller.sendMessage();
      await new Promise(resolve => window.setTimeout(resolve, 0));

      expect((controller as any).pendingPlanApproval).not.toBeNull();

      controller.dismissPendingApproval();
      await sendPromise;

      expect(restoreFn).not.toHaveBeenCalled();
      expect(deps.conversationController.save).not.toHaveBeenCalled();
      expect(mockAgentService.query).toHaveBeenCalledTimes(1);
    });

    it('null decision (dismiss) restores mode and does not auto-send', async () => {
      const restoreFn = jest.fn();
      const deps = createSendableDeps({
        restorePrePlanPermissionModeIfNeeded: restoreFn,
      });
      const mockAgentService = (deps as any).mockAgentService;
      mockAgentService.providerId = 'codex';
      mockAgentService.consumeTurnMetadata = jest.fn().mockReturnValue({ planCompleted: true, wasSent: true });
      mockAgentService.query = jest.fn().mockImplementation(() =>
        createMockStream([
          { type: 'text', content: 'Plan content' },
          { type: 'done' },
        ]),
      );

      const controller = new InputController(deps);
      (controller as any).showPlanApproval = jest.fn().mockResolvedValue({
        decision: null,
        invalidated: false,
      });

      const inputEl = deps.getInputEl();
      inputEl.value = 'Plan this';
      await controller.sendMessage();

      expect(restoreFn).toHaveBeenCalled();
      expect(mockAgentService.query).toHaveBeenCalledTimes(1);
    });
  });
});
