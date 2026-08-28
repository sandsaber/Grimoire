import { TFile } from 'obsidian';

import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderId,
  type ProviderSubagentLifecycleAdapter,
} from '../../../core/providers/types';
import type { ExecutionChatRuntimeAdapter } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import { normalizeProviderError } from '../../../core/runtime/providerError';
import { parseTodoInput } from '../../../core/tools/todo';
import { extractResolvedAnswers, extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  isEditTool,
  isSubagentToolName,
  isWriteEditTool,
  skipsBlockedDetection,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type {
  AssistantTextPhase,
  ChatMessage,
  ContentBlock,
  ProgressState,
  StreamChunk,
  SubagentInfo,
  ToolCallInfo,
} from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { t } from '../../../i18n/i18n';
import type GrimoirePlugin from '../../../main';
import { createProviderIconSvg } from '../../../shared/icons';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { formatDurationMmSs } from '../../../utils/date';
import { extractDiffData } from '../../../utils/diff';
import { hasStreamingMathDelimiters } from '../../../utils/markdownMath';
import { getVaultPath, normalizePathForVault } from '../../../utils/path';
import { FLAVOR_TEXTS } from '../constants';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import {
  type OrchestratorPlan,
  parseOrchestratorPlan,
  stripOrchestratorPlanPayload,
} from '../rendering/orchestratorPlanParser';
import {
  cleanupProgressBlock,
  createProgressBlock,
  finalizeProgressBlock,
  type ProgressBlockState,
  updateProgressBlock,
} from '../rendering/ProgressBlockRenderer';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createSubagentBlock,
  finalizeSubagentBlock,
  type SubagentState,
} from '../rendering/SubagentRenderer';
import {
  createThinkingBlock,
  finalizeThinkingBlock,
} from '../rendering/ThinkingBlockRenderer';
import {
  canGroupToolCalls,
  getToolDisplayName,
  getToolSummary,
  isBlockedToolResult,
  renderToolCall,
  renderToolCallGroup,
  updateToolCallResult,
} from '../rendering/ToolCallRenderer';
import {
  createWriteEditBlock,
  finalizeWriteEditBlock,
  updateWriteEditWithDiff,
} from '../rendering/WriteEditRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import {
  TurnFeedbackMetrics,
  type TurnFeedbackMetricsSnapshot,
} from '../services/TurnFeedbackMetrics';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';

export interface StreamControllerDeps {
  plugin: GrimoirePlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getMessagesEl: () => HTMLElement;
  getScrollEl?: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  updateQueueIndicator: () => void;
  /** Get the agent service from the tab. */
  getAgentService?: () => ExecutionChatRuntimeAdapter | null;
  /** Tab-local provider settings used when a usage event omits its model. */
  getActiveProviderSettings?: () => Record<string, unknown>;
  /** True when this tab should treat the final assistant response as an orchestrator plan. */
  isOrchestratorMode?: () => boolean;
  /** Render an inline approval control for a parsed parallel-worker plan. */
  onOrchestratorPlanDetected?: (containerEl: HTMLElement, plan: OrchestratorPlan) => void;
  /** Observe provider tool calls that may load files into runtime context. */
  recordRuntimeToolCall?: (toolCall: ToolCallInfo) => void;
  /** Reveal stream controls that are reserved for responses containing subagents. */
  onSubagentActivityDetected?: () => void;
}

export class StreamController {

  private deps: StreamControllerDeps;
  private pendingTextRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingTextRenderPromise: Promise<void> | null = null;
  private resolvePendingTextRender: (() => void) | null = null;
  private isTextRenderRunning = false;
  private pendingThinkingRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingThinkingRenderPromise: Promise<void> | null = null;
  private resolvePendingThinkingRender: (() => void) | null = null;
  private isThinkingRenderRunning = false;
  private pendingToolOutputFrames = new Map<string, ScheduledAnimationFrame>();
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;
  private progressBlocks = new Map<string, ProgressBlockState>();
  private activeProgressId: string | null = null;
  private currentTextPhase: AssistantTextPhase | undefined;
  private silentTurnTimeout: number | null = null;
  private silentTurnElapsedInterval: number | null = null;
  private silentTurnProviderId: ProviderId | null = null;
  private turnFeedback: TurnFeedbackMetrics | null = null;
  private silentTurnPaused = false;
  private silentTurnStatusEl: HTMLElement | null = null;
  private silentTurnStartedAt: number | null = null;
  private silentTurnTimerWindow: Window | null = null;

  // Provider lifecycle agent tracking (spawn → wait/close lifecycle)
  private lifecycleSubagentStates = new Map<string, SubagentState>(); // spawn callId → SubagentState
  private lifecycleAgentIdToSpawnId = new Map<string, string>();      // agentId → spawn callId

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
  }

  setOrchestratorCallbacks(
    onOrchestratorPlanDetected?: (containerEl: HTMLElement, plan: OrchestratorPlan) => void,
    isOrchestratorMode?: () => boolean,
  ): void {
    this.deps.onOrchestratorPlanDetected = onOrchestratorPlanDetected;
    this.deps.isOrchestratorMode = isOrchestratorMode;
  }

  private getActiveProviderId(): ProviderId {
    return this.deps.getAgentService?.()?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getSubagentLifecycleAdapter(toolName?: string): ProviderSubagentLifecycleAdapter | null {
    return resolveSubagentLifecycleAdapter(this.getActiveProviderId(), toolName);
  }

  private normalizeToolResultContent(content: unknown): string {
    return extractToolResultContent(content, { fallbackIndent: 2 });
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleStreamChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    this.noteTurnActivity();
    this.turnFeedback?.observe(chunk, performance.now());
    const { state } = this.deps;

    switch (chunk.type) {
      case 'thinking':
        // Flush pending tools before rendering new content type
        this.flushPendingTools();
        if (state.currentTextEl) {
          await this.finalizeCurrentTextBlock(msg);
        }
        await this.appendThinking(chunk.content);
        break;

      case 'text':
        // Flush pending tools before rendering new content type
        this.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeActiveProgress(msg);
        if (state.currentTextEl && this.currentTextPhase !== chunk.phase) {
          await this.finalizeCurrentTextBlock(msg);
        }
        msg.content += chunk.content;
        await this.appendText(chunk.content, chunk.phase);
        break;

      case 'progress':
        this.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);
        await this.handleProgress(chunk, msg);
        break;

      case 'tool_use': {
        // **Whose work it is, before what it is.** A tool call belonging to a
        // subagent is drawn inside that subagent's block rather than in the
        // turn, and it used to arrive as its own chunk type; it is the same
        // chunk with an owner now, so the ownership question is asked first and
        // everything below is about the turn's own calls.
        const owner = chunk.subagentId;
        if (owner !== undefined) {
          this.deps.onSubagentActivityDetected?.();
          await this.handleSubagentChunk({ ...chunk, subagentId: owner }, msg);
          break;
        }
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);

        if (isSubagentToolName(chunk.name)) {
          this.deps.onSubagentActivityDetected?.();
          // Flush pending tools before Agent
          this.flushPendingTools();
          this.handleTaskToolUseViaManager(chunk, msg);
          break;
        }

        if (chunk.name === TOOL_AGENT_OUTPUT) {
          this.handleAgentOutputToolUse(chunk, msg);
          break;
        }

        const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(chunk.name);
        if (subagentLifecycleAdapter?.isSpawnTool(chunk.name)) {
          this.deps.onSubagentActivityDetected?.();
          this.handleProviderSubagentSpawn(chunk, msg, subagentLifecycleAdapter);
          break;
        }
        if (subagentLifecycleAdapter?.isHiddenTool(chunk.name)) {
          this.handleProviderHiddenSubagentTool(chunk, msg);
          break;
        }

        this.handleRegularToolUse(chunk, msg);
        break;
      }

      case 'tool_result': {
        const owner = chunk.subagentId;
        if (owner !== undefined) {
          this.deps.onSubagentActivityDetected?.();
          await this.handleSubagentChunk({ ...chunk, subagentId: owner }, msg);
          break;
        }
        await this.handleToolResult(chunk, msg);
        break;
      }

      case 'async_subagent_result':
        await this.handleAsyncSubagentResult(chunk, msg);
        break;

      case 'tool_output':
        this.handleToolOutput(chunk, msg);
        break;

      case 'notice':
        this.flushPendingTools();
        await this.appendText(`\n\n⚠️ **${chunk.level === 'warning'
          ? t('chat.ui.messages.noticeBlocked')
          : t('chat.ui.messages.noticeLabel')}:** ${chunk.content}`);
        break;

      case 'error':
        await this.renderTurnFailure(chunk.content);
        break;

      case 'context_compacted': {
        this.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);
        msg.contentBlocks = msg.contentBlocks || [];
        msg.contentBlocks.push({ type: 'context_compacted' });
        this.renderCompactBoundary();
        break;
      }

      case 'usage': {
        // Skip usage updates from other sessions or when flagged (during session reset)
        const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
        const chunkSessionId = chunk.sessionId ?? null;
        if (
          (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) ||
          (chunkSessionId && !currentSessionId)
        ) {
          break;
        }
        // Some SDKs report aggregate usage after subagents run. Providers that
        // can query the parent session directly mark that usage explicitly.
        if (
          this.deps.subagentManager.subagentsSpawnedThisStream > 0
          && chunk.usageScope !== 'parent'
        ) {
          break;
        }
        if (!state.ignoreUsageUpdates) {
          const activeModel = this.getActiveProviderModel(msg);
          state.usage = activeModel && !chunk.usage.model
            ? { ...chunk.usage, model: activeModel }
            : chunk.usage;
        }
        break;
      }

      default:
        break;
    }

    this.scrollToBottom();
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  /**
   * Draws the reason a turn failed into the message it was drawing.
   *
   * Called directly by the projection's render target, which used to say the
   * same thing by handing this an `error` chunk. A turn ending is a fact the
   * projection states, so it asks for it by name rather than dressing it as
   * something a provider sent.
   */
  async renderTurnFailure(content: string): Promise<void> {
    // Pending tools go first, so the reason lands after what was in flight.
    this.flushPendingTools();
    await this.appendText(
      `\n\n❌ **${t('chat.ui.messages.errorLabel')}:** `
      + `${this.normalizeErrorMessage(content)}`,
    );
  }

  /** Closes out a turn's message. The other half of the pair above. */
  async finishTurn(msg: ChatMessage): Promise<void> {
    this.flushPendingTools();
    await this.finalizeProgressBlocks(msg);
    this.handleDone(msg);
  }

  private handleDone(msg: ChatMessage): void {
    this.maybeHandleOrchestratorPlan(msg);
  }

  private maybeHandleOrchestratorPlan(msg: ChatMessage): void {
    if (
      this.deps.isOrchestratorMode?.() !== true ||
      !this.deps.onOrchestratorPlanDetected ||
      !this.deps.state.currentContentEl ||
      !msg.content
    ) {
      return;
    }

    const plan = parseOrchestratorPlan(msg.content);
    if (!plan) {
      return;
    }

    this.replaceOrchestratorPayloadWithPlanBlock(msg, plan);
    this.deps.onOrchestratorPlanDetected(this.deps.state.currentContentEl, plan);
  }

  private replaceOrchestratorPayloadWithPlanBlock(
    msg: ChatMessage,
    plan: OrchestratorPlan,
  ): void {
    msg.content = stripOrchestratorPlanPayload(msg.content);

    const preservedBlocks = (msg.contentBlocks ?? []).flatMap((block): ContentBlock[] => {
      if (block.type === 'parallel_worker_plan') {
        return [];
      }
      if (block.type !== 'text') {
        return [block];
      }

      const content = stripOrchestratorPlanPayload(block.content);
      return content ? [{ ...block, content }] : [];
    });
    preservedBlocks.push({
      type: 'parallel_worker_plan',
      tasks: plan.tasks,
      ...(msg.responseMetadata?.modelLabel
        ? { modelLabel: msg.responseMetadata.modelLabel }
        : {}),
      providerId: msg.responseMetadata?.providerId ?? this.getActiveProviderId(),
    });
    msg.contentBlocks = preservedBlocks;

    this.deps.state.currentContentEl
      ?.querySelectorAll<HTMLElement>('.grimoire-text-block')
      .forEach((element) => element.remove());
  }

  /**
   * Handles regular tool_use chunks by buffering them.
   * Tools are rendered when flushPendingTools is called (on next content type or tool_result).
   */
  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state } = this.deps;

    // Check if this is an update to an existing tool call
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (existingToolCall) {
      const newInput = chunk.input || {};
      if (Object.keys(newInput).length > 0) {
        existingToolCall.input = { ...existingToolCall.input, ...newInput };

        // Re-parse TodoWrite on input updates (streaming may complete the input)
        if (existingToolCall.name === TOOL_TODO_WRITE) {
          const todos = parseTodoInput(existingToolCall.input);
          if (todos) {
            this.deps.state.currentTodos = todos;
          }
        }

        // Capture plan file path on input updates (file_path may arrive in a later chunk)
        if (existingToolCall.name === TOOL_WRITE) {
          this.capturePlanFilePath(existingToolCall.input);
        }

        // If already rendered, update the header name + summary
        const toolEl = state.toolCallElements.get(chunk.id);
        if (toolEl) {
          const nameEl = toolEl.querySelector('.grimoire-tool-name')
            ?? toolEl.querySelector('.grimoire-write-edit-name');
          if (nameEl) {
            nameEl.setText(getToolDisplayName(existingToolCall));
          }
          const summaryEl = toolEl.querySelector('.grimoire-tool-summary')
            ?? toolEl.querySelector('.grimoire-write-edit-summary');
          if (summaryEl) {
            summaryEl.setText(getToolSummary(existingToolCall.name, existingToolCall.input));
          }
        }
        // If still pending, the updated input is already in the toolCall object
        this.deps.recordRuntimeToolCall?.(existingToolCall);
      }
      return;
    }

    // Create new tool call
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    this.deps.recordRuntimeToolCall?.(toolCall);

    // Add to contentBlocks for ordering
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    // TodoWrite: update panel state immediately (side effect), but still buffer render
    if (chunk.name === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(chunk.input);
      if (todos) {
        this.deps.state.currentTodos = todos;
      }
    }

    // Track Write to provider plan directory for the ExitPlanMode preview.
    if (chunk.name === TOOL_WRITE) {
      this.capturePlanFilePath(chunk.input);
    }

    // Buffer the tool call instead of rendering immediately
    if (state.currentContentEl) {
      state.pendingTools.set(chunk.id, {
        toolCall,
        parentEl: state.currentContentEl,
      });
      this.showThinkingIndicator();
    }
  }

  private getActiveProviderModel(message?: ChatMessage): string | undefined {
    if (typeof message?.responseMetadata?.model === 'string') {
      return message.responseMetadata.model;
    }
    const tabSettings = this.deps.getActiveProviderSettings?.();
    if (typeof tabSettings?.model === 'string') {
      return tabSettings.model;
    }
    const providerId = this.deps.getAgentService?.()?.providerId;
    if (!providerId) {
      return undefined;
    }

    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.plugin.settings,
      providerId,
    );
    return typeof settings.model === 'string' ? settings.model : undefined;
  }

  private normalizeErrorMessage(message: string): string {
    const providerId = this.deps.getAgentService?.()?.providerId;
    if (!providerId) {
      return message;
    }

    return normalizeProviderError(
      message,
      providerCatalog().displayName(providerId),
    ).message;
  }

  private shouldDeferMathRendering(): boolean {
    return this.deps.plugin.settings.deferMathRenderingDuringStreaming !== false;
  }

  private getStreamingRenderOptions(content: string): RenderContentOptions | undefined {
    return this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content)
      ? { deferMath: true }
      : undefined;
  }

  private capturePlanFilePath(input: Record<string, unknown>): void {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    const planPathPrefix = this.deps.getAgentService?.()?.getCapabilities().planPathPrefix;
    if (planPathPrefix && filePath.replace(/\\/g, '/').includes(planPathPrefix)) {
      this.deps.state.planFilePath = filePath;
    }
  }

  /**
   * Flushes all pending tool calls by rendering them.
   * Called when a different content type arrives or stream ends.
   */
  private flushPendingTools(): void {
    const { state } = this.deps;

    if (state.pendingTools.size === 0) {
      return;
    }

    // Render pending tools in order (Map preserves insertion order), grouping
    // consecutive search/list traces when the design calls for a compact parent row.
    const entries = Array.from(state.pendingTools.entries());
    let index = 0;
    while (index < entries.length) {
      const [toolId, pending] = entries[index];
      const parentEl = pending.parentEl;
      const groupEntries = parentEl && !isWriteEditTool(pending.toolCall.name)
        ? this.collectPendingToolGroup(entries, index, parentEl)
        : [];

      if (groupEntries.length > 1) {
        renderToolCallGroup(
          parentEl!,
          groupEntries.map(([, groupPending]) => groupPending.toolCall),
          state.toolCallElements,
        );
        for (const [groupToolId] of groupEntries) {
          state.pendingTools.delete(groupToolId);
        }
        index += groupEntries.length;
        continue;
      }

      this.renderPendingTool(toolId);
      index++;
    }

    state.pendingTools.clear();
  }

  flushPendingToolsForPermission(): void {
    this.flushPendingTools();
  }

  private collectPendingToolGroup(
    entries: Array<[string, { toolCall: ToolCallInfo; parentEl: HTMLElement | null }]>,
    startIndex: number,
    parentEl: HTMLElement,
  ): Array<[string, { toolCall: ToolCallInfo; parentEl: HTMLElement | null }]> {
    const groupEntries: Array<[string, { toolCall: ToolCallInfo; parentEl: HTMLElement | null }]> = [];

    for (let index = startIndex; index < entries.length; index++) {
      const entry = entries[index];
      const [, pending] = entry;
      if (pending.parentEl !== parentEl || isWriteEditTool(pending.toolCall.name)) break;

      const nextCalls = [...groupEntries.map(([, groupPending]) => groupPending.toolCall), pending.toolCall];
      if (nextCalls.length > 1 && !canGroupToolCalls(nextCalls)) break;

      groupEntries.push(entry);
    }

    return canGroupToolCalls(groupEntries.map(([, pending]) => pending.toolCall))
      ? groupEntries
      : [];
  }

  /**
   * Renders a single pending tool call and moves it from pending to rendered state.
   */
  private renderPendingTool(toolId: string): void {
    const { state } = this.deps;
    const pending = state.pendingTools.get(toolId);
    if (!pending) return;

    const { toolCall, parentEl } = pending;
    if (!parentEl) return;
    if (isWriteEditTool(toolCall.name)) {
      const writeEditState = createWriteEditBlock(parentEl, toolCall);
      state.writeEditStates.set(toolId, writeEditState);
      state.toolCallElements.set(toolId, writeEditState.wrapperEl);
    } else {
      renderToolCall(parentEl, toolCall, state.toolCallElements);
    }
    state.pendingTools.delete(toolId);
  }

  private handleToolOutput(
    chunk: { type: 'tool_output'; id: string; content: string },
    msg: ChatMessage,
  ): void {
    const { state } = this.deps;

    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) {
      return;
    }

    existingToolCall.result = (existingToolCall.result ?? '') + chunk.content;
    this.scheduleToolOutputRender(chunk.id, existingToolCall);
    this.showThinkingIndicator();
  }

  // ============================================
  // Provider lifecycle subagents (spawn → wait/close)
  // ============================================

  private handleProviderSubagentSpawn(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    const { state } = this.deps;

    const existingToolCall = msg.toolCalls?.find(toolCall => toolCall.id === chunk.id);
    if (existingToolCall) {
      existingToolCall.name = chunk.name;
      existingToolCall.input = { ...existingToolCall.input, ...chunk.input };
      const subagentInfo = adapter.buildSubagentInfo(existingToolCall, msg.toolCalls ?? []);
      existingToolCall.subagent = subagentInfo;
      const subagentState = this.lifecycleSubagentStates.get(chunk.id);
      if (subagentState) {
        this.syncProviderSubagentState(subagentState, subagentInfo);
      }
      this.deps.recordRuntimeToolCall?.(existingToolCall);
      return;
    }

    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    // Render as subagent block immediately
    if (state.currentContentEl) {
      this.flushPendingTools();
      const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);
      toolCall.subagent = subagentInfo;

      const subagentState = createSubagentBlock(state.currentContentEl, chunk.id, {
        description: subagentInfo.description,
        prompt: subagentInfo.prompt,
      });
      this.lifecycleSubagentStates.set(chunk.id, subagentState);
    }
    this.deps.recordRuntimeToolCall?.(toolCall);
  }

  private syncProviderSubagentState(
    subagentState: SubagentState,
    subagentInfo: SubagentInfo,
  ): void {
    subagentState.info.description = subagentInfo.description;
    subagentState.info.prompt = subagentInfo.prompt;
    subagentState.info.agentId = subagentInfo.agentId;
    subagentState.labelEl.setText(
      subagentInfo.description.length > 40
        ? subagentInfo.description.substring(0, 40) + '...'
        : subagentInfo.description,
    );

    const promptTextEl = subagentState.promptBodyEl?.querySelector(
      '.grimoire-subagent-prompt-text',
    );
    promptTextEl?.setText(subagentInfo.prompt || t('chat.ui.subagent.noPrompt'));
  }

  private handleProviderHiddenSubagentTool(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const existingToolCall = msg.toolCalls?.find(toolCall => toolCall.id === chunk.id);
    if (existingToolCall) {
      existingToolCall.name = chunk.name;
      existingToolCall.input = { ...existingToolCall.input, ...chunk.input };
      this.deps.recordRuntimeToolCall?.(existingToolCall);
      return;
    }

    // Track in toolCalls for data completeness, but don't create DOM or content block
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    this.deps.recordRuntimeToolCall?.(toolCall);
  }

  /**
   * Handles tool_result for provider lifecycle subagent tools.
   * Returns true if the result was consumed (caller should return early).
   */
  private handleProviderSubagentResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean },
    msg: ChatMessage
  ): boolean {
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) return false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    const adapter = this.getSubagentLifecycleAdapter(existingToolCall.name);
    if (!adapter) return false;

    if (adapter.isSpawnTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;

      const spawnResult = adapter.extractSpawnResult(normalizedContent);
      if (spawnResult.agentId) {
        this.lifecycleAgentIdToSpawnId.set(spawnResult.agentId, chunk.id);
      }

      const subagentInfo = adapter.buildSubagentInfo(existingToolCall, msg.toolCalls ?? []);
      existingToolCall.subagent = subagentInfo;
      const subagentState = this.lifecycleSubagentStates.get(chunk.id);
      if (subagentState) {
        this.syncProviderSubagentState(subagentState, subagentInfo);
      }

      if (chunk.isError) {
        if (subagentState) {
          finalizeSubagentBlock(subagentState, normalizedContent || 'Error', true);
        }
      }
      return true;
    }

    if (adapter.isWaitTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;

      for (const spawnId of adapter.resolveSpawnToolIds(
        existingToolCall,
        this.lifecycleAgentIdToSpawnId,
      )) {
        const spawnToolCall = msg.toolCalls?.find(tc => tc.id === spawnId);
        const subagentState = this.lifecycleSubagentStates.get(spawnId);
        if (!spawnToolCall || !subagentState) continue;

        const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
        spawnToolCall.subagent = subagentInfo;
        this.syncProviderSubagentState(subagentState, subagentInfo);

        if (subagentInfo.status === 'completed' || subagentInfo.status === 'error') {
          finalizeSubagentBlock(
            subagentState,
            subagentInfo.result || (subagentInfo.status === 'error' ? 'Error' : 'DONE'),
            subagentInfo.status === 'error'
          );
        }
      }
      return true;
    }

    if (adapter.isCloseTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      return true;
    }

    return false;
  }

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    msg: ChatMessage
  ): Promise<void> {
    const { state, subagentManager } = this.deps;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    // Resolve pending Task before processing result.
    if (subagentManager.hasPendingTask(chunk.id)) {
      this.renderPendingTaskFromTaskResultViaManager(chunk, msg);
    }

    // Check if it's a sync subagent result
    const subagentState = subagentManager.getSyncSubagent(chunk.id);
    if (subagentState) {
      this.finalizeSubagent(chunk, msg);
      return;
    }

    // Check if it's an async task result
    if (this.handleAsyncTaskToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if it's an agent output result
    if (await this.handleAgentOutputToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    if (this.handleProviderSubagentResult(chunk, msg)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if tool is still pending (buffered) - render it now before applying result
    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);

    // Regular tool result
    const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);

    if (existingToolCall) {
      // Tools that resolve via dedicated callbacks (not content-based) skip
      // blocked detection — their status is determined solely by isError
      if (chunk.isError) {
        existingToolCall.status = 'error';
      } else if (!skipsBlockedDetection(existingToolCall.name) && isBlocked) {
        existingToolCall.status = 'blocked';
      } else {
        existingToolCall.status = 'completed';
      }
      existingToolCall.result = normalizedContent;
      this.deps.recordRuntimeToolCall?.(existingToolCall);

      if (existingToolCall.name === TOOL_ASK_USER_QUESTION) {
        const answers =
          extractResolvedAnswers(chunk.toolUseResult) ??
          extractResolvedAnswersFromResultText(normalizedContent);
        if (answers) existingToolCall.resolvedAnswers = answers;
      }

      const writeEditState = state.writeEditStates.get(chunk.id);
      if (writeEditState && isWriteEditTool(existingToolCall.name)) {
        if (!chunk.isError && !isBlocked) {
          const diffData = extractDiffData(chunk.toolUseResult, existingToolCall);
          if (diffData) {
            existingToolCall.diffData = diffData;
            updateWriteEditWithDiff(writeEditState, diffData);
          }
        }
        finalizeWriteEditBlock(writeEditState, chunk.isError || isBlocked);
      } else {
        this.cancelPendingToolOutputRender(chunk.id);
        updateToolCallResult(chunk.id, existingToolCall, state.toolCallElements);
      }

      // Notify Obsidian vault so the file tree refreshes after Write/Edit/NotebookEdit
      if (!chunk.isError && !isBlocked && isEditTool(existingToolCall.name)) {
        this.notifyVaultFileChange(existingToolCall.input);
      }

      // Runtime apply_patch: refresh each changed file path
      if (!chunk.isError && !isBlocked && existingToolCall.name === TOOL_APPLY_PATCH) {
        this.notifyApplyPatchFileChanges(existingToolCall.input);
      }
    }

    this.showThinkingIndicator();
  }

  // ============================================
  // Text Block Management
  // ============================================

  async appendText(text: string, phase?: AssistantTextPhase): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    // The projection path draws prose through here rather than through
    // `handleStreamChunk`, so a turn made entirely of it is invisible to the
    // metrics unless this says so.
    this.turnFeedback?.observeText(text, performance.now());

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      const classes = ['grimoire-text-block'];
      if (phase) classes.push(`grimoire-text-block--${phase.replace('_', '-')}`);
      state.currentTextEl = state.currentContentEl.createDiv({ cls: classes.join(' ') });
      state.currentTextContent = '';
      this.currentTextPhase = phase;
    }

    state.currentTextContent += text;
    void this.scheduleCurrentTextRender();
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    await this.flushPendingTextRender();

    if (msg && state.currentTextContent) {
      if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(state.currentTextContent)
      ) {
        await renderer.renderContent(state.currentTextEl, state.currentTextContent);
      }
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'text',
        content: state.currentTextContent,
        phase: this.currentTextPhase,
      });
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl) {
        renderer.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
    this.currentTextPhase = undefined;
  }

  // ============================================
  // User-facing Progress Management
  // ============================================

  private async handleProgress(
    chunk: Extract<StreamChunk, { type: 'progress' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();
    if (this.activeProgressId && this.activeProgressId !== chunk.id) {
      await this.finalizeActiveProgress(msg);
    }

    const existingState = this.progressBlocks.get(chunk.id);
    const existingBlock = this.findProgressContentBlock(msg, chunk.id);
    const content = chunk.append
      ? `${existingBlock?.content ?? existingState?.content ?? ''}${chunk.content}`
      : chunk.content;
    const progressState = chunk.state ?? 'running';
    const items = chunk.items ?? existingBlock?.items ?? existingState?.items;

    if (existingState) {
      await updateProgressBlock(
        existingState,
        { content, state: progressState, items },
        (el, markdown, options) => renderer.renderContent(el, markdown, options),
      );
    } else {
      const progress = await createProgressBlock(
        state.currentContentEl,
        { content, state: progressState, items },
        (el, markdown, options) => renderer.renderContent(el, markdown, options),
      );
      this.progressBlocks.set(chunk.id, progress);
    }

    if (existingBlock) {
      existingBlock.content = content;
      existingBlock.state = progressState;
      existingBlock.items = items;
    } else {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'progress',
        id: chunk.id,
        content,
        state: progressState,
        items,
      });
    }

    this.activeProgressId = progressState === 'running' ? chunk.id : null;
  }

  private findProgressContentBlock(msg: ChatMessage, id: string): Extract<ContentBlock, { type: 'progress' }> | undefined {
    return msg.contentBlocks?.find(
      (block): block is Extract<ContentBlock, { type: 'progress' }> => block.type === 'progress' && block.id === id,
    );
  }

  private async finalizeActiveProgress(msg?: ChatMessage, state: Exclude<ProgressState, 'running'> = 'completed'): Promise<void> {
    if (!this.activeProgressId) return;
    const id = this.activeProgressId;
    const progress = this.progressBlocks.get(id);
    if (progress?.state === 'running') {
      const finalState = this.resolveFinalProgressState(progress, state);
      const durationSeconds = finalizeProgressBlock(progress, finalState);
      if (msg) {
        const block = this.findProgressContentBlock(msg, id);
        if (block) {
          block.state = finalState;
          block.durationSeconds = durationSeconds;
        }
      }
    }
    if (progress) {
      cleanupProgressBlock(progress);
      this.progressBlocks.delete(id);
    }
    this.activeProgressId = null;
  }

  async finalizeProgressBlocks(
    msg?: ChatMessage,
    state: Exclude<ProgressState, 'running'> = 'completed',
  ): Promise<void> {
    await this.finalizeActiveProgress(msg, state);
    for (const [id, progress] of this.progressBlocks) {
      if (progress.state !== 'running') continue;
      const finalState = this.resolveFinalProgressState(progress, state);
      const durationSeconds = finalizeProgressBlock(progress, finalState);
      if (msg) {
        const block = this.findProgressContentBlock(msg, id);
        if (block) {
          block.state = finalState;
          block.durationSeconds = durationSeconds;
        }
      }
    }
    for (const progress of this.progressBlocks.values()) {
      cleanupProgressBlock(progress);
    }
    this.progressBlocks.clear();
    this.activeProgressId = null;
  }

  private resolveFinalProgressState(
    progress: ProgressBlockState,
    requestedState: Exclude<ProgressState, 'running'>,
  ): Exclude<ProgressState, 'running'> {
    if (requestedState === 'completed'
      && progress.items?.some(item => item.status !== 'completed')) {
      return 'waiting';
    }
    return requestedState;
  }

  private scheduleCurrentTextRender(): Promise<void> {
    if (!this.pendingTextRenderPromise) {
      this.pendingTextRenderPromise = new Promise(resolve => {
        this.resolvePendingTextRender = resolve;
      });
    }

    if (this.pendingTextRenderFrame === null && !this.isTextRenderRunning) {
      this.pendingTextRenderFrame = scheduleAnimationFrame(() => {
        this.pendingTextRenderFrame = null;
        void this.renderPendingText();
      }, this.getStreamingRenderWindow());
    }

    return this.pendingTextRenderPromise;
  }

  private async flushPendingTextRender(): Promise<void> {
    const pendingRender = this.pendingTextRenderPromise;
    if (!pendingRender) return;

    if (this.pendingTextRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingTextRenderFrame);
      this.pendingTextRenderFrame = null;
      void this.renderPendingText();
    }

    await pendingRender;
  }

  private async renderPendingText(): Promise<void> {
    if (this.isTextRenderRunning) return;
    this.isTextRenderRunning = true;

    const { state, renderer } = this.deps;
    const textEl = state.currentTextEl;
    const content = state.currentTextContent;

    try {
      if (textEl) {
        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await renderer.renderContent(textEl, content, options);
        } else {
          await renderer.renderContent(textEl, content);
        }
        this.scrollToBottom();
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isTextRenderRunning = false;
    }

    if (state.currentTextEl === textEl && state.currentTextContent !== content) {
      this.pendingTextRenderFrame = scheduleAnimationFrame(() => {
        this.pendingTextRenderFrame = null;
        void this.renderPendingText();
      }, this.getStreamingRenderWindow());
      return;
    }

    const resolve = this.resolvePendingTextRender;
    this.pendingTextRenderPromise = null;
    this.resolvePendingTextRender = null;
    resolve?.();
  }

  private cancelPendingTextRender(): void {
    if (this.pendingTextRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingTextRenderFrame);
      this.pendingTextRenderFrame = null;
    }

    const resolve = this.resolvePendingTextRender;
    this.pendingTextRenderPromise = null;
    this.resolvePendingTextRender = null;
    resolve?.();
  }

  private scheduleToolOutputRender(toolId: string, toolCall: ToolCallInfo): void {
    if (this.pendingToolOutputFrames.has(toolId)) return;

    const frame = scheduleAnimationFrame(() => {
      this.pendingToolOutputFrames.delete(toolId);
      updateToolCallResult(toolId, toolCall, this.deps.state.toolCallElements);
      this.scrollToBottom();
    }, this.getMessagesWindow());
    this.pendingToolOutputFrames.set(toolId, frame);
  }

  private cancelPendingToolOutputRender(toolId: string): void {
    const frame = this.pendingToolOutputFrames.get(toolId);
    if (!frame) return;

    cancelScheduledAnimationFrame(frame);
    this.pendingToolOutputFrames.delete(toolId);
  }

  private cancelPendingToolOutputRenders(): void {
    for (const frame of this.pendingToolOutputFrames.values()) {
      cancelScheduledAnimationFrame(frame);
    }
    this.pendingToolOutputFrames.clear();
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  async appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    state.currentThinkingState.content += content;
    void this.scheduleCurrentThinkingRender();
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentThinkingState) return;
    await this.flushPendingThinkingRender();

    const thinkingState = state.currentThinkingState;
    if (this.getStreamingRenderOptions(thinkingState.content)) {
      await renderer.renderContent(thinkingState.contentEl, thinkingState.content);
    }

    const durationSeconds = finalizeThinkingBlock(thinkingState);

    if (msg && thinkingState.content) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: thinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  private scheduleCurrentThinkingRender(): Promise<void> {
    if (!this.pendingThinkingRenderPromise) {
      this.pendingThinkingRenderPromise = new Promise(resolve => {
        this.resolvePendingThinkingRender = resolve;
      });
    }

    if (this.pendingThinkingRenderFrame === null && !this.isThinkingRenderRunning) {
      this.pendingThinkingRenderFrame = scheduleAnimationFrame(() => {
        this.pendingThinkingRenderFrame = null;
        void this.renderPendingThinking();
      }, this.getThinkingRenderWindow());
    }

    return this.pendingThinkingRenderPromise;
  }

  private async flushPendingThinkingRender(): Promise<void> {
    const pendingRender = this.pendingThinkingRenderPromise;
    if (!pendingRender) return;

    if (this.pendingThinkingRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingThinkingRenderFrame);
      this.pendingThinkingRenderFrame = null;
      void this.renderPendingThinking();
    }

    await pendingRender;
  }

  private async renderPendingThinking(): Promise<void> {
    if (this.isThinkingRenderRunning) return;
    this.isThinkingRenderRunning = true;

    const { state, renderer } = this.deps;
    const thinkingState = state.currentThinkingState;
    const content = thinkingState?.content ?? '';

    try {
      if (thinkingState) {
        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await renderer.renderContent(thinkingState.contentEl, content, options);
        } else {
          await renderer.renderContent(thinkingState.contentEl, content);
        }
        this.scrollToBottom();
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isThinkingRenderRunning = false;
    }

    if (state.currentThinkingState === thinkingState && thinkingState && thinkingState.content !== content) {
      this.pendingThinkingRenderFrame = scheduleAnimationFrame(() => {
        this.pendingThinkingRenderFrame = null;
        void this.renderPendingThinking();
      }, this.getThinkingRenderWindow());
      return;
    }

    const resolve = this.resolvePendingThinkingRender;
    this.pendingThinkingRenderPromise = null;
    this.resolvePendingThinkingRender = null;
    resolve?.();
  }

  private cancelPendingThinkingRender(): void {
    if (this.pendingThinkingRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingThinkingRenderFrame);
      this.pendingThinkingRenderFrame = null;
    }

    const resolve = this.resolvePendingThinkingRender;
    this.pendingThinkingRenderPromise = null;
    this.resolvePendingThinkingRender = null;
    resolve?.();
  }

  // ============================================
  // Subagent Tool Handling (via SubagentManager)
  // ============================================

  /** Delegates Agent tool_use to SubagentManager and updates message based on result. */
  private handleTaskToolUseViaManager(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state, subagentManager } = this.deps;
    this.ensureTaskToolCall(msg, chunk.id, chunk.input);

    const result = subagentManager.handleTaskToolUse(chunk.id, chunk.input, state.currentContentEl);

    switch (result.action) {
      case 'created_sync':
        this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
        this.showThinkingIndicator();
        break;
      case 'created_async':
        this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
        this.showThinkingIndicator();
        break;
      case 'buffered':
        this.showThinkingIndicator();
        break;
      case 'label_updated':
        break;
    }
  }

  /** Renders a pending Agent tool call via SubagentManager and updates message. */
  private renderPendingTaskViaManager(toolId: string, msg: ChatMessage): void {
    const result = this.deps.subagentManager.renderPendingTask(toolId, this.deps.state.currentContentEl);
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, toolId);
    } else {
      this.recordSubagentInMessage(msg, result.info, toolId, 'async');
    }
  }

  /** Resolves a pending Agent tool call when its own tool_result arrives. */
  private renderPendingTaskFromTaskResultViaManager(
    chunk: { id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const result = this.deps.subagentManager.renderPendingTaskFromTaskResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      this.deps.state.currentContentEl,
      chunk.toolUseResult
    );
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
    } else {
      this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
    }
  }

  private recordSubagentInMessage(
    msg: ChatMessage,
    info: SubagentInfo,
    toolId: string,
    mode?: 'async'
  ): void {
    const taskToolCall = this.ensureTaskToolCall(msg, toolId);
    this.applySubagentToTaskToolCall(taskToolCall, info);

    msg.contentBlocks = msg.contentBlocks || [];
    const existingBlock = msg.contentBlocks.find(
      block => block.type === 'subagent' && block.subagentId === toolId
    );
    if (existingBlock && mode && existingBlock.type === 'subagent') {
      existingBlock.mode = mode;
    } else if (!existingBlock) {
      msg.contentBlocks.push(mode
        ? { type: 'subagent', subagentId: toolId, mode }
        : { type: 'subagent', subagentId: toolId }
      );
    }
  }

  private async handleSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'tool_use' | 'tool_result' }> & { subagentId: string },
    msg: ChatMessage,
  ): Promise<void> {
    const parentToolUseId = chunk.subagentId;
    const { subagentManager } = this.deps;

    // If parent Agent call is still pending, child chunk confirms it's sync - render now
    if (subagentManager.hasPendingTask(parentToolUseId)) {
      this.renderPendingTaskViaManager(parentToolUseId, msg);
    }

    const subagentState = subagentManager.getSyncSubagent(parentToolUseId);

    if (!subagentState) {
      return;
    }

    switch (chunk.type) {
      case 'tool_use': {
        const toolCall: ToolCallInfo = {
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
          status: 'running',
          isExpanded: false,
        };
        subagentManager.addSyncToolCall(parentToolUseId, toolCall);
        this.showThinkingIndicator();
        break;
      }

      case 'tool_result': {
        const toolCall = subagentState.info.toolCalls.find((tc: ToolCallInfo) => tc.id === chunk.id);
        if (toolCall) {
          const normalizedContent = this.normalizeToolResultContent(chunk.content);
          const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);
          toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
          toolCall.result = normalizedContent;
          subagentManager.updateSyncToolResult(parentToolUseId, chunk.id, toolCall);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Finalizes a sync subagent when its Agent tool_result is received. */
  private finalizeSubagent(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const isError = chunk.isError || false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);
    const finalized = this.deps.subagentManager.finalizeSyncSubagent(
      chunk.id, chunk.content, isError, chunk.toolUseResult
    );

    const extractedResult = finalized?.result ?? normalizedContent;

    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id);
    taskToolCall.status = isError ? 'error' : 'completed';
    taskToolCall.result = extractedResult;
    if (taskToolCall.subagent) {
      taskToolCall.subagent.status = isError ? 'error' : 'completed';
      taskToolCall.subagent.result = extractedResult;
    }

    if (finalized) {
      this.applySubagentToTaskToolCall(taskToolCall, finalized);
    }

    this.showThinkingIndicator();
  }

  // ============================================
  // Async Subagent Handling
  // ============================================

  /** Handles TaskOutput tool_use (invisible, links to async subagent). */
  private handleAgentOutputToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    _msg: ChatMessage
  ): void {
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };

    this.deps.subagentManager.handleAgentOutputToolUse(toolCall);

    // Show flavor text while waiting for TaskOutput result
    this.showThinkingIndicator();
  }

  private handleAsyncTaskToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): boolean {
    const { subagentManager } = this.deps;
    if (!subagentManager.isPendingAsyncTask(chunk.id)) {
      return false;
    }

    subagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError, chunk.toolUseResult);
    return true;
  }

  /** Handles TaskOutput result to finalize async subagent. */
  private async handleAgentOutputToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): Promise<boolean> {
    const { subagentManager } = this.deps;
    const isLinked = subagentManager.isLinkedAgentOutputTool(chunk.id);

    const handled = subagentManager.handleAgentOutputToolResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      chunk.toolUseResult
    );

    return isLinked || handled !== undefined;
  }

  private async handleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const handled = this.deps.subagentManager.handleAsyncSubagentResult(
      chunk.agentId,
      chunk.status,
      chunk.result
    );
    const lifecycleHandled = handled
      ? false
      : this.handleProviderLifecycleAsyncSubagentResult(chunk, msg);
    if (handled || lifecycleHandled) {
      this.showThinkingIndicator();
    }
  }

  private handleProviderLifecycleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>,
    msg: ChatMessage,
  ): boolean {
    const spawnId = this.lifecycleAgentIdToSpawnId.get(chunk.agentId);
    if (!spawnId) return false;

    const spawnToolCall = msg.toolCalls?.find(toolCall => toolCall.id === spawnId);
    const subagentState = this.lifecycleSubagentStates.get(spawnId);
    if (!spawnToolCall || !subagentState) return false;

    const adapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!adapter?.isSpawnTool(spawnToolCall.name)) return false;

    const result = chunk.result?.trim()
      || (chunk.status === 'error' ? 'Background task failed.' : 'Background task completed.');
    const currentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
    const completedInfo: SubagentInfo = {
      ...currentInfo,
      agentId: chunk.agentId,
      result,
      status: chunk.status,
    };
    spawnToolCall.subagent = completedInfo;
    this.syncProviderSubagentState(subagentState, completedInfo);
    finalizeSubagentBlock(subagentState, result, chunk.status === 'error');
    this.deps.recordRuntimeToolCall?.(spawnToolCall);
    return true;
  }

  /** Callback from SubagentManager when async state changes. Updates messages only (DOM handled by manager). */
  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.updateSubagentInMessages(subagent);
    this.scrollToBottom();
  }

  private updateSubagentInMessages(subagent: SubagentInfo): void {
    const { state } = this.deps;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.role !== 'assistant') continue;
      if (this.linkTaskToolCallToSubagent(msg, subagent)) {
        return;
      }
    }
  }

  private ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>
  ): ToolCallInfo {
    msg.toolCalls = msg.toolCalls || [];
    const existing = msg.toolCalls.find(
      tc => tc.id === toolId && isSubagentToolName(tc.name)
    );
    if (existing) {
      if (input && Object.keys(input).length > 0) {
        existing.input = { ...existing.input, ...input };
      }
      return existing;
    }

    const taskToolCall: ToolCallInfo = {
      id: toolId,
      name: TOOL_TASK,
      input: input ? { ...input } : {},
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  private applySubagentToTaskToolCall(taskToolCall: ToolCallInfo, subagent: SubagentInfo): void {
    taskToolCall.subagent = subagent;
    if (subagent.status === 'completed') taskToolCall.status = 'completed';
    else if (subagent.status === 'error') taskToolCall.status = 'error';
    else taskToolCall.status = 'running';
    if (subagent.result !== undefined) {
      taskToolCall.result = subagent.result;
    }
  }

  private linkTaskToolCallToSubagent(msg: ChatMessage, subagent: SubagentInfo): boolean {
    const taskToolCall = msg.toolCalls?.find(
      tc => tc.id === subagent.id && isSubagentToolName(tc.name)
    );
    if (!taskToolCall) return false;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);
    return true;
  }

  // ============================================
  // Thinking Indicator
  // ============================================

  private static readonly SILENT_TURN_DELAY_MS = 10_000;

  /** Starts the per-tab heartbeat that acknowledges a provider's silent turn. */
  startTurnSilenceIndicator(providerId: ProviderId): void {
    this.stopTurnSilenceIndicator();
    // **Started here because this is what sees the output.** The metrics used
    // to be kept by `InputController` and fed from its generator loop; with
    // that loop gone, every field but the duration was structurally empty and
    // each turn logged a provider that had produced nothing.
    this.turnFeedback = new TurnFeedbackMetrics(performance.now());
    this.silentTurnProviderId = providerId;
    this.silentTurnPaused = false;
    this.silentTurnStartedAt = Date.now();
    this.scheduleSilenceCheck();
  }

  /** Resets the heartbeat when any raw provider chunk arrives. */
  noteTurnActivity(): void {
    if (!this.silentTurnProviderId || this.silentTurnPaused) return;
    this.clearSilenceTimeout();
    this.clearSilentTurnStatus();
    this.silentTurnStartedAt = Date.now();
    this.scheduleSilenceCheck();
  }

  /** Pauses or resumes the heartbeat while Grimoire is awaiting the user. */
  pauseTurnSilenceIndicator(paused: boolean): void {
    this.silentTurnPaused = paused;
    this.clearSilenceTimeout();
    this.clearSilentTurnStatus();
    if (!paused && this.silentTurnProviderId) {
      this.silentTurnStartedAt = Date.now();
      this.scheduleSilenceCheck();
    }
  }

  /** Stops the heartbeat and removes any transient status. */
  /**
   * What the turn's output looked like, and clears it.
   *
   * Consumed rather than read, because a snapshot belongs to one turn and the
   * next one starts its own. `null` when no turn has run since the last read,
   * which is a truer answer than a row of zeros.
   */
  consumeTurnFeedback(): TurnFeedbackMetricsSnapshot | null {
    const metrics = this.turnFeedback;
    this.turnFeedback = null;
    return metrics?.finish(performance.now()) ?? null;
  }

  stopTurnSilenceIndicator(): void {
    this.clearSilenceTimeout();
    this.clearSilentTurnStatus();
    this.silentTurnProviderId = null;
    this.silentTurnPaused = false;
    this.silentTurnStartedAt = null;
  }

  private scheduleSilenceCheck(): void {
    if (!this.silentTurnProviderId || this.silentTurnPaused) return;
    const timerWindow = this.getSilenceTimerWindow();
    this.silentTurnTimerWindow = timerWindow;
    this.silentTurnTimeout = timerWindow.setTimeout(() => {
      this.silentTurnTimeout = null;
      if (this.silentTurnPaused || !this.silentTurnProviderId) return;
      if (this.deps.state.currentThinkingState || this.activeProgressId) {
        this.scheduleSilenceCheck();
        return;
      }
      this.showSilentTurnStatus();
    }, StreamController.SILENT_TURN_DELAY_MS);
  }

  private showSilentTurnStatus(): void {
    const contentEl = this.deps.state.currentContentEl;
    const providerId = this.silentTurnProviderId;
    if (!contentEl || !providerId || this.silentTurnPaused) return;

    this.clearSilentTurnStatus();
    this.hideThinkingIndicator();
    const statusEl = contentEl.createDiv({ cls: 'grimoire-silent-turn-status' });
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.setAttribute('role', 'status');
    const icon = providerCatalog().declarations(providerId).chatUI.icon();
    if (icon) {
      statusEl.appendChild(createProviderIconSvg(icon, {
        className: 'grimoire-silent-turn-status-icon',
        dataProvider: providerId,
        height: 14,
        ownerDocument: statusEl.ownerDocument,
        width: 14,
      }));
    }
    statusEl.createSpan({
      text: `${providerCatalog().displayName(providerId)} · ${t('chat.ui.progress.stillWorking')}`,
    });
    const elapsedEl = statusEl.createSpan({ cls: 'grimoire-silent-turn-status-elapsed' });
    const updateElapsed = () => {
      const startedAt = this.silentTurnStartedAt;
      if (startedAt === null || elapsedEl.isConnected === false) return;
      elapsedEl.setText(` · ${this.formatSilentTurnElapsed(Math.floor((Date.now() - startedAt) / 1000))}`);
    };
    updateElapsed();
    this.silentTurnStatusEl = statusEl;
    const timerWindow = contentEl.ownerDocument.defaultView ?? this.getSilenceTimerWindow();
    this.silentTurnTimerWindow = timerWindow;
    this.silentTurnElapsedInterval = timerWindow.setInterval(updateElapsed, 1000);
    this.scrollToBottom();
  }

  private clearSilenceTimeout(): void {
    if (this.silentTurnTimeout === null) return;
    (this.silentTurnTimerWindow ?? this.getSilenceTimerWindow()).clearTimeout(this.silentTurnTimeout);
    this.silentTurnTimeout = null;
  }

  private clearSilentTurnStatus(): void {
    if (this.silentTurnElapsedInterval !== null) {
      (this.silentTurnTimerWindow ?? this.getSilenceTimerWindow()).clearInterval(this.silentTurnElapsedInterval);
      this.silentTurnElapsedInterval = null;
    }
    this.silentTurnStatusEl?.remove();
    this.silentTurnStatusEl = null;
  }

  private getSilenceTimerWindow(): Window {
    return this.deps.state.currentContentEl?.ownerDocument.defaultView
      ?? this.getMessagesWindow()
      ?? window;
  }

  private formatSilentTurnElapsed(seconds: number): string {
    const totalSeconds = Math.max(0, seconds);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }

  /** Debounce delay before showing thinking indicator (ms). */
  private static readonly THINKING_INDICATOR_DELAY = 400;

  /**
   * Schedules showing the thinking indicator after a delay.
   * If content arrives before the delay, the indicator won't show.
   * This prevents the indicator from appearing during active streaming.
   * Note: Flavor text is hidden when model thinking block is active (thinking takes priority).
   */
  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;

    // Early return if no content element
    if (!state.currentContentEl) return;

    // Clear any existing timeout
    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }

    // Don't show flavor text while model thinking block is active
    if (state.currentThinkingState) {
      return;
    }

    // If indicator already exists, just re-append it to the bottom
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    // Schedule showing the indicator after a delay
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      // Double-check we still have a content element, no indicator exists, and no thinking block
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls
        ? `grimoire-thinking ${overrideCls}`
        : 'grimoire-thinking';
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ text });

      // Create timer span with initial value
      const timerSpan = state.thinkingEl.createSpan({ cls: 'grimoire-thinking-hint' });
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        // Check if element is still connected to DOM (prevents orphaned interval updates)
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) {
            state.clearFlavorTimerInterval();
          }
          return;
        }
        const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
      };
      updateTimer(); // Initial update

      // Start interval to update timer every second
      if (state.flavorTimerInterval) {
        state.clearFlavorTimerInterval();
      }
      const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
      state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);

    }, StreamController.THINKING_INDICATOR_DELAY), timerWindow);
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hideThinkingIndicator(): void {
    const { state } = this.deps;

    // Cancel any pending show timeout
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    // Clear timer interval (but preserve responseStartTime for duration capture)
    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
  }

  // ============================================
  // Compact Boundary
  // ============================================

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'grimoire-compact-boundary' });
    el.createSpan({ cls: 'grimoire-compact-boundary-label', text: t('chat.ui.messages.conversationCompacted') });
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Nudges Obsidian's vault after a Write/Edit/NotebookEdit so the file tree
   * refreshes. Direct `fs` writes bypass the Vault API, and macOS + iCloud
   * FSWatcher often misses the event.
   */
  private notifyVaultFileChange(input: Record<string, unknown>): void {
    const rawPathValue = input.file_path ?? input.notebook_path;
    const rawPath = typeof rawPathValue === 'string' ? rawPathValue : undefined;
    const vaultPath = getVaultPath(this.deps.plugin.app);
    const relativePath = normalizePathForVault(rawPath, vaultPath);
    if (!relativePath || relativePath.startsWith('/')) return;

    window.setTimeout(() => {
      const { vault } = this.deps.plugin.app;
      const file = vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        // Existing file — tell listeners the content changed
        vault.trigger('modify', file);
      } else {
        // New file — scan parent directory so Obsidian discovers it
        const parentDir = relativePath.includes('/')
          ? relativePath.substring(0, relativePath.lastIndexOf('/'))
          : '';
        vault.adapter.list(parentDir).catch(() => { /* ignore */ });
      }
    }, 200);
  }

  /** Refreshes vault for each file path in an apply_patch changes array or patch text. */
  private notifyApplyPatchFileChanges(input: Record<string, unknown>): void {
    const notified = new Set<string>();

    // Legacy changes array
    const changes = input.changes;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        if (change && typeof change === 'object' && !Array.isArray(change)) {
          const changeRecord = change as Record<string, unknown>;
          if (typeof changeRecord.path === 'string') {
            notified.add(changeRecord.path);
            this.notifyVaultFileChange({ file_path: changeRecord.path });
          }
        }
      }
    }

    // Parse file paths from patch text markers (current custom_tool_call format)
    const patchText = typeof input.patch === 'string' ? input.patch : '';
    if (patchText) {
      for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
        const filePath = match[1]?.trim();
        if (filePath && !notified.has(filePath)) {
          this.notifyVaultFileChange({ file_path: filePath });
        }
      }
    }
  }

  /** Scrolls messages to bottom if auto-scroll is enabled. */
  private scrollToBottom(): void {
    if (this.pendingScrollFrame !== null) return;

    this.pendingScrollFrame = scheduleAnimationFrame(() => {
      this.pendingScrollFrame = null;
      this.applyScrollToBottom();
    }, this.getMessagesWindow());
  }

  private applyScrollToBottom(): void {
    const { state, plugin } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    const scrollEl = this.getScrollEl();
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  private cancelPendingScroll(): void {
    if (this.pendingScrollFrame === null) return;

    cancelScheduledAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
  }

  private getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  private getScrollEl(): HTMLElement {
    return this.deps.getScrollEl?.() ?? this.deps.getMessagesEl();
  }

  private getStreamingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentTextEl?.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  private getThinkingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentThinkingState?.contentEl.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    this.cancelPendingTextRender();
    this.cancelPendingThinkingRender();
    this.cancelPendingToolOutputRenders();
    this.cancelPendingScroll();
    this.hideThinkingIndicator();
    this.stopTurnSilenceIndicator();
    for (const progress of this.progressBlocks.values()) {
      cleanupProgressBlock(progress);
    }
    this.progressBlocks.clear();
    this.activeProgressId = null;
    this.currentTextPhase = undefined;
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
    this.deps.subagentManager.resetStreamingState();
    state.pendingTools.clear();
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
  }
}
