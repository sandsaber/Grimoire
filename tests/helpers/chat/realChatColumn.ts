import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { NO_TASK_RESULT_INTERPRETATION } from '@/core/providers/noTaskResultInterpretation';
import { providerCatalog } from '@/core/providers/ProviderCatalog';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage, ContentBlock, StreamChunk } from '@/core/types';
import type { ProviderId } from '@/core/types/provider';
import { StreamController } from '@/features/chat/controllers/StreamController';
import type {
  ChatMessageOperations,
  ChatStreamOperations,
} from '@/features/chat/rendering/ChatSurfaceRenderTarget';
import { SubagentManager } from '@/features/chat/services/SubagentManager';
import { ChatState } from '@/features/chat/state/ChatState';

/**
 * The column a turn is actually drawn into, over a doubled DOM.
 *
 * **The seam both sides stubbed.** `ChatSurfaceRenderTarget` is tested against
 * recording doubles of the column, on the stated grounds that what those calls
 * then do to it is `StreamController`'s own behaviour with three thousand lines
 * of tests behind it. Both halves were right and the *composition* of them was
 * not: which order of calls produces which content blocks was held by nothing,
 * and a turn spent the whole migration cutting every answer into one block per
 * delta — whole in `content`, split mid-word in `contentBlocks`, and still
 * split after a reload, because the blocks are what history draws from.
 *
 * So this is the real controller, the real `ChatState` and the real
 * `SubagentManager`, wired the way `Tab.ts` wires them, recording what it was
 * asked for on the way through. What stays doubled is Obsidian: the elements,
 * the markdown renderer and the vault. That is the line the chat projection
 * smoke already draws — a column that records rather than answers — moved down
 * by one layer, so an assertion can now be about what the column *holds*.
 */

export interface RealChatColumnOptions {
  readonly providerId: ProviderId;
  /** The tab's runtime, as `getAgentService` answers it. Cold until first send. */
  readonly getAgentService?: () => ExecutionChatRuntimeAdapter | null;
  /**
   * The vault the provider is working in.
   *
   * Only the file-tree nudge after a write reads it, and it reads it to make a
   * written path relative — so a column given the wrong root asks about a file
   * outside the vault and says nothing, which is not what the product does.
   */
  readonly vaultPath?: string;
}

export interface RealChatColumn {
  /** The production streaming cursor, holding the turn's messages. */
  readonly state: ChatState;
  readonly controller: StreamController;
  /** The controller, recording what it is asked for. */
  readonly stream: ChatStreamOperations;
  readonly renderer: ChatMessageOperations;
  /** Every chunk the column was handed, in order. */
  readonly chunks: StreamChunk[];
  /** Every stretch of assistant text appended, in order. */
  readonly drawn: string[];
  /** Every stretch of reasoning appended, in order. */
  readonly thought: string[];
  /** The id of each turn the column was told had ended. */
  readonly finished: string[];
  /** Every failure wording rendered. */
  readonly failures: string[];
  /** Every column operation, by name, in the order it was asked for. */
  readonly calls: string[];
  /**
   * Every operation that threw.
   *
   * The render target's queue swallows a failed operation on purpose — one
   * block that threw must not stop the rest of the turn from drawing — so
   * without this a column that could not draw at all reads as a provider that
   * said nothing. Rows assert it is empty.
   */
  readonly thrown: Error[];
  /**
   * The content blocks a message ended up holding.
   *
   * Takes an absent message rather than refusing one, so a row that failed to
   * draw an answer fails on the assertion it is about instead of here.
   */
  blocks(message: ChatMessage | undefined): ContentBlock[];
  /** The text blocks of one message, which is what history redraws from. */
  textBlocks(message: ChatMessage | undefined): Extract<ContentBlock, { type: 'text' }>[];
  /**
   * What the surface does after a turn ends, before it saves.
   *
   * `InputController` closes the open thinking and text blocks in its `finally`
   * block, and *that* is where the last block of an answer is written — the
   * render target's `endTurn` does not close it, and `finishTurn` does not
   * either. A harness that stops before this holds an answer with its final
   * block missing, which is the same blindness in a different place.
   */
  closeOpenBlocks(message?: ChatMessage): Promise<void>;
  /** Releases the timers the controller keeps for a turn. */
  dispose(): void;
}

/** The Obsidian half, doubled: a message element with a content div inside it. */
function messageElement(): MockElement {
  const element = createMockEl();
  element.createDiv({ cls: 'grimoire-message-content' });
  return element;
}

export function createRealChatColumn(options: RealChatColumnOptions): RealChatColumn {
  const chunks: StreamChunk[] = [];
  const drawn: string[] = [];
  const thought: string[] = [];
  const finished: string[] = [];
  const failures: string[] = [];
  const calls: string[] = [];
  const thrown: Error[] = [];

  const state = new ChatState();
  const messagesEl = createMockEl();
  // The real one, built as `Tab.ts` builds it: the interpreter is the provider's
  // own reading of a task result, and the callback is replaced once the
  // controller it feeds exists.
  const subagentManager = new SubagentManager(
    () => undefined,
    providerCatalog().declarations(options.providerId).asyncTaskResults
      ?? NO_TASK_RESULT_INTERPRETATION,
  );
  const controller = new StreamController({
    plugin: {
      settings: {},
      app: {
        vault: {
          // The file-tree nudge after a write, and nothing else: a Write tool
          // result makes the controller ask Obsidian to notice the file, 200ms
          // later and outside any `catch`. Doubled as a vault with nothing in
          // it — a Claude live row found this by throwing out of the timer,
          // which is where it would throw in the product too.
          adapter: {
            basePath: options.vaultPath ?? '/vault',
            list: () => Promise.resolve({ files: [], folders: [] }),
          },
          getAbstractFileByPath: () => null,
          trigger: () => undefined,
        },
      },
    } as never,
    state,
    renderer: {
      renderContent: () => Promise.resolve(),
      addTextCopyButton: () => undefined,
    } as never,
    subagentManager,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => null,
    updateQueueIndicator: () => undefined,
    ...(options.getAgentService ? { getAgentService: options.getAgentService } : {}),
  });
  subagentManager.setCallback(subagent => controller.onAsyncSubagentStateChange(subagent));

  /** Records the call, and the failure the render target's queue would swallow. */
  async function record<T>(name: string, operation: () => Promise<T>): Promise<T> {
    calls.push(name);
    try {
      return await operation();
    } catch (error) {
      thrown.push(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  const stream: ChatStreamOperations = {
    handleStreamChunk: (chunk, message) => {
      chunks.push(chunk);
      return record(`chunk:${chunk.type}`, () => controller.handleStreamChunk(chunk as StreamChunk, message));
    },
    renderTurnFailure: content => {
      failures.push(content);
      return record('renderTurnFailure', () => controller.renderTurnFailure(content));
    },
    finishTurn: message => {
      finished.push(message.id);
      return record('finishTurn', () => controller.finishTurn(message));
    },
    appendText: (text, phase) => {
      drawn.push(text);
      return record('appendText', () => controller.appendText(text, phase));
    },
    appendThinking: content => {
      thought.push(content);
      return record('appendThinking', () => controller.appendThinking(content));
    },
    finalizeCurrentTextBlock: message => record(
      'finalizeCurrentTextBlock',
      () => controller.finalizeCurrentTextBlock(message),
    ),
    finalizeCurrentThinkingBlock: message => record(
      'finalizeCurrentThinkingBlock',
      () => controller.finalizeCurrentThinkingBlock(message),
    ),
    flushPendingToolsForPermission: () => controller.flushPendingToolsForPermission(),
    noteTurnActivity: () => controller.noteTurnActivity(),
    showThinkingIndicator: (text, cls) => controller.showThinkingIndicator(text, cls),
    hideThinkingIndicator: () => controller.hideThinkingIndicator(),
    startTurnSilenceIndicator: providerId => controller.startTurnSilenceIndicator(providerId),
    pauseTurnSilenceIndicator: paused => controller.pauseTurnSilenceIndicator(paused),
    stopTurnSilenceIndicator: () => controller.stopTurnSilenceIndicator(),
  };

  const renderer: ChatMessageOperations = {
    addMessage: () => messageElement() as unknown as HTMLElement,
    renderMessages: () => messagesEl,
  };

  function lastAssistant(): ChatMessage | undefined {
    return [...state.messages].reverse().find(message => message.role === 'assistant');
  }

  return {
    state,
    controller,
    stream,
    renderer,
    chunks,
    drawn,
    thought,
    finished,
    failures,
    calls,
    thrown,
    blocks: message => [...(message?.contentBlocks ?? [])],
    textBlocks: message => (message?.contentBlocks ?? []).filter(
      (block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text',
    ),
    closeOpenBlocks: async message => {
      const target = message ?? lastAssistant();
      if (!target) {
        return;
      }
      await controller.finalizeCurrentThinkingBlock(target);
      await controller.finalizeCurrentTextBlock(target);
    },
    dispose: () => {
      controller.resetStreamingState();
      state.resetStreamingState();
    },
  };
}
