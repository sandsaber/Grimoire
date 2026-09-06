import { setIcon } from 'obsidian';

import { t } from '../../../../i18n/i18n';
import { asActivatable, markDecorative } from '../../../../shared/components/activatable';
import type { ContextItem } from './contextItems';
import {
  attachedTokens,
  formatTokens,
  isOverBudget,
  overBudgetTokens,
  projectedPercent,
  truncateName,
} from './contextItems';
import type { ContextStore } from './ContextStore';

/**
 * Past this many attachments the chip row stops being a row and starts being
 * the composer. Four is where the design draws it; the fifth collapses.
 */
export const CHIP_THRESHOLD = 4;

export interface ContextComposerCallbacks {
  onOpenManager: (anchor: HTMLElement) => void;
  onOpenPicker: (anchor: HTMLElement) => void;
  onOpenItem?: (item: ContextItem) => void;
  /** The composer card, whose border says when this message is over budget. */
  cardEl?: HTMLElement | null;
}

const KIND_ICONS: Record<ContextItem['kind'], string> = {
  'vault-file': 'file-text',
  'vault-folder': 'folder',
  'external-file': 'file',
  'link': 'link',
  'selection': 'text-cursor-input',
  'open-note': 'file-text',
};

/**
 * What the composer says about what is attached.
 *
 * Up to four things, it says all of them and each can be removed where it
 * stands. Past four it says the count, the cost and the share of the window,
 * and points at the dialog — because a chip row that wraps to three lines has
 * taken the space the message was going to be written in.
 */
export class ContextComposerView {
  private readonly rootEl: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(
    parentEl: HTMLElement,
    private readonly store: ContextStore,
    private readonly callbacks: ContextComposerCallbacks,
  ) {
    this.rootEl = parentEl.createDiv({ cls: 'grimoire-context-attachments' });
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.rootEl.remove();
  }

  private render(): void {
    this.rootEl.empty();
    const items = this.store.getItems();
    const budget = this.store.getBudget();
    const over = items.length > 0 && isOverBudget(items, budget);

    this.callbacks.cardEl?.toggleClass?.('is-over-budget', over);
    this.rootEl.toggleClass('grimoire-hidden', items.length === 0);
    if (items.length === 0) return;

    if (over) {
      this.renderOverBudgetRow(items, budget);
      return;
    }
    if (items.length > CHIP_THRESHOLD) {
      this.renderSummaryRow(items, budget);
      return;
    }
    this.renderChips(items);
  }

  private renderChips(items: readonly ContextItem[]): void {
    const row = this.rootEl.createDiv({ cls: 'grimoire-context-chips' });
    for (const item of items) {
      const chip = row.createDiv({ cls: 'grimoire-file-chip' });
      const icon = chip.createSpan({ cls: 'grimoire-file-chip-icon' });
      setIcon(icon, KIND_ICONS[item.kind]);
      markDecorative(icon);
      const name = chip.createSpan({
        cls: 'grimoire-file-chip-name',
        text: truncateName(item.name),
      });
      name.setAttribute('title', item.path);
      const remove = chip.createEl('button', {
        cls: 'grimoire-file-chip-remove',
        attr: {
          type: 'button',
          'aria-label': t('chat.ui.contextManager.removeNamed', { name: item.name }),
        },
      });
      setIcon(remove, 'x');
      remove.addEventListener('click', event => {
        event.stopPropagation();
        this.store.remove(item.id);
      });
      if (this.callbacks.onOpenItem) {
        chip.addEventListener('click', event => {
          if ((event.target as HTMLElement).closest('button')) return;
          this.callbacks.onOpenItem?.(item);
        });
      }
    }
    this.appendAddChip(row);
  }

  /** The dashed chip at the end of the row: add is always one click away. */
  private appendAddChip(row: HTMLElement): void {
    const add = row.createDiv({ cls: 'grimoire-file-chip grimoire-file-chip--add' });
    const icon = add.createSpan({ cls: 'grimoire-file-chip-icon' });
    setIcon(icon, 'plus');
    markDecorative(icon);
    add.createSpan({ cls: 'grimoire-file-chip-name', text: t('chat.ui.contextManager.add') });
    asActivatable(add, {
      label: t('chat.ui.contextManager.addContext'),
      onActivate: () => this.callbacks.onOpenPicker(add),
    });
  }

  private renderSummaryRow(
    items: readonly ContextItem[],
    budget: { windowTokens: number; usedTokens: number },
  ): void {
    const summary = this.rootEl.createDiv({ cls: 'grimoire-context-summary-bar' });
    const icon = summary.createSpan({ cls: 'grimoire-context-summary-icon' });
    setIcon(icon, 'file-text');
    markDecorative(icon);
    summary.createSpan({
      cls: 'grimoire-context-summary-count',
      text: t('chat.ui.contextManager.fileCount', { count: items.length }),
    });
    const percent = projectedPercent(items, budget);
    summary.createSpan({
      cls: 'grimoire-context-summary-cost',
      text: percent === null
        ? t('chat.ui.contextManager.estimatedTokens', {
          tokens: formatTokens(attachedTokens(items).total),
        })
        : t('chat.ui.contextManager.summaryCost', {
          tokens: formatTokens(attachedTokens(items).total),
          percent,
        }),
    });
    summary.createDiv({ cls: 'grimoire-context-summary-spacer' });

    const add = summary.createEl('button', {
      cls: 'grimoire-icon-btn grimoire-icon-btn--small',
      attr: { type: 'button', 'aria-label': t('chat.ui.contextManager.addContext') },
    });
    setIcon(add, 'plus');
    add.addEventListener('click', () => this.callbacks.onOpenPicker(add));

    const manage = summary.createEl('button', {
      cls: 'grimoire-context-summary-manage',
      attr: { type: 'button' },
    });
    const manageIcon = manage.createSpan();
    setIcon(manageIcon, 'list');
    markDecorative(manageIcon);
    manage.createSpan({ text: t('chat.ui.contextManager.manage') });
    manage.addEventListener('click', () => this.callbacks.onOpenManager(manage));

    this.renderRecentChips(items);
  }

  /** The three most recently added, without remove buttons, and the rest as a count. */
  private renderRecentChips(items: readonly ContextItem[]): void {
    const row = this.rootEl.createDiv({ cls: 'grimoire-context-chips grimoire-context-chips--recent' });
    const recent = items.slice(-3);
    for (const item of recent) {
      const chip = row.createDiv({ cls: 'grimoire-file-chip grimoire-file-chip--static' });
      const icon = chip.createSpan({ cls: 'grimoire-file-chip-icon' });
      setIcon(icon, KIND_ICONS[item.kind]);
      markDecorative(icon);
      const name = chip.createSpan({
        cls: 'grimoire-file-chip-name',
        text: truncateName(item.name),
      });
      name.setAttribute('title', item.path);
    }
    const hidden = items.length - recent.length;
    if (hidden <= 0) return;
    const more = row.createEl('button', {
      cls: 'grimoire-context-more',
      text: t('chat.ui.contextManager.more', { count: hidden }),
      attr: { type: 'button' },
    });
    more.addEventListener('click', () => this.callbacks.onOpenManager(more));
  }

  /**
   * Over budget. Send stays enabled — the reader decides, and a file silently
   * dropped is a turn that goes out about a file it does not have.
   */
  private renderOverBudgetRow(
    items: readonly ContextItem[],
    budget: { windowTokens: number; usedTokens: number },
  ): void {
    const row = this.rootEl.createDiv({ cls: 'grimoire-context-summary-bar is-over-budget' });
    const icon = row.createSpan({ cls: 'grimoire-context-summary-icon is-over-budget' });
    setIcon(icon, 'alert-circle');
    markDecorative(icon);
    row.createSpan({
      cls: 'grimoire-context-summary-count',
      text: t('chat.ui.contextManager.overBudget', {
        count: items.length,
        tokens: formatTokens(attachedTokens(items).total + Math.max(0, budget.usedTokens)),
      }),
    });
    row.createSpan({
      cls: 'grimoire-context-summary-cost',
      text: t('chat.ui.contextManager.overBudgetBy', {
        tokens: formatTokens(overBudgetTokens(items, budget)),
      }),
    });
    row.createDiv({ cls: 'grimoire-context-summary-spacer' });
    const review = row.createEl('button', {
      cls: 'grimoire-context-summary-manage',
      text: t('chat.ui.contextManager.review'),
      attr: { type: 'button' },
    });
    review.addEventListener('click', () => this.callbacks.onOpenManager(review));
  }
}
