import * as fs from 'fs';
import { setIcon } from 'obsidian';
import * as nodePath from 'path';

import { getToolIcon } from '../../../core/tools/toolIcons';
import { TOOL_ENTER_PLAN_MODE } from '../../../core/tools/toolNames';
import type { ExitPlanModeDecision } from '../../../core/types/tools';
import { t } from '../../../i18n/i18n';
import type { RenderContentFn } from './MessageRenderer';

export class InlineExitPlanMode {
  private containerEl: HTMLElement;
  private input: Record<string, unknown>;
  private resolveCallback: (decision: ExitPlanModeDecision | null) => void;
  private resolved = false;
  private signal?: AbortSignal;
  private renderContent?: RenderContentFn;
  private planPathPrefix?: string;
  private planContent: string | null = null;
  private planReadError: string | null = null;
  private onCollapseChange: ((isCollapsed: boolean) => void) | undefined;

  private rootEl!: HTMLElement;
  private focusedIndex = 0;
  private items: HTMLElement[] = [];
  private feedbackInput!: HTMLInputElement;
  private collapseBtn!: HTMLButtonElement;
  private collapseIconEl!: HTMLElement;
  private isInputFocused = false;
  private isCollapsed = false;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private abortHandler: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    input: Record<string, unknown>,
    resolve: (decision: ExitPlanModeDecision | null) => void,
    signal?: AbortSignal,
    renderContent?: RenderContentFn,
    planPathPrefix?: string,
    /**
     * Told when the card folds away, because the card stands where the
     * composer does. Folded, it is a one-line reminder rather than a surface
     * asking for something — and with the composer still hidden behind it the
     * pane had no text field at all, which reads as a broken tab rather than as
     * a decision waiting.
     */
    onCollapseChange?: (isCollapsed: boolean) => void,
  ) {
    this.containerEl = containerEl;
    this.input = input;
    this.resolveCallback = resolve;
    this.signal = signal;
    this.renderContent = renderContent;
    this.planPathPrefix = planPathPrefix;
    this.onCollapseChange = onCollapseChange;
    this.boundKeyDown = (event) => this.handleKeyDown(event);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'grimoire-plan-approval-inline' });

    this.renderHeader();

    this.planContent = this.readPlanContent();
    if (this.planContent) {
      const contentEl = this.rootEl.createDiv({ cls: 'grimoire-plan-content-preview' });
      if (this.renderContent) {
        void this.renderContent(contentEl, this.planContent);
      } else {
        contentEl.createDiv({ cls: 'grimoire-plan-content-text', text: this.planContent });
      }
    } else if (this.planReadError) {
      this.rootEl.createDiv({
        cls: 'grimoire-plan-content-preview grimoire-plan-read-error',
        text: `Could not read plan file: ${this.planReadError}.`,
      });
    }

    const allowedPrompts = this.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
    if (allowedPrompts && Array.isArray(allowedPrompts) && allowedPrompts.length > 0) {
      const permEl = this.rootEl.createDiv({ cls: 'grimoire-plan-permissions' });
      permEl.createDiv({ text: t('chat.ui.plan.requestedPermissions'), cls: 'grimoire-plan-permissions-label' });
      // One line under the label rather than a bulleted list: three short
      // phrases set as list items claimed as much of the card as the plan.
      permEl.createDiv({
        cls: 'grimoire-plan-permissions-line',
        text: allowedPrompts.map(perm => perm.prompt).join(' \u00B7 '),
      });
    }

    const actionsEl = this.rootEl.createDiv({ cls: 'grimoire-ask-list' });

    const approveRow = actionsEl.createDiv({ cls: 'grimoire-ask-item' });
    approveRow.addClass('is-focused');
    approveRow.createSpan({ text: '\u203A', cls: 'grimoire-ask-cursor' });
    approveRow.createSpan({ text: '1', cls: 'grimoire-ask-item-num' });
    approveRow.createSpan({ text: t('chat.ui.plan.approveCurrentSession'), cls: 'grimoire-ask-item-label' });
    approveRow.addEventListener('click', () => {
      this.focusedIndex = 0;
      this.updateFocus();
      this.handleResolve({ type: 'approve' });
    });
    this.items.push(approveRow);

    const feedbackRow = actionsEl.createDiv({ cls: 'grimoire-ask-item grimoire-ask-custom-item' });
    feedbackRow.createSpan({ text: '\u00A0', cls: 'grimoire-ask-cursor' });
    feedbackRow.createSpan({ text: '2', cls: 'grimoire-ask-item-num' });
    this.feedbackInput = feedbackRow.createEl('input', {
      type: 'text',
      cls: 'grimoire-ask-custom-text',
      placeholder: t('chat.ui.plan.continueFeedbackPlaceholder'),
    });
    this.feedbackInput.addEventListener('focus', () => { this.isInputFocused = true; });
    this.feedbackInput.addEventListener('blur', () => { this.isInputFocused = false; });
    feedbackRow.addEventListener('click', () => {
      this.focusedIndex = 1;
      this.updateFocus();
    });
    this.items.push(feedbackRow);

    this.rootEl.createDiv({ text: t('chat.ui.plan.keyboardHints'), cls: 'grimoire-ask-hints' });

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    window.requestAnimationFrame(() => {
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    if (this.signal) {
      this.abortHandler = () => this.handleResolve(null);
      this.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  destroy(): void {
    this.handleResolve(null);
  }

  private renderHeader(): void {
    const head = this.rootEl.createDiv({ cls: 'grimoire-plan-inline-title' });

    const glyph = head.createDiv({ cls: 'grimoire-plan-glyph' });
    setIcon(glyph, getToolIcon(TOOL_ENTER_PLAN_MODE));

    const titleBlock = head.createDiv({ cls: 'grimoire-plan-title-block' });
    titleBlock.createDiv({ text: t('chat.ui.plan.complete'), cls: 'grimoire-plan-title' });
    titleBlock.createDiv({
      text: t('chat.ui.plan.reviewBeforeProceeding'),
      cls: 'grimoire-plan-subtitle',
    });

    // The tool's name in the meta face. The glyph beside the title already says
    // which tool this is, so drawing it again in the tag said it twice.
    const pill = head.createDiv({ cls: 'grimoire-plan-tool-pill' });
    pill.createSpan({ text: t('chat.ui.plan.label'), cls: 'grimoire-plan-tool-label' });

    this.collapseBtn = head.createEl('button', {
      cls: 'grimoire-plan-collapse-toggle',
      attr: { type: 'button' },
    });
    this.collapseIconEl = this.collapseBtn.createSpan({ cls: 'grimoire-plan-collapse-icon' });
    this.collapseBtn.addEventListener('click', () => {
      this.setCollapsed(!this.isCollapsed);
    });
    this.collapseBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.stopPropagation();
      }
    });
    this.refreshCollapseToggle();
  }

  private setCollapsed(isCollapsed: boolean): void {
    if (this.isCollapsed === isCollapsed) return;

    this.isCollapsed = isCollapsed;
    this.rootEl.classList.toggle('is-collapsed', isCollapsed);

    if (isCollapsed && this.isInputFocused) {
      this.isInputFocused = false;
      this.feedbackInput.blur();
      this.rootEl.focus();
    }

    this.refreshCollapseToggle();
    this.onCollapseChange?.(isCollapsed);
  }

  private refreshCollapseToggle(): void {
    if (!this.collapseBtn) return;

    const label = this.isCollapsed ? t('chat.ui.plan.expand') : t('chat.ui.plan.collapse');
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.setAttribute('title', label);
    this.collapseBtn.setAttribute('aria-expanded', String(!this.isCollapsed));

    if (this.collapseIconEl) {
      this.collapseIconEl.empty();
      setIcon(this.collapseIconEl, this.isCollapsed ? 'chevron-up' : 'chevron-down');
    }
  }

  private readPlanContent(): string | null {
    const planFilePath = this.input.planFilePath as string | undefined;
    if (!planFilePath) return null;

    const resolved = nodePath.resolve(planFilePath).replace(/\\/g, '/');
    if (!this.planPathPrefix || !resolved.includes(this.planPathPrefix)) {
      this.planReadError = 'path outside allowed plan directory';
      return null;
    }

    try {
      const content = fs.readFileSync(planFilePath, 'utf-8');
      return content.trim() || null;
    } catch (err) {
      this.planReadError = err instanceof Error ? err.message : 'unknown error';
      return null;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isInputFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        this.feedbackInput.blur();
        this.rootEl.focus();
        return;
      }
      if (e.key === 'Enter' && this.feedbackInput.value.trim()) {
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve({ type: 'feedback', text: this.feedbackInput.value.trim() });
        return;
      }
      return;
    }

    if (this.isCollapsed) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.min(this.focusedIndex + 1, this.items.length - 1);
        this.updateFocus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
        this.updateFocus();
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedIndex === 0) {
          this.handleResolve({ type: 'approve' });
        } else if (this.focusedIndex === 1) {
          this.feedbackInput.focus();
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
        break;
    }
  }

  private updateFocus(): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const cursor = item.querySelector('.grimoire-ask-cursor');
      if (i === this.focusedIndex) {
        item.addClass('is-focused');
        if (cursor) cursor.textContent = '\u203A';
        item.scrollIntoView({ block: 'nearest' });

        if (item.hasClass('grimoire-ask-custom-item')) {
          const input = item.querySelector('.grimoire-ask-custom-text') as HTMLInputElement;
          if (input) {
            input.focus();
            this.isInputFocused = true;
          }
        }
      } else {
        item.removeClass('is-focused');
        if (cursor) cursor.textContent = '\u00A0';

        if (item.hasClass('grimoire-ask-custom-item')) {
          const input = item.querySelector('.grimoire-ask-custom-text') as HTMLInputElement;
          if (input && this.rootEl.ownerDocument.activeElement === input) {
            input.blur();
            this.isInputFocused = false;
          }
        }
      }
    }
  }

  private handleResolve(decision: ExitPlanModeDecision | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener('abort', this.abortHandler);
        this.abortHandler = null;
      }
      this.rootEl?.remove();
      this.resolveCallback(decision);
    }
  }
}
