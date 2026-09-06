import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Menu, Notice, setIcon, setTooltip, TFile } from 'obsidian';

import { asActivatable } from '@/shared/components/activatable';

import type { ProviderHistoryHydration } from '../../../core/providers/ProviderModule';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRewindMode } from '../../../core/runtime/types';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, ImageAttachment, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { getLocale, t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { scheduleAnimationFrame } from '../../../utils/animationFrame';
import { formatDurationMmSs } from '../../../utils/date';
import { hasProcessableWikilink, processFileLinks, registerFileLinkHandler } from '../../../utils/fileLink';
import { replaceImageEmbedsWithHtml } from '../../../utils/imageEmbed';
import {
  escapeMathDelimitersForStreaming,
  normalizeLatexDelimiters,
} from '../../../utils/markdownMath';
import { findRewindContext } from '../rewind';
import { closeTopmostImageViewer, registerOpenImageViewer } from '../ui/imageViewerStack';
import { renderVaultSearchSources } from '../ui/VaultSearchSources';
import { getAssistantResponseProviderLabel } from '../utils/assistantResponseMetadata';
import { localizeReasoningLevel } from '../utils/reasoningDisplay';
import { InlineOrchestratorPlan } from './InlineOrchestratorPlan';
import { renderStoredProgressBlock } from './ProgressBlockRenderer';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';
import {
  canGroupToolCalls,
  isToolCallGroupable,
  renderStoredToolCall,
  renderStoredToolCallGroup,
} from './ToolCallRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';

export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

export interface MessageRendererScrollOptions {
  getScrollEl?: () => HTMLElement;
  shouldAutoScroll?: () => boolean;
  onAutoScrollSuppressed?: () => void;
}

const EARLIEST_PLAUSIBLE_MESSAGE_TIMESTAMP = Date.UTC(2000, 0, 1);

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

function wrapMarkdownTables(el: HTMLElement): void {
  const tables = Array.from(el.querySelectorAll('table'));

  for (const table of tables) {
    const parent = table.parentElement;
    if (!parent || parent.classList.contains('grimoire-table-scroll')) {
      continue;
    }

    const wrapper = parent.createDiv({ cls: 'grimoire-table-scroll' });
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return false;
  }

  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|');

  if (cells.length < 2) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isMarkdownTableHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || isMarkdownTableSeparatorLine(line)) {
    return false;
  }

  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|');

  return cells.length >= 2 && cells.some((cell) => cell.trim().length > 0);
}

function isMarkdownTableLine(line: string): boolean {
  return isMarkdownTableHeaderLine(line) || isMarkdownTableSeparatorLine(line);
}

function normalizePipeTablesForMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fenceMatch = line.match(/^\s*(```|~~~)/);

    if (!inFence && fenceMatch) {
      normalized.push(line);
      inFence = true;
      fenceMarker = fenceMatch[1] ?? '';
      continue;
    }

    if (inFence) {
      normalized.push(line);
      if (fenceMarker && line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    const previousLine = normalized[normalized.length - 1] ?? '';
    const nextLine = lines[index + 1] ?? '';
    const startsTable =
      isMarkdownTableHeaderLine(line) &&
      isMarkdownTableSeparatorLine(nextLine) &&
      previousLine.trim().length > 0 &&
      !isMarkdownTableLine(previousLine);

    if (startsTable) {
      normalized.push('');
    }

    normalized.push(line);
  }

  return normalized.join('\n');
}

export class MessageRenderer {
  private app: App;
  private plugin: GrimoirePlugin;
  private component: Component;
  private messagesEl: HTMLElement;
  private rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  private getCapabilities: () => ProviderCapabilities;
  private forkCallback?: (messageId: string) => Promise<void>;
  private liveMessageEls = new Map<string, HTMLElement>();
  private sessionRestartNoticeEl: HTMLElement | null = null;
  private scrollOptions: MessageRendererScrollOptions;

  constructor(
    plugin: GrimoirePlugin,
    component: Component,
    messagesEl: HTMLElement,
    rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>,
    forkCallback?: (messageId: string) => Promise<void>,
    getCapabilities?: () => ProviderCapabilities,
    scrollOptions: MessageRendererScrollOptions = {},
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.rewindCallback = rewindCallback;
    this.forkCallback = forkCallback;
    this.scrollOptions = scrollOptions;
    this.getCapabilities = getCapabilities ?? (() => ({
      providerId: DEFAULT_CHAT_PROVIDER_ID,
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      supportsTurnSteer: false,
      reasoningControl: 'none' as const,
    }));

    // Register delegated click handler for file links
    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
    this.sessionRestartNoticeEl = null;
  }

  /**
   * Marks the end of the thread as the seam where a saved session was lost.
   *
   * The messages above stay on screen and read like a conversation the agent
   * remembers, which is the part that misleads: it is starting from nothing.
   * Rendered before the user types, because after a turn has been spent the
   * warning has already cost what it was meant to save.
   */
  renderSessionRestartNotice(): void {
    this.clearSessionRestartNotice();

    const noticeEl = this.messagesEl.createDiv({ cls: 'grimoire-session-restart-notice' });
    const boundaryEl = noticeEl.createDiv({ cls: 'grimoire-compact-boundary' });
    boundaryEl.createSpan({
      cls: 'grimoire-compact-boundary-label',
      text: t('chat.ui.messages.sessionRestarted'),
    });
    noticeEl.createDiv({
      cls: 'grimoire-session-restart-notice-hint',
      text: t('chat.ui.messages.sessionRestartedHint'),
    });

    this.sessionRestartNoticeEl = noticeEl;
    this.scrollToBottom();
  }

  /** Removes the session-restart notice if one is currently shown. */
  clearSessionRestartNotice(): void {
    this.sessionRestartNoticeEl?.remove();
    this.sessionRestartNoticeEl = null;
  }

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(this.getCapabilities().providerId, toolName);
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // The notice advises what to do about a session that is about to be
    // replaced; once a turn starts, that has been answered.
    this.clearSessionRestartNotice();

    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (!textToShow) {
        this.scrollToBottomAfterMessage(msg);
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `grimoire-message grimoire-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'grimoire-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'grimoire-text-block' });
        void this.renderContent(textEl, textToShow);
        this.renderUserVaultSearchSources(contentEl, msg);
        this.addUserCopyButton(msgEl, textToShow, msg.completedAt);
      }
      this.liveMessageEls.set(msg.id, msgEl);
    } else if (msg.role === 'assistant') {
      this.renderAssistantResponseMetadata(contentEl, msg);
      this.liveMessageEls.set(msg.id, msgEl);
    }

    this.scrollToBottomAfterMessage(msg);
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.grimoire-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();

    const textToShow = msg.displayContent ?? msg.content;
    if (textToShow) {
      const textEl = contentEl.createDiv({ cls: 'grimoire-text-block' });
      void this.renderContent(textEl, textToShow);
      this.renderUserVaultSearchSources(contentEl, msg);
    }

    const toolbar = msgEl.querySelector<HTMLElement>('.grimoire-user-msg-actions');
    if (toolbar) {
      toolbar.querySelectorAll('.grimoire-user-msg-copy-btn').forEach((el) => el.remove());
    }

    if (textToShow) {
      this.addUserCopyButton(msgEl, textToShow, msg.completedAt);
    }
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  /**
   * Renders all messages for conversation load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string,
    hydration?: ProviderHistoryHydration,
  ): HTMLElement {
    this.messagesEl.empty();
    this.liveMessageEls.clear();
    this.sessionRestartNoticeEl = null;

    // Recreate welcome element after clearing
    const newWelcomeEl = this.messagesEl.createDiv({ cls: 'grimoire-welcome' });
    newWelcomeEl.createDiv({ cls: 'grimoire-welcome-greeting', text: getGreeting() });

    // Above the transcript, which is where the missing turns would have been.
    // Part of the conversation rather than a toast, because a conversation
    // reopened tomorrow is missing exactly as much as it is today.
    this.renderHydrationNotice(hydration);

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return newWelcomeEl;
  }

  /**
   * Says why a transcript is shorter than the conversation it belongs to.
   *
   * Nothing is shown for a conversation that loaded, or for one that never had
   * a provider-side history — an empty new chat must not be captioned. The
   * three that are shown are the ones where the user is looking at less than
   * was said, which until now was silent.
   */
  private renderHydrationNotice(hydration?: ProviderHistoryHydration): void {
    const text = hydrationNoticeText(hydration);
    if (!text) {
      return;
    }
    const noticeEl = this.messagesEl.createDiv({ cls: 'grimoire-history-notice' });
    noticeEl.createSpan({ cls: 'grimoire-history-notice-text', text });
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Bare interrupt marker: user-role interrupts (Claude bracket markers) always render
    // as a standalone indicator. Assistant-role interrupts (Codex partial responses)
    // only use the bare marker when there's no content to preserve.
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return;
    }

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (!textToShow) {
        return;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return;
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `grimoire-message grimoire-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'grimoire-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'grimoire-text-block' });
        void this.renderContent(textEl, textToShow);
        this.renderUserVaultSearchSources(contentEl, msg);
        this.addUserCopyButton(msgEl, textToShow, this.getStoredMessageDisplayTime(msg));
      }
      if (msg.userMessageId && this.isRewindEligible(allMessages, index)) {
        if (this.rewindCallback) {
          this.addRewindButton(msgEl, msg.id);
        }
        if (this.forkCallback) {
          this.addForkButton(msgEl, msg.id);
        }
      }
    } else if (msg.role === 'assistant') {
      this.renderAssistantResponseMetadata(contentEl, msg);
      this.renderAssistantContent(msg, contentEl);
      if (msg.isInterrupt) {
        this.appendInterruptIndicator(contentEl);
      }
      const displayTime = this.getStoredMessageDisplayTime(msg);
      if (displayTime !== undefined) {
        this.applyAssistantCompletionTime(msgEl, displayTime);
      }
    }
  }

  private getStoredMessageDisplayTime(msg: ChatMessage): number | undefined {
    const completedAt = msg.completedAt;
    if (
      typeof completedAt === 'number'
      && Number.isFinite(completedAt)
      && completedAt >= EARLIEST_PLAUSIBLE_MESSAGE_TIMESTAMP
    ) {
      return completedAt;
    }
    return Number.isFinite(msg.timestamp) && msg.timestamp >= EARLIEST_PLAUSIBLE_MESSAGE_TIMESTAMP
      ? msg.timestamp
      : undefined;
  }

  private renderAssistantResponseMetadata(contentEl: HTMLElement, msg: ChatMessage): void {
    const metadata = msg.responseMetadata;
    const providerId = metadata?.providerId ?? this.getCapabilities().providerId;
    const providerLabel = metadata?.providerLabel ?? getAssistantResponseProviderLabel(providerId);
    const parts = [
      providerLabel,
      metadata?.modelLabel,
      metadata?.effortLabel
        ? t('chat.ui.responseMetadata.effort', {
          value: localizeReasoningLevel(metadata.effort ?? metadata.effortLabel, metadata.effortLabel),
        })
        : undefined,
    ].filter((part): part is string => !!part && part.trim().length > 0);

    if (parts.length === 0) {
      return;
    }

    const headerEl = contentEl.createDiv({
      cls: 'grimoire-assistant-response-meta',
      attr: { 'data-provider': providerId },
    });
    headerEl.createSpan({ cls: 'grimoire-assistant-response-dot' });
    parts.forEach((part, index) => {
      if (index > 0) {
        headerEl.createSpan({ cls: 'grimoire-assistant-response-separator', text: '\u00B7' });
      }
      headerEl.createSpan({ cls: 'grimoire-assistant-response-meta-part', text: part });
    });
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    if (msg.content && msg.content.trim().length > 0) return true;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking' && block.content.trim().length > 0) return true;
        if (block.type === 'progress' && (block.content.trim().length > 0 || (block.items?.length ?? 0) > 0)) return true;
        if (block.type === 'text' && block.content.trim().length > 0) return true;
        if (block.type === 'context_compacted') return true;
        if (block.type === 'subagent') return true;
        if (block.type === 'parallel_worker_plan' && block.tasks.length > 0) return true;
        if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall && this.shouldRenderToolCall(toolCall)) return true;
        }
      }
    }
    if (msg.toolCalls?.some(toolCall => this.shouldRenderToolCall(toolCall))) return true;
    return false;
  }

  private isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return !!ctx.prevAssistantUuid && ctx.hasResponse;
  }

  private renderUserVaultSearchSources(contentEl: HTMLElement, msg: ChatMessage): void {
    const vaultSearchContext = msg.vaultSearchContext;
    if (!vaultSearchContext) {
      return;
    }
    renderVaultSearchSources(
      contentEl,
      vaultSearchContext,
      (path) => this.openVaultSearchSource(path),
    );
  }

  private openVaultSearchSource(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t('chat.ui.errors.couldNotOpenFile', { path }));
      return;
    }

    runRendererAction(async () => {
      try {
        await this.app.workspace.getLeaf().openFile(file);
      } catch (error) {
        new Notice(t('chat.ui.errors.openFileFailed', {
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    });
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'grimoire-message grimoire-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'grimoire-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  private appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'grimoire-text-block' });
    textEl.createSpan({ cls: 'grimoire-interrupted', text: t('chat.ui.messages.interrupted') });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'grimoire-interrupted-hint',
      text: t('chat.ui.messages.interruptedHint'),
    });
  }

  /**
   * Renders assistant message content (content blocks or fallback).
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): void {
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();
      const pendingToolGroup: ToolCallInfo[] = [];
      const flushPendingToolGroup = () => {
        this.renderToolCallSequence(contentEl, pendingToolGroup, msg, renderedToolIds);
        pendingToolGroup.length = 0;
      };

      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking') {
          flushPendingToolGroup();
          renderStoredThinkingBlock(
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderContent(el, md)
          );
        } else if (block.type === 'progress') {
          flushPendingToolGroup();
          renderStoredProgressBlock(
            contentEl,
            {
              content: block.content,
              state: block.state === 'running' ? 'completed' : block.state,
              items: block.items,
              durationSeconds: block.durationSeconds,
            },
            (el, md, options) => this.renderContent(el, md, options),
          );
        } else if (block.type === 'text') {
          flushPendingToolGroup();
          // Skip empty or whitespace-only text blocks to avoid extra gaps
          if (!block.content || !block.content.trim()) {
            continue;
          }
          const classes = ['grimoire-text-block'];
          if (block.phase) classes.push(`grimoire-text-block--${block.phase.replace('_', '-')}`);
          const textEl = contentEl.createDiv({ cls: classes.join(' ') });
          void this.renderContent(textEl, block.content);
          this.addTextCopyButton(textEl, block.content);
        } else if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall) {
            if (!this.shouldRenderToolCall(toolCall)) {
              renderedToolIds.add(toolCall.id);
              continue;
            }

            if (isToolCallGroupable(toolCall)) {
              const nextGroup = [...pendingToolGroup, toolCall];
              if (pendingToolGroup.length === 0 || canGroupToolCalls(nextGroup)) {
                pendingToolGroup.push(toolCall);
                continue;
              }

              flushPendingToolGroup();
              pendingToolGroup.push(toolCall);
              continue;
            }

            flushPendingToolGroup();
            this.renderToolCall(contentEl, toolCall, msg);
            renderedToolIds.add(toolCall.id);
          }
        } else if (block.type === 'context_compacted') {
          flushPendingToolGroup();
          const boundaryEl = contentEl.createDiv({ cls: 'grimoire-compact-boundary' });
          boundaryEl.createSpan({
            cls: 'grimoire-compact-boundary-label',
            text: t('chat.ui.messages.conversationCompacted'),
          });
        } else if (block.type === 'subagent') {
          flushPendingToolGroup();
          const taskToolCall = msg.toolCalls?.find(
            tc => tc.id === block.subagentId && isSubagentToolName(tc.name)
          );
          if (!taskToolCall) continue;

          this.renderTaskSubagent(contentEl, taskToolCall, block.mode);
          renderedToolIds.add(taskToolCall.id);
        } else if (block.type === 'parallel_worker_plan') {
          flushPendingToolGroup();
          const plan = new InlineOrchestratorPlan(
            contentEl,
            { type: 'parallel_worker_plan', tasks: block.tasks },
            () => {},
            {
              interactive: false,
              modelLabel: block.modelLabel,
              providerId: block.providerId,
            },
          );
          plan.render();
        }
      }
      flushPendingToolGroup();

      // Defensive fallback: preserve tool visibility when contentBlocks/toolCalls drift on reload.
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        this.renderToolCallSequence(
          contentEl,
          msg.toolCalls.filter(toolCall => !renderedToolIds.has(toolCall.id)),
          msg,
          renderedToolIds,
        );
      }
    } else {
      // Fallback for old conversations without contentBlocks
      if (msg.content) {
        const textEl = contentEl.createDiv({ cls: 'grimoire-text-block' });
        void this.renderContent(textEl, msg.content);
        this.addTextCopyButton(textEl, msg.content);
      }
      if (msg.toolCalls) {
        this.renderToolCallSequence(contentEl, msg.toolCalls, msg);
      }
    }

    // Render response duration footer (skip when message contains a compaction boundary)
    const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'context_compacted');
    if (msg.durationSeconds && msg.durationSeconds > 0 && !hasCompactBoundary) {
      const flavorWord = msg.durationFlavorWord || t('chat.ui.messages.completed');
      const footerEl = contentEl.createDiv({ cls: 'grimoire-response-footer' });
      footerEl.createSpan({
        text: t('chat.ui.messages.duration', {
          flavor: flavorWord,
          duration: formatDurationMmSs(msg.durationSeconds),
        }),
        cls: 'grimoire-baked-duration',
      });
    }
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and Codex collab agent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(contentEl, toolCall);
    } else if (isSubagentToolName(toolCall.name)) {
      this.renderTaskSubagent(contentEl, toolCall);
    } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
      this.renderProviderLifecycleSubagent(contentEl, toolCall, msg);
    } else {
      renderStoredToolCall(contentEl, toolCall);
    }
  }

  private renderToolCallSequence(
    contentEl: HTMLElement,
    toolCalls: ToolCallInfo[],
    msg?: ChatMessage,
    renderedToolIds?: Set<string>,
  ): void {
    const pendingGroup: ToolCallInfo[] = [];
    const flushGroup = () => {
      if (pendingGroup.length === 0) return;

      if (canGroupToolCalls(pendingGroup)) {
        renderStoredToolCallGroup(contentEl, [...pendingGroup]);
        pendingGroup.forEach(toolCall => renderedToolIds?.add(toolCall.id));
        pendingGroup.length = 0;
        return;
      }

      for (const toolCall of pendingGroup) {
        this.renderToolCall(contentEl, toolCall, msg);
        renderedToolIds?.add(toolCall.id);
      }
      pendingGroup.length = 0;
    };

    for (const toolCall of toolCalls) {
      if (!this.shouldRenderToolCall(toolCall)) {
        renderedToolIds?.add(toolCall.id);
        continue;
      }

      if (isToolCallGroupable(toolCall)) {
        const nextGroup = [...pendingGroup, toolCall];
        if (pendingGroup.length === 0 || canGroupToolCalls(nextGroup)) {
          pendingGroup.push(toolCall);
          continue;
        }

        flushGroup();
        pendingGroup.push(toolCall);
        continue;
      }

      flushGroup();
      this.renderToolCall(contentEl, toolCall, msg);
      renderedToolIds?.add(toolCall.id);
    }

    flushGroup();
  }

  private shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
    if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
    if (toolCall.name === TOOL_WRITE_STDIN && this.isSilentWriteStdinTool(toolCall)) return false;
    if (toolCall.name === 'custom_tool_call_output') return false;

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

    return true;
  }

  private isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
    return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
  }

  private renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(contentEl, subagentInfo);
  }

  /**
   * Consolidates provider lifecycle tools (spawn + wait/close)
   * into a single subagent block with prompt and result.
   */
  private renderProviderLifecycleSubagent(
    contentEl: HTMLElement,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
  ): void {
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!subagentLifecycleAdapter) {
      renderStoredToolCall(contentEl, spawnToolCall);
      return;
    }

    const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
      spawnToolCall,
      msg.toolCalls ?? [],
    );
    renderStoredSubagent(contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return {
        ...toolCall.subagent,
        mode: modeHint,
      };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
    return {
      id: toolCall.id,
      description,
      prompt,
      mode: 'async',
      status: asyncStatus,
      asyncStatus,
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status']
  ): 'completed' | 'error' | 'running' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'error':
      case 'blocked':
        return 'error';
      default:
        return 'running';
    }
  }

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }

  // ============================================
  // Image Rendering
  // ============================================

  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'grimoire-message-images' });

    for (const image of images) {
      const imageWrapper = imagesEl.createDiv({ cls: 'grimoire-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
        },
      });

      void this.setImageSrc(imgEl, image);

      // Click to view full size
      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }

  /**
   * Shows full-size image in modal overlay.
   */
  showFullImage(image: ImageAttachment): void {
    const dataUri = this.imageSrc(image);

    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'grimoire-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'grimoire-image-modal' });

    modal.createEl('img', {
      attr: {
        src: dataUri,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'grimoire-image-modal-close' });
    closeBtn.setText('\u00D7');
    // A multiplication sign is a shape, not a name: without one this control
    // announces as nothing and cannot be reached without a mouse.
    asActivatable(closeBtn, {
      label: t('chat.ui.messages.closeImage'),
      onActivate: () => close(),
    });

    // See the same handler in ImageContext: the stack decides which viewer
    // closes, and consuming the key here keeps it from also cancelling the
    // streaming turn behind the overlay.
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      closeTopmostImageViewer();
    };

    const unregisterViewer = registerOpenImageViewer(() => close());

    const close = () => {
      unregisterViewer();
      ownerDocument.removeEventListener('keydown', handleEsc, true);
      overlay.remove();
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc, true);
  }

  /**
   * Sets image src from attachment data.
   */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    imgEl.setAttribute('src', this.imageSrc(image));
  }

  /**
   * Prefers the stored file over a data URI: the browser then caches one URL
   * instead of the renderer rebuilding a megabyte of base64 on every click,
   * and the image still resolves when the in-memory copy was never refilled.
   */
  private imageSrc(image: ImageAttachment): string {
    if (image.hash) {
      const stored = this.plugin.storage?.attachments?.resourcePath(image.hash, image.mediaType);
      if (stored) {
        return stored;
      }
    }

    return `data:${image.mediaType};base64,${image.data}`;
  }

  // ============================================
  // Content Rendering
  // ============================================

  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions
  ): Promise<void> {
    el.empty();

    try {
      const normalizedMarkdown = normalizeLatexDelimiters(markdown);
      const renderMarkdown = normalizePipeTablesForMarkdown(
        options?.deferMath
          ? escapeMathDelimitersForStreaming(normalizedMarkdown)
          : normalizedMarkdown
      );
      // Normalize embeds before MarkdownRenderer consumes them.
      const processedMarkdown = replaceImageEmbedsWithHtml(
        renderMarkdown,
        this.app,
        this.plugin.settings.mediaFolder
      );
      await MarkdownRenderer.render(
        this.app,
        processedMarkdown,
        el,
        '',
        this.component
      );

      wrapMarkdownTables(el);

      // Wrap pre elements and move buttons outside scroll area
      el.querySelectorAll('pre').forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('grimoire-code-wrapper')) return;

        // Create wrapper
        const preParent = pre.parentElement;
        if (!preParent) return;
        const wrapper = preParent.createDiv({ cls: 'grimoire-code-wrapper' });
        preParent.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Check for language class and add label
        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const label = wrapper.createSpan({
              cls: 'grimoire-code-lang-label',
              text: match[1],
            });
            wrapper.appendChild(label);
            // The label reads as the language and acts as a copy button, so the
            // word on it is not the name of what it does.
            asActivatable(label, {
              label: t('chat.ui.messages.copyCode'),
              onActivate: () => {
              runRendererAction(async () => {
                const originalLabel = match[1];
                if (!originalLabel) return;

                try {
                  await navigator.clipboard.writeText(code.textContent || '');
                  label.setText(t('chat.ui.messages.copied'));
                  window.setTimeout(() => label.setText(originalLabel), 1500);
                } catch {
                  // Clipboard API may fail in non-secure contexts
                }
              });
              },
            });
          }
        }

        // Move Obsidian's copy button outside pre into wrapper
        const copyBtn = pre.querySelector('.copy-code-button');
        if (copyBtn) {
          wrapper.appendChild(copyBtn);
        }
      });

      // Process wikilinks only when the source can contain them; the DOM pass is expensive.
      if (hasProcessableWikilink(renderMarkdown) || hasProcessableWikilink(processedMarkdown)) {
        processFileLinks(this.app, el);
      }
    } catch {
      el.createDiv({
        cls: 'grimoire-render-error',
        text: t('chat.ui.messages.renderFailed'),
      });
    }
  }

  // ============================================
  // Copy Button
  // ============================================

  /**
   * Adds a copy button to a text block.
   * Button keeps a fixed footprint and changes to a check icon on click.
   * @param textEl The rendered text element
   * @param markdown The original markdown content to copy
   */
  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'grimoire-text-copy-btn' });
    const copyLabel = t('chat.ui.messages.copyResponse');
    setIcon(copyBtn, 'copy');
    this.setCopyButtonTooltip(copyBtn, copyLabel);
    textEl.createSpan({ cls: 'grimoire-message-completion-time' });

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {

        try {
          await navigator.clipboard.writeText(markdown);
        } catch {
          // Clipboard API may fail in non-secure contexts
          return;
        }

        // Clear any pending timeout from rapid clicks
        if (feedbackTimeout) {
          window.clearTimeout(feedbackTimeout);
        }

        // Keep the button footprint stable while showing copy feedback.
        copyBtn.empty();
        setIcon(copyBtn, 'check');
        copyBtn.classList.add('copied');
        this.setCopyButtonTooltip(copyBtn, t('chat.ui.messages.copied'));

        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          this.setCopyButtonTooltip(copyBtn, copyLabel);
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  updateMessageCompletionTime(msg: ChatMessage): void {
    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) return;

    const completedAt = msg.completedAt;
    if (completedAt === undefined) return;
    if (msg.role === 'assistant') {
      this.applyAssistantCompletionTime(msgEl, completedAt);
      this.liveMessageEls.delete(msg.id);
      return;
    }

    this.ensureUserCompletionTime(msgEl, completedAt);
  }

  private applyAssistantCompletionTime(msgEl: HTMLElement, completedAt: number): void {
    const textBlocks = Array.from(msgEl.querySelectorAll<HTMLElement>('.grimoire-text-block'));
    for (const textBlock of textBlocks) {
      textBlock.removeClass('grimoire-text-block--with-completion-time');
      const completionEl = textBlock.querySelector<HTMLElement>('.grimoire-message-completion-time');
      completionEl?.setText('');
    }

    const lastTextBlock = [...textBlocks].reverse().find((textBlock) =>
      Boolean(textBlock.querySelector('.grimoire-text-copy-btn'))
    );
    if (!lastTextBlock) return;

    const completionEl = lastTextBlock.querySelector<HTMLElement>('.grimoire-message-completion-time');
    if (!completionEl) return;

    completionEl.setText(this.formatMessageCompletionTime(completedAt));
    setTooltip(completionEl, this.formatMessageCompletionTitle(completedAt), { placement: 'top' });
    lastTextBlock.addClass('grimoire-text-block--with-completion-time');
  }

  private formatMessageCompletionTime(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return '';
    const completedDate = new Date(timestamp);
    const now = new Date(Date.now());
    const isSameDay = completedDate.getFullYear() === now.getFullYear()
      && completedDate.getMonth() === now.getMonth()
      && completedDate.getDate() === now.getDate();
    const isSameYear = completedDate.getFullYear() === now.getFullYear();
    const dateOptions: Intl.DateTimeFormatOptions = isSameDay
      ? {}
      : {
        ...(isSameYear ? {} : { year: 'numeric' as const }),
        month: 'short',
        day: 'numeric',
      };

    return new Intl.DateTimeFormat(getLocale(), {
      ...dateOptions,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(completedDate).replace(/,\s*/g, ' ');
  }

  private formatMessageCompletionTitle(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return '';
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false,
    }).format(new Date(timestamp));
  }

  private setCopyButtonTooltip(copyBtn: HTMLElement, label: string): void {
    copyBtn.setAttribute('aria-label', label);
    setTooltip(copyBtn, label, { placement: 'top' });
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (!msg.userMessageId) return;
    if (!this.isRewindEligible(allMessages, index)) return;
    const msgEl = this.liveMessageEls.get(msg.id);
    if (!msgEl) return;

    if (this.rewindCallback && !msgEl.querySelector('.grimoire-message-rewind-btn')) {
      this.addRewindButton(msgEl, msg.id);
    }
    if (this.forkCallback && !msgEl.querySelector('.grimoire-message-fork-btn')) {
      this.addForkButton(msgEl, msg.id);
    }
    this.cleanupLiveMessageEl(msg.id, msgEl);
  }

  private cleanupLiveMessageEl(msgId: string, msgEl: HTMLElement): void {
    const needsRewind = this.rewindCallback && !msgEl.querySelector('.grimoire-message-rewind-btn');
    const needsFork = this.forkCallback && !msgEl.querySelector('.grimoire-message-fork-btn');
    if (!needsRewind && !needsFork) {
      this.liveMessageEls.delete(msgId);
    }
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement): HTMLElement {
    const existing = msgEl.querySelector<HTMLElement>('.grimoire-user-msg-actions');
    if (existing) return existing;
    return msgEl.createDiv({ cls: 'grimoire-user-msg-actions' });
  }

  private ensureUserCompletionTime(msgEl: HTMLElement, completedAt: number): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const completionEl = toolbar.querySelector<HTMLElement>('.grimoire-message-completion-time')
      ?? toolbar.createSpan({ cls: 'grimoire-message-completion-time' });
    completionEl.setText(this.formatMessageCompletionTime(completedAt));
    setTooltip(completionEl, this.formatMessageCompletionTitle(completedAt), { placement: 'top' });
  }

  private addUserCopyButton(msgEl: HTMLElement, content: string, completedAt?: number): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    if (completedAt !== undefined) {
      this.ensureUserCompletionTime(msgEl, completedAt);
    }
    const copyBtn = toolbar.createSpan({ cls: 'grimoire-user-msg-copy-btn' });
    const copyLabel = t('chat.ui.messages.copyMessage');
    setIcon(copyBtn, 'copy');
    this.setCopyButtonTooltip(copyBtn, copyLabel);

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          return;
        }
        if (feedbackTimeout) window.clearTimeout(feedbackTimeout);
        copyBtn.empty();
        setIcon(copyBtn, 'check');
        copyBtn.classList.add('copied');
        this.setCopyButtonTooltip(copyBtn, t('chat.ui.messages.copied'));
        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          this.setCopyButtonTooltip(copyBtn, copyLabel);
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  private addRewindButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsRewind) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'grimoire-message-rewind-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'rotate-ccw');
    btn.setAttribute('aria-label', t('chat.rewind.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRewindMenu(e, messageId);
    });
  }

  private showRewindMenu(event: MouseEvent, messageId: string): void {
    const menu = new Menu();
    this.addRewindMenuItem(menu, messageId, 'conversation');
    this.addRewindMenuItem(menu, messageId, 'code-and-conversation');
    menu.showAtMouseEvent(event);
  }

  private addRewindMenuItem(menu: Menu, messageId: string, mode: ChatRewindMode): void {
    menu.addItem((item) => {
      item
        .setTitle(
          mode === 'conversation'
            ? t('chat.rewind.menuConversationOnly')
            : t('chat.rewind.menuCodeAndConversation')
        )
        .setIcon(mode === 'conversation' ? 'message-square' : 'rotate-ccw')
        .onClick(() => {
          runRendererAction(async () => {
            try {
              await this.rewindCallback?.(messageId, mode);
            } catch (err) {
              new Notice(t('chat.rewind.failed', { error: err instanceof Error ? err.message : t('chat.ui.errors.unknown') }));
            }
          });
        });
    });
  }

  private addForkButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsFork) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'grimoire-message-fork-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'git-fork');
    btn.setAttribute('aria-label', t('chat.fork.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await this.forkCallback?.(messageId);
        } catch (err) {
          new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : t('chat.ui.errors.unknown') }));
        }
      });
    });
  }

  // ============================================
  // Utilities
  // ============================================

  private getScrollEl(): HTMLElement {
    return this.scrollOptions.getScrollEl?.() ?? this.messagesEl;
  }

  private shouldAutoScroll(): boolean {
    return this.scrollOptions.shouldAutoScroll?.() ?? true;
  }

  private scrollToBottomAfterMessage(msg: ChatMessage): void {
    if (msg.role === 'user' || this.shouldAutoScroll()) {
      this.scrollToBottom();
      return;
    }

    this.scrollOptions.onAutoScrollSuppressed?.();
  }

  /** Scrolls messages container to bottom. */
  scrollToBottom(): void {
    const scrollEl = this.getScrollEl();
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100): void {
    const scrollEl = this.getScrollEl();
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      scheduleAnimationFrame(() => {
        const nextScrollEl = this.getScrollEl();
        nextScrollEl.scrollTop = nextScrollEl.scrollHeight;
      }, scrollEl.ownerDocument.defaultView);
    }
  }

}

/**
 * What a conversation says about the history it could not load.
 *
 * Three of the six outcomes are worth a row, and the other three are not:
 * `complete` loaded, `absent` never had a provider-side history to lose — a new
 * chat is not missing anything — and `recovered` means the gap was closed.
 */
function hydrationNoticeText(hydration?: ProviderHistoryHydration): string | null {
  switch (hydration?.outcome) {
    case 'stale':
      return t('chat.ui.messages.historyUnavailable');
    case 'partial':
      return t('chat.ui.messages.historyPartial');
    case 'corrupt':
      return t('chat.ui.messages.historyUnreadable');
    default:
      return null;
  }
}
