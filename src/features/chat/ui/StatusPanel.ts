import { Notice, setIcon } from 'obsidian';

import type { TodoItem } from '../../../core/tools/todo';
import { getToolIcon } from '../../../core/tools/toolIcons';
import { TOOL_TODO_WRITE } from '../../../core/tools/toolNames';
import { t } from '../../../i18n/i18n';
import { renderTodoItems } from '../rendering/todoUtils';

export interface PanelBashOutput {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error';
  output: string;
  exitCode?: number;
}

const MAX_BASH_OUTPUTS = 50;

/**
 * One piece of background work, as the panel draws it.
 *
 * Presentation-shaped on purpose: the projection contract carries no DOM, no
 * class names and no layout vocabulary, so whatever maps a durable record onto
 * this is the thin replaceable layer the plan asks for.
 */
export interface BackgroundAgentCard {
  readonly agentInstanceId: string;
  /** What it was asked to do, as a person can read it. */
  readonly label: string;
  /** How it is going, in the provider's own terms of what is observable. */
  readonly detail: string;
  readonly state: 'running' | 'succeeded' | 'failed';
}

/**
 * StatusPanel - persistent bottom panel for todos and command output.
 */
export class StatusPanel {
  private containerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;

  // Bash output section
  private bashOutputContainerEl: HTMLElement | null = null;
  private bashHeaderEl: HTMLElement | null = null;
  private bashContentEl: HTMLElement | null = null;
  private agentsContainerEl: HTMLElement | null = null;
  private agentsHeaderEl: HTMLElement | null = null;
  private agentsContentEl: HTMLElement | null = null;
  private isBashExpanded = true;
  private currentBashOutputs: Map<string, PanelBashOutput> = new Map();
  private bashEntryExpanded: Map<string, boolean> = new Map();

  // Todo section
  private todoContainerEl: HTMLElement | null = null;
  private todoHeaderEl: HTMLElement | null = null;
  private todoContentEl: HTMLElement | null = null;
  private isTodoExpanded = false;
  private currentTodos: TodoItem[] | null = null;

  // Event handler references for cleanup
  private todoClickHandler: (() => void) | null = null;
  private todoKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private bashClickHandler: (() => void) | null = null;
  private bashKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Mount the panel into the messages container.
   * Appends to the end of the messages area.
   */
  mount(containerEl: HTMLElement): void {
    this.containerEl = containerEl;
    this.createPanel();
  }

  /**
   * Remount the panel to restore state after conversation changes.
   * Re-creates the panel structure and re-renders current state.
   */
  remount(): void {
    if (!this.containerEl) {
      return;
    }

    // Remove old event listeners before removing DOM
    if (this.todoHeaderEl) {
      if (this.todoClickHandler) {
        this.todoHeaderEl.removeEventListener('click', this.todoClickHandler);
      }
      if (this.todoKeydownHandler) {
        this.todoHeaderEl.removeEventListener('keydown', this.todoKeydownHandler);
      }
    }
    this.todoClickHandler = null;
    this.todoKeydownHandler = null;

    if (this.bashHeaderEl) {
      if (this.bashClickHandler) {
        this.bashHeaderEl.removeEventListener('click', this.bashClickHandler);
      }
      if (this.bashKeydownHandler) {
        this.bashHeaderEl.removeEventListener('keydown', this.bashKeydownHandler);
      }
    }
    this.bashClickHandler = null;
    this.bashKeydownHandler = null;

    // Remove old panel from DOM
    if (this.panelEl) {
      this.panelEl.remove();
    }

    // Clear references and recreate
    this.panelEl = null;
    this.bashOutputContainerEl = null;
    this.bashHeaderEl = null;
    this.bashContentEl = null;
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    this.createPanel();

    // Re-render current state
    this.renderBashOutputs();
    if (this.currentTodos && this.currentTodos.length > 0) {
      this.updateTodos(this.currentTodos);
    }
  }

  /**
   * Create the panel structure.
   */
  private createPanel(): void {
    if (!this.containerEl) {
      return;
    }

    // Hidden until there is todo or command output content.
    this.panelEl = this.containerEl.createDiv({ cls: 'grimoire-status-panel grimoire-hidden' });

    // Bash output container - hidden by default
    this.bashOutputContainerEl = this.panelEl.createDiv({
      cls: 'grimoire-status-panel-bash grimoire-hidden',
    });

    this.bashHeaderEl = this.bashOutputContainerEl.createDiv({
      cls: 'grimoire-tool-header grimoire-status-panel-bash-header',
    });
    this.bashHeaderEl.setAttribute('tabindex', '0');
    this.bashHeaderEl.setAttribute('role', 'button');

    this.bashClickHandler = () => this.toggleBashSection();
    this.bashKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleBashSection();
      }
    };
    this.bashHeaderEl.addEventListener('click', this.bashClickHandler);
    this.bashHeaderEl.addEventListener('keydown', this.bashKeydownHandler);

    this.bashContentEl = this.bashOutputContainerEl.createDiv({
      cls: 'grimoire-status-panel-bash-content',
    });

    // Todo container
    this.todoContainerEl = this.panelEl.createDiv({
      cls: 'grimoire-status-panel-todos grimoire-hidden',
    });

    // Todo header (collapsed view)
    this.todoHeaderEl = this.todoContainerEl.createDiv({ cls: 'grimoire-status-panel-header' });
    this.todoHeaderEl.setAttribute('tabindex', '0');
    this.todoHeaderEl.setAttribute('role', 'button');

    // Store handler references for cleanup
    this.todoClickHandler = () => this.toggleTodos();
    this.todoKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleTodos();
      }
    };
    this.todoHeaderEl.addEventListener('click', this.todoClickHandler);
    this.todoHeaderEl.addEventListener('keydown', this.todoKeydownHandler);
    // Todo content (expanded list)
    this.todoContentEl = this.todoContainerEl.createDiv({
      cls: 'grimoire-status-panel-content grimoire-todo-list-container grimoire-hidden',
    });

    // Background agents: work this conversation started that outlives the tab
    // watching it. Read from durable records rather than from anything live,
    // which is the only way an agent launched in a tab that has since closed
    // can be shown at all.
    this.agentsContainerEl = this.panelEl.createDiv({
      cls: 'grimoire-status-panel-agents grimoire-hidden',
    });
    this.agentsHeaderEl = this.agentsContainerEl.createDiv({
      cls: 'grimoire-status-panel-header',
    });
    this.agentsContentEl = this.agentsContainerEl.createDiv({
      cls: 'grimoire-status-panel-content grimoire-agent-card-list',
    });
  }

  /**
   * Shows the background work this conversation owns.
   *
   * **Every one of these is durable.** A subagent that runs inside a turn is
   * drawn in the transcript and finished before the turn is; these are the ones
   * a person started and walked away from, and the point of the card is that
   * walking away — or closing the tab — stops meaning they are lost.
   *
   * An empty list hides the section rather than showing "no agents", because
   * most conversations never start one and a permanent empty row is noise.
   */
  updateBackgroundAgents(agents: readonly BackgroundAgentCard[]): void {
    if (!this.agentsContainerEl || !this.agentsHeaderEl || !this.agentsContentEl) {
      return;
    }
    if (agents.length === 0) {
      this.agentsContainerEl.addClass('grimoire-hidden');
      this.agentsHeaderEl.empty();
      this.agentsContentEl.empty();
      this.updatePanelVisibility();
      return;
    }
    this.agentsContainerEl.removeClass('grimoire-hidden');

    const running = agents.filter(agent => agent.state === 'running').length;
    this.agentsHeaderEl.empty();
    const headerIcon = this.agentsHeaderEl.createSpan({ cls: 'grimoire-status-panel-icon' });
    setIcon(headerIcon, 'bot');
    this.agentsHeaderEl.createSpan({
      cls: 'grimoire-status-panel-title',
      text: running > 0
        ? t('chat.agents.runningCount', { count: String(running) })
        : t('chat.agents.finished'),
    });
    this.agentsHeaderEl.setAttribute('aria-label', running > 0
      ? t('chat.agents.runningCount', { count: String(running) })
      : t('chat.agents.finished'));

    this.agentsContentEl.empty();
    for (const agent of agents) {
      const card = this.agentsContentEl.createDiv({
        cls: `grimoire-agent-card grimoire-agent-card--${agent.state}`,
        attr: { 'data-agent-instance-id': agent.agentInstanceId },
      });
      const icon = card.createSpan({ cls: 'grimoire-agent-card-icon' });
      setIcon(icon, agent.state === 'running' ? 'loader' : agent.state === 'succeeded'
        ? 'check'
        : 'alert-circle');
      card.createSpan({ cls: 'grimoire-agent-card-label', text: agent.label });
      // **What the provider lets anyone see, said out loud.** A card that
      // implied progress for a provider reporting none would be promising
      // something nobody can deliver.
      card.createSpan({
        cls: 'grimoire-agent-card-state',
        text: agent.detail,
      });
    }
    this.updatePanelVisibility();
  }

  /**
   * Update the panel with new todo items.
   * Called by ChatState.onTodosChanged callback when TodoWrite tool is used.
   * Passing null or empty array hides the panel.
   */
  updateTodos(todos: TodoItem[] | null): void {
    if (!this.todoContainerEl || !this.todoHeaderEl || !this.todoContentEl) {
      // Component not ready - don't update internal state to keep it consistent with display
      return;
    }

    // Update internal state only after confirming component is ready
    this.currentTodos = todos;

    if (!todos || todos.length === 0) {
      this.todoContainerEl.addClass('grimoire-hidden');
      this.todoHeaderEl.empty();
      this.todoContentEl.empty();
      this.updatePanelVisibility();
      return;
    }

    this.todoContainerEl.removeClass('grimoire-hidden');
    this.updatePanelVisibility();

    // Count completed and find current task
    const completedCount = todos.filter(t => t.status === 'completed').length;
    const totalCount = todos.length;
    const currentTask = todos.find(t => t.status === 'in_progress');

    // Update header
    this.renderTodoHeader(completedCount, totalCount, currentTask);

    // Update content
    this.renderTodoContent(todos);

    // Update ARIA
    this.updateTodoAriaLabel(completedCount, totalCount);

    this.scrollToBottom();
  }

  /**
   * Render the todo collapsed header.
   */
  private renderTodoHeader(completedCount: number, totalCount: number, currentTask: TodoItem | undefined): void {
    if (!this.todoHeaderEl) return;

    this.todoHeaderEl.empty();
    // List icon
    const icon = this.todoHeaderEl.createSpan({ cls: 'grimoire-status-panel-icon' });
    setIcon(icon, getToolIcon(TOOL_TODO_WRITE));

    // Label
    this.todoHeaderEl.createSpan({
      cls: 'grimoire-status-panel-label',
      text: `Tasks (${completedCount}/${totalCount})`,
    });

    // Collapsed-only elements: status indicator and current task preview
    if (!this.isTodoExpanded) {
      // Status indicator (tick only when all todos complete)
      if (completedCount === totalCount && totalCount > 0) {
        const status = this.todoHeaderEl.createSpan({
          cls: 'grimoire-status-panel-status status-completed',
        });
        setIcon(status, 'check');
      }

      // Current task preview
      if (currentTask) {
        this.todoHeaderEl.createSpan({
          cls: 'grimoire-status-panel-current',
          text: currentTask.activeForm,
        });
      }
    }
  }

  /**
   * Render the expanded todo content.
   */
  private renderTodoContent(todos: TodoItem[]): void {
    if (!this.todoContentEl) return;
    renderTodoItems(this.todoContentEl, todos);
  }

  /**
   * Toggle todo expanded/collapsed state.
   */
  private toggleTodos(): void {
    this.isTodoExpanded = !this.isTodoExpanded;
    this.updateTodoDisplay();
  }

  /**
   * Update todo display based on expanded state.
   */
  private updateTodoDisplay(): void {
    if (!this.todoContentEl || !this.todoHeaderEl) return;

    // Show/hide content
    this.todoContentEl.toggleClass('grimoire-hidden', !this.isTodoExpanded);

    // Re-render header to update current task visibility
    if (this.currentTodos && this.currentTodos.length > 0) {
      const completedCount = this.currentTodos.filter(t => t.status === 'completed').length;
      const totalCount = this.currentTodos.length;
      const currentTask = this.currentTodos.find(t => t.status === 'in_progress');
      this.renderTodoHeader(completedCount, totalCount, currentTask);
      this.updateTodoAriaLabel(completedCount, totalCount);
    }

    this.scrollToBottom();
  }

  /**
   * Update todo ARIA label.
   */
  private updateTodoAriaLabel(completedCount: number, totalCount: number): void {
    if (!this.todoHeaderEl) return;

    const action = this.isTodoExpanded ? 'Collapse' : 'Expand';
    this.todoHeaderEl.setAttribute(
      'aria-label',
      `${action} task list - ${completedCount} of ${totalCount} completed`
    );
    this.todoHeaderEl.setAttribute('aria-expanded', String(this.isTodoExpanded));
  }

  /**
   * Scroll messages container to bottom.
   */
  private scrollToBottom(): void {
    if (this.containerEl) {
      this.containerEl.scrollTop = this.containerEl.scrollHeight;
    }
  }

  // ============================================
  // Bash Output Methods
  // ============================================

  private truncateDescription(description: string, maxLength = 50): string {
    if (description.length <= maxLength) return description;
    return description.substring(0, maxLength) + '...';
  }

  addBashOutput(info: PanelBashOutput): void {
    this.currentBashOutputs.set(info.id, info);
    while (this.currentBashOutputs.size > MAX_BASH_OUTPUTS) {
      let removedOldest = false;
      for (const oldest of this.currentBashOutputs.keys()) {
        this.currentBashOutputs.delete(oldest);
        this.bashEntryExpanded.delete(oldest);
        removedOldest = true;
        break;
      }
      if (!removedOldest) break;
    }
    this.renderBashOutputs();
  }

  updateBashOutput(id: string, updates: Partial<Omit<PanelBashOutput, 'id' | 'command'>>): void {
    const existing = this.currentBashOutputs.get(id);
    if (!existing) return;
    this.currentBashOutputs.set(id, { ...existing, ...updates });
    this.renderBashOutputs();
  }

  clearBashOutputs(): void {
    this.currentBashOutputs.clear();
    this.bashEntryExpanded.clear();
    this.renderBashOutputs();
  }

  private renderBashOutputs(options: { scroll?: boolean } = {}): void {
    if (!this.bashOutputContainerEl || !this.bashHeaderEl || !this.bashContentEl) return;
    const scroll = options.scroll ?? true;

    if (this.currentBashOutputs.size === 0) {
      this.bashOutputContainerEl.addClass('grimoire-hidden');
      this.updatePanelVisibility();
      return;
    }

    this.bashOutputContainerEl.removeClass('grimoire-hidden');
    this.updatePanelVisibility();
    this.bashHeaderEl.empty();
    this.bashContentEl.empty();
    const headerIconEl = this.bashHeaderEl.createSpan({ cls: 'grimoire-tool-icon' });
    headerIconEl.setAttribute('aria-hidden', 'true');
    setIcon(headerIconEl, 'terminal');

    const latest = Array.from(this.currentBashOutputs.values()).at(-1);

    const headerLabelEl = this.bashHeaderEl.createSpan({ cls: 'grimoire-tool-label' });
    if (this.isBashExpanded) {
      headerLabelEl.textContent = t('chat.bangBash.commandPanel');
    } else {
      headerLabelEl.textContent = latest ? this.truncateDescription(latest.command, 60) : t('chat.bangBash.commandPanel');
    }
    const previewEl = this.bashHeaderEl.createSpan({ cls: 'grimoire-tool-current' });
    previewEl.classList.toggle('grimoire-hidden', !this.isBashExpanded);

    const summaryStatusEl = this.bashHeaderEl.createSpan({ cls: 'grimoire-tool-status' });
    if (!this.isBashExpanded && latest) {
      summaryStatusEl.classList.add(`status-${latest.status}`);
      summaryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: latest.status }));
      if (latest.status === 'completed') setIcon(summaryStatusEl, 'check');
      if (latest.status === 'error') setIcon(summaryStatusEl, 'x');
    } else {
      summaryStatusEl.classList.add('grimoire-hidden');
    }
    this.bashHeaderEl.setAttribute('aria-expanded', String(this.isBashExpanded));

    const actionsEl = this.bashHeaderEl.createSpan({ cls: 'grimoire-status-panel-bash-actions' });
    this.appendActionButton(actionsEl, 'copy', t('chat.bangBash.copyAriaLabel'), 'copy', () => {
      void this.copyLatestBashOutput();
    });
    this.appendActionButton(actionsEl, 'clear', t('chat.bangBash.clearAriaLabel'), 'trash', () => {
      this.clearBashOutputs();
    });
    this.bashContentEl.toggleClass('grimoire-hidden', !this.isBashExpanded);

    if (!this.isBashExpanded) {
      return;
    }

    for (const info of this.currentBashOutputs.values()) {
      this.renderBashEntry(info, this.bashContentEl);
    }

    if (scroll) {
      this.bashContentEl.scrollTop = this.bashContentEl.scrollHeight;
      this.scrollToBottom();
    }
  }

  private renderBashEntry(info: PanelBashOutput, parentEl: HTMLElement): HTMLElement {
    const entryEl = parentEl.createDiv({
      cls: 'grimoire-tool-call grimoire-status-panel-bash-entry',
    });

    const entryHeaderEl = entryEl.createDiv({ cls: 'grimoire-tool-header' });
    entryHeaderEl.setAttribute('tabindex', '0');
    entryHeaderEl.setAttribute('role', 'button');

    const entryIconEl = entryHeaderEl.createSpan({ cls: 'grimoire-tool-icon' });
    entryIconEl.setAttribute('aria-hidden', 'true');
    setIcon(entryIconEl, 'dollar-sign');
    entryHeaderEl.createSpan({
      cls: 'grimoire-tool-label',
      text: t('chat.bangBash.commandLabel', { command: this.truncateDescription(info.command, 60) }),
    });

    const entryStatusEl = entryHeaderEl.createSpan({ cls: 'grimoire-tool-status' });
    entryStatusEl.classList.add(`status-${info.status}`);
    entryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: info.status }));
    if (info.status === 'completed') setIcon(entryStatusEl, 'check');
    if (info.status === 'error') setIcon(entryStatusEl, 'x');
    const contentEl = entryEl.createDiv({ cls: 'grimoire-tool-content' });
    const isEntryExpanded = this.bashEntryExpanded.get(info.id) ?? true;
    contentEl.classList.toggle('grimoire-hidden', !isEntryExpanded);
    entryHeaderEl.setAttribute('aria-expanded', String(isEntryExpanded));
    entryHeaderEl.setAttribute('aria-label', isEntryExpanded ? t('chat.bangBash.collapseOutput') : t('chat.bangBash.expandOutput'));
    entryHeaderEl.addEventListener('click', () => {
      this.bashEntryExpanded.set(info.id, !isEntryExpanded);
      this.renderBashOutputs({ scroll: false });
    });
    entryHeaderEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.bashEntryExpanded.set(info.id, !isEntryExpanded);
        this.renderBashOutputs({ scroll: false });
      }
    });

    const rowEl = contentEl.createDiv({ cls: 'grimoire-tool-result-row' });

    const textEl = rowEl.createSpan({ cls: 'grimoire-tool-result-text' });
    if (info.status === 'running' && !info.output) {
      textEl.textContent = t('chat.bangBash.running');
    } else if (info.output) {
      textEl.textContent = info.output;
    }

    return entryEl;
  }

  private updatePanelVisibility(): void {
    if (!this.panelEl) {
      return;
    }

    const hasTodos = this.todoContainerEl
      ? !this.todoContainerEl.classList.contains('grimoire-hidden')
      : false;
    const hasBashOutput = this.bashOutputContainerEl
      ? !this.bashOutputContainerEl.classList.contains('grimoire-hidden')
      : false;
    const hasAgents = this.agentsContainerEl
      ? !this.agentsContainerEl.classList.contains('grimoire-hidden')
      : false;

    this.panelEl.classList.toggle(
      'grimoire-hidden',
      !hasTodos && !hasBashOutput && !hasAgents,
    );
  }

  private async copyLatestBashOutput(): Promise<void> {
    const latest = Array.from(this.currentBashOutputs.values()).at(-1);
    if (!latest) return;

    const output = latest.output?.trim() || (latest.status === 'running' ? t('chat.bangBash.running') : '');
    const text = output ? `$ ${latest.command}\n${output}` : `$ ${latest.command}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      new Notice(t('chat.bangBash.copyFailed'));
    }
  }

  private appendActionButton(
    parent: HTMLElement,
    name: string,
    ariaLabel: string,
    icon: string,
    action: () => void
  ): void {
    const el = parent.createSpan({
      cls: `grimoire-status-panel-bash-action grimoire-status-panel-bash-action-${name}`,
    });
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', ariaLabel);
    setIcon(el, icon);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      action();
    });
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        action();
      }
    });
  }

  private toggleBashSection(): void {
    this.isBashExpanded = !this.isBashExpanded;
    this.renderBashOutputs({ scroll: false });
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Destroy the panel.
   */
  destroy(): void {
    // Remove event listeners before removing elements
    if (this.todoHeaderEl) {
      if (this.todoClickHandler) {
        this.todoHeaderEl.removeEventListener('click', this.todoClickHandler);
      }
      if (this.todoKeydownHandler) {
        this.todoHeaderEl.removeEventListener('keydown', this.todoKeydownHandler);
      }
    }
    this.todoClickHandler = null;
    this.todoKeydownHandler = null;

    if (this.bashHeaderEl) {
      if (this.bashClickHandler) {
        this.bashHeaderEl.removeEventListener('click', this.bashClickHandler);
      }
      if (this.bashKeydownHandler) {
        this.bashHeaderEl.removeEventListener('keydown', this.bashKeydownHandler);
      }
    }
    this.bashClickHandler = null;
    this.bashKeydownHandler = null;

    // Clear bash output tracking
    this.currentBashOutputs.clear();

    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    this.bashOutputContainerEl = null;
    this.bashHeaderEl = null;
    this.bashContentEl = null;
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    // Nulled with the rest, and it matters more than it looks: the background
    // agent read is asynchronous, so an `updateBackgroundAgents` can arrive
    // after the tab is gone. Left pointing at detached nodes, these would pass
    // the guard at the top of that method and build cards into DOM nobody can
    // see, holding the whole subtree for as long as the closed tab's panel.
    this.agentsContainerEl = null;
    this.agentsHeaderEl = null;
    this.agentsContentEl = null;
    this.containerEl = null;
    this.currentTodos = null;
  }
}
