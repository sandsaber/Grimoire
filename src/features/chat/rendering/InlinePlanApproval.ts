import { setIcon } from 'obsidian';

import { getToolIcon } from '../../../core/tools/toolIcons';
import { TOOL_ENTER_PLAN_MODE } from '../../../core/tools/toolNames';
import { t } from '../../../i18n/i18n';

export type PlanApprovalDecision =
  | { type: 'implement' }
  | { type: 'revise'; text: string }
  | { type: 'cancel' };

export class InlinePlanApproval {
  private containerEl: HTMLElement;
  private resolveCallback: (decision: PlanApprovalDecision | null) => void;
  private resolved = false;

  private rootEl!: HTMLElement;
  private focusedIndex = 0;
  private items: HTMLElement[] = [];
  private feedbackInput!: HTMLInputElement;
  private collapseBtn!: HTMLButtonElement;
  private collapseIconEl!: HTMLElement;
  private isInputFocused = false;
  private isCollapsed = false;
  private onCollapseChange: ((isCollapsed: boolean) => void) | undefined;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor(
    containerEl: HTMLElement,
    resolve: (decision: PlanApprovalDecision | null) => void,
    /** See the note on `InlineExitPlanMode`: folded, this card frees the composer. */
    onCollapseChange?: (isCollapsed: boolean) => void,
  ) {
    this.containerEl = containerEl;
    this.resolveCallback = resolve;
    this.onCollapseChange = onCollapseChange;
    this.boundKeyDown = (event) => this.handleKeyDown(event);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'grimoire-plan-approval-inline' });

    this.renderHeader();

    const actionsEl = this.rootEl.createDiv({ cls: 'grimoire-ask-list' });

    // 1. Implement
    const implementRow = actionsEl.createDiv({ cls: 'grimoire-ask-item' });
    implementRow.addClass('is-focused');
    implementRow.createSpan({ text: '\u203A', cls: 'grimoire-ask-cursor' });
    implementRow.createSpan({ text: '1', cls: 'grimoire-ask-item-num' });
    implementRow.createSpan({ text: t('chat.ui.plan.implement'), cls: 'grimoire-ask-item-label' });
    implementRow.addEventListener('click', () => {
      this.focusedIndex = 0;
      this.updateFocus();
      this.handleResolve({ type: 'implement' });
    });
    this.items.push(implementRow);

    // 2. Revise (with feedback input)
    const reviseRow = actionsEl.createDiv({ cls: 'grimoire-ask-item grimoire-ask-custom-item' });
    reviseRow.createSpan({ text: '\u00A0', cls: 'grimoire-ask-cursor' });
    reviseRow.createSpan({ text: '2', cls: 'grimoire-ask-item-num' });
    this.feedbackInput = reviseRow.createEl('input', {
      type: 'text',
      cls: 'grimoire-ask-custom-text',
      placeholder: t('chat.ui.plan.reviseFeedbackPlaceholder'),
    });
    this.feedbackInput.addEventListener('focus', () => { this.isInputFocused = true; });
    this.feedbackInput.addEventListener('blur', () => { this.isInputFocused = false; });
    reviseRow.addEventListener('click', () => {
      this.focusedIndex = 1;
      this.updateFocus();
    });
    this.items.push(reviseRow);

    // 3. Cancel
    const cancelRow = actionsEl.createDiv({ cls: 'grimoire-ask-item' });
    cancelRow.createSpan({ text: '\u00A0', cls: 'grimoire-ask-cursor' });
    cancelRow.createSpan({ text: '3', cls: 'grimoire-ask-item-num' });
    cancelRow.createSpan({ text: t('common.cancel'), cls: 'grimoire-ask-item-label' });
    cancelRow.addEventListener('click', () => {
      this.focusedIndex = 2;
      this.updateFocus();
      this.handleResolve({ type: 'cancel' });
    });
    this.items.push(cancelRow);

    this.rootEl.createDiv({ text: t('chat.ui.plan.keyboardHints'), cls: 'grimoire-ask-hints' });

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    window.requestAnimationFrame(() => {
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
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

    this.onCollapseChange?.(isCollapsed);

    this.refreshCollapseToggle();
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
        this.handleResolve({ type: 'revise', text: this.feedbackInput.value.trim() });
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
          this.handleResolve({ type: 'implement' });
        } else if (this.focusedIndex === 1) {
          this.feedbackInput.focus();
        } else if (this.focusedIndex === 2) {
          this.handleResolve({ type: 'cancel' });
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

        if (item.hasClass('grimoire-ask-custom-item') && this.isInputFocused) {
          const input = item.querySelector('.grimoire-ask-custom-text') as HTMLInputElement;
          if (input) {
            input.blur();
            this.isInputFocused = false;
          }
        }
      }
    }
  }

  private handleResolve(decision: PlanApprovalDecision | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      this.rootEl?.remove();
      this.resolveCallback(decision);
    }
  }
}
