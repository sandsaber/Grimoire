import { type App, Modal, setIcon } from 'obsidian';

import { t } from '../../../../i18n/i18n';
import { asActivatable, markDecorative } from '../../../../shared/components/activatable';
import type { ContextGroup, ContextItem } from './contextItems';
import {
  attachedTokens,
  formatTokens,
  groupItems,
  isOverBudget,
  overBudgetTokens,
  projectedPercent,
} from './contextItems';
import type { ContextStore } from './ContextStore';

/** A vault path the picker can offer, with what it would cost. */
export interface ContextCandidate {
  path: string;
  name: string;
  detail: string;
  tokens: number | null;
  /**
   * A folder, which is attached by expanding it.
   *
   * Nothing downstream of the composer can take a folder, so a folder row that
   * stayed a folder would be a promise the backend does not keep.
   */
  folder?: boolean;
}

export interface ContextManagerCallbacks {
  /** Vault paths matching a query, for the "type to add" half of the search band. */
  search: (query: string) => ContextCandidate[];
  /** Attaches one candidate. */
  attach: (candidate: ContextCandidate) => void;
  /** Opens the add picker, which can stay open across repeated adds. */
  openPicker: () => void;
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
 * The full list of what is attached: grouped, searchable, priced, and
 * removable one row or many at a time.
 *
 * The composer can only ever show a handful of chips before it eats the
 * message being written, so past four attachments it collapses to a summary
 * and this is where the reader actually decides what to keep.
 */
export class ContextManagerModal extends Modal {
  private readonly selected = new Set<string>();
  private query = '';
  private confirmingRemoveAll = false;
  private unsubscribe: (() => void) | null = null;
  private listEl: HTMLElement | null = null;
  private bulkBarEl: HTMLElement | null = null;
  private headerCountEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private readonly returnFocusTo: HTMLElement | null;
  /** Row order as drawn, so ↑↓ and shift-less range keys have something to walk. */
  private rowOrder: string[] = [];
  private focusedId: string | null = null;

  constructor(
    app: App,
    private readonly store: ContextStore,
    private readonly callbacks: ContextManagerCallbacks,
    returnFocusTo?: HTMLElement | null,
  ) {
    super(app);
    this.returnFocusTo = returnFocusTo ?? null;
  }

  onOpen(): void {
    this.modalEl.addClass('grimoire-context-modal');
    this.modalEl.setAttribute('aria-label', t('chat.ui.contextManager.title'));
    this.contentEl.addClass('grimoire-context-manager');

    this.buildHeader();
    this.buildSearchBand();
    this.bulkBarEl = this.contentEl.createDiv({ cls: 'grimoire-context-bulk grimoire-hidden' });
    this.listEl = this.contentEl.createDiv({ cls: 'grimoire-context-list' });
    this.listEl.setAttribute('role', 'listbox');
    this.listEl.setAttribute('aria-multiselectable', 'true');
    this.footerEl = this.contentEl.createDiv({ cls: 'grimoire-context-footer' });

    this.unsubscribe = this.store.subscribe(() => this.render());
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });
    this.contentEl.addEventListener('keydown', event => this.handleKeydown(event));
    this.render();
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.selected.clear();
    this.contentEl.empty();
    // Closing returns the reader where they were, which for a dialog opened
    // from a one-line summary row is the only way back to it.
    this.returnFocusTo?.focus?.();
  }

  private buildHeader(): void {
    const header = this.contentEl.createDiv({ cls: 'grimoire-context-header' });
    header.createDiv({
      cls: 'grimoire-context-title',
      text: t('chat.ui.contextManager.title'),
    });
    this.headerCountEl = header.createDiv({ cls: 'grimoire-context-header-count' });
    header.createDiv({ cls: 'grimoire-context-header-spacer' });
    const close = header.createEl('button', {
      cls: 'grimoire-icon-btn',
      attr: { type: 'button', 'aria-label': t('common.close') },
    });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.close());
  }

  private buildSearchBand(): void {
    const band = this.contentEl.createDiv({ cls: 'grimoire-context-search' });
    const icon = band.createSpan({ cls: 'grimoire-context-search-icon' });
    setIcon(icon, 'search');
    markDecorative(icon);
    const input = band.createEl('input', {
      cls: 'grimoire-context-search-input',
      attr: {
        type: 'text',
        placeholder: t('chat.ui.contextManager.searchPlaceholder'),
        'aria-label': t('chat.ui.contextManager.searchPlaceholder'),
      },
    });
    input.addEventListener('input', () => {
      this.query = input.value;
      this.render();
    });
    const add = band.createEl('button', {
      cls: 'grimoire-primary-action',
      text: t('chat.ui.contextManager.add'),
      attr: { type: 'button' },
    });
    add.addEventListener('click', () => this.callbacks.openPicker());
  }

  private render(): void {
    if (!this.listEl || !this.footerEl) return;
    const items = this.store.getItems();
    const budget = this.store.getBudget();
    const { total, uncounted } = attachedTokens(items);

    this.headerCountEl?.setText(t('chat.ui.contextManager.headerCount', {
      count: items.length,
      tokens: formatTokens(total),
    }));

    this.renderBulkBar(items);
    this.renderList(items);
    this.renderFooter(items, budget, uncounted);
  }

  private renderBulkBar(items: readonly ContextItem[]): void {
    const bar = this.bulkBarEl;
    if (!bar) return;
    bar.empty();
    const selectedItems = items.filter(item => this.selected.has(item.id));
    bar.toggleClass('grimoire-hidden', selectedItems.length === 0);
    if (selectedItems.length === 0) return;

    bar.createSpan({
      cls: 'grimoire-context-bulk-count',
      text: t('chat.ui.contextManager.selected', { count: selectedItems.length }),
    });
    bar.createSpan({
      cls: 'grimoire-context-bulk-tokens',
      text: t('chat.ui.contextManager.estimatedTokens', {
        tokens: formatTokens(attachedTokens(selectedItems).total),
      }),
    });
    bar.createDiv({ cls: 'grimoire-context-bulk-spacer' });
    const clear = bar.createEl('button', {
      cls: 'grimoire-context-bulk-clear',
      text: t('chat.ui.contextManager.clearSelection'),
      attr: { type: 'button' },
    });
    clear.addEventListener('click', () => {
      this.selected.clear();
      this.render();
    });
    // A destructive action keeps its verb, always.
    const remove = bar.createEl('button', {
      cls: 'grimoire-context-bulk-remove',
      attr: { type: 'button' },
    });
    const removeIcon = remove.createSpan({ cls: 'grimoire-context-bulk-remove-icon' });
    setIcon(removeIcon, 'trash-2');
    markDecorative(removeIcon);
    remove.createSpan({ text: t('common.remove') });
    remove.addEventListener('click', () => this.removeSelected());
  }

  private renderList(items: readonly ContextItem[]): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    this.rowOrder = [];

    const query = this.query.trim().toLowerCase();
    const matching = query
      ? items.filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query))
      : [...items];

    // One field, two jobs: when the query matches nothing attached, it starts
    // offering the vault instead of showing an empty list and a dead end.
    if (query && matching.length === 0) {
      this.renderCandidates(list, query);
      return;
    }

    if (matching.length === 0) {
      list.createDiv({
        cls: 'grimoire-context-empty',
        text: t('chat.ui.contextManager.empty'),
      });
      return;
    }

    const flashing = this.store.takeDuplicates();
    for (const [group, groupItemList] of groupItems(matching)) {
      list.createDiv({
        cls: 'grimoire-group-label',
        text: this.groupLabel(group, groupItemList.length),
      });
      for (const item of groupItemList) {
        this.renderRow(list, item, flashing.has(item.id));
        this.rowOrder.push(item.id);
      }
    }
  }

  private groupLabel(group: ContextGroup, count: number): string {
    const name = group === 'vault'
      ? t('chat.ui.contextManager.groupVault')
      : t('chat.ui.contextManager.groupExternal');
    return `${name} · ${count}`;
  }

  private renderCandidates(list: HTMLElement, query: string): void {
    const candidates = this.callbacks.search(query).slice(0, 20);
    list.createDiv({
      cls: 'grimoire-group-label',
      text: t('chat.ui.contextManager.groupFromVault'),
    });
    if (candidates.length === 0) {
      list.createDiv({
        cls: 'grimoire-context-empty',
        text: t('chat.ui.contextManager.noMatches'),
      });
      return;
    }
    for (const candidate of candidates) {
      const row = list.createDiv({ cls: 'grimoire-context-row grimoire-context-row--candidate' });
      const icon = row.createSpan({ cls: 'grimoire-context-row-icon' });
      setIcon(icon, candidate.folder ? 'folder' : 'file-text');
      markDecorative(icon);
      row.createSpan({ cls: 'grimoire-context-row-name', text: candidate.name });
      row.createSpan({ cls: 'grimoire-context-row-detail', text: candidate.detail });
      row.createDiv({ cls: 'grimoire-context-row-spacer' });
      row.createSpan({
        cls: 'grimoire-context-row-tokens',
        text: formatTokens(candidate.tokens),
      });
      const add = row.createEl('button', {
        cls: 'grimoire-icon-btn grimoire-icon-btn--small',
        attr: { type: 'button', 'aria-label': t('chat.ui.contextManager.addNamed', { name: candidate.name }) },
      });
      setIcon(add, 'plus');
      add.addEventListener('click', () => this.callbacks.attach(candidate));
    }
  }

  private renderRow(list: HTMLElement, item: ContextItem, flash: boolean): void {
    const failed = item.state === 'failed';
    const row = list.createDiv({
      cls: [
        'grimoire-context-row',
        failed ? 'is-failed' : '',
        this.selected.has(item.id) ? 'is-selected' : '',
        flash ? 'is-duplicate' : '',
      ].filter(Boolean).join(' '),
    });
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(this.selected.has(item.id)));
    row.dataset.contextId = item.id;

    // A failed item cannot contribute to context, only be removed, so it has
    // no checkbox to tick rather than a checkbox that does nothing.
    if (!failed) {
      const checkbox = row.createSpan({ cls: 'grimoire-context-checkbox' });
      checkbox.setAttribute('role', 'checkbox');
      checkbox.setAttribute('aria-checked', String(this.selected.has(item.id)));
      asActivatable(checkbox, {
        label: t('chat.ui.contextManager.selectNamed', { name: item.name }),
        onActivate: () => this.toggleSelection(item.id),
        inTabOrder: false,
      });
      if (this.selected.has(item.id)) setIcon(checkbox, 'check');
    } else {
      const alert = row.createSpan({ cls: 'grimoire-context-row-icon is-failed' });
      setIcon(alert, 'alert-circle');
      markDecorative(alert);
    }

    if (!failed) {
      const icon = row.createSpan({ cls: 'grimoire-context-row-icon' });
      setIcon(icon, KIND_ICONS[item.kind]);
      markDecorative(icon);
    }

    row.createSpan({ cls: 'grimoire-context-row-name', text: item.name });
    row.createSpan({ cls: 'grimoire-context-row-detail', text: item.detail });
    row.createDiv({ cls: 'grimoire-context-row-spacer' });

    if (failed) {
      row.createSpan({
        cls: 'grimoire-context-row-error',
        text: item.error ?? t('chat.ui.contextManager.unreadable'),
      });
    } else if (item.inFlight) {
      // Removable for the *next* message only: the turn already dispatched
      // carries what it carried.
      row.createSpan({
        cls: 'grimoire-context-row-tokens',
        text: t('chat.ui.contextManager.inFlight'),
      });
    } else {
      row.createSpan({
        cls: 'grimoire-context-row-tokens',
        text: formatTokens(item.tokens),
      });
    }

    const remove = row.createEl('button', {
      cls: 'grimoire-icon-btn grimoire-icon-btn--small grimoire-icon-btn--danger',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.contextManager.removeNamed', { name: item.name }),
      },
    });
    setIcon(remove, 'x');
    if (item.inFlight) remove.setAttribute('disabled', 'true');
    remove.addEventListener('click', () => this.store.remove(item.id));

    row.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('button')) return;
      this.focusedId = item.id;
      if (!failed) this.toggleSelection(item.id);
    });
  }

  private renderFooter(
    items: readonly ContextItem[],
    budget: { windowTokens: number; usedTokens: number },
    uncounted: number,
  ): void {
    const footer = this.footerEl;
    if (!footer) return;
    footer.empty();

    const percent = projectedPercent(items, budget);
    const over = isOverBudget(items, budget);
    const bar = footer.createDiv({ cls: 'grimoire-context-budget' });
    if (over) bar.addClass('is-over');
    bar.setCssProps({
      '--grimoire-context-budget-pct': `${Math.min(100, Math.max(0, percent ?? 0))}%`,
    });

    const label = over
      ? t('chat.ui.contextManager.exceedsBy', {
        tokens: formatTokens(overBudgetTokens(items, budget)),
      })
      : percent === null
        ? t('chat.ui.contextManager.windowUnknown')
        : t('chat.ui.contextManager.windowShare', { percent });
    footer.createSpan({
      cls: 'grimoire-context-budget-label',
      text: uncounted > 0
        ? `${label} · ${t('chat.ui.contextManager.notCounted', { count: uncounted })}`
        : label,
    });
    footer.createDiv({ cls: 'grimoire-context-footer-spacer' });

    if (items.length > 0) {
      const removeAll = footer.createEl('button', {
        cls: 'grimoire-context-remove-all',
        text: this.confirmingRemoveAll
          ? t('chat.ui.contextManager.removeAllConfirm', { count: items.length })
          : t('chat.ui.contextManager.removeAll'),
        attr: { type: 'button' },
      });
      removeAll.addEventListener('click', () => {
        if (!this.confirmingRemoveAll) {
          // One click asks, the next one does it: a dialog on top of a dialog
          // to confirm a removal the reader can simply re-add is worse.
          this.confirmingRemoveAll = true;
          this.render();
          return;
        }
        this.confirmingRemoveAll = false;
        this.selected.clear();
        this.store.clear();
      });
    }

    const done = footer.createEl('button', {
      cls: 'grimoire-primary-action',
      text: t('common.done'),
      attr: { type: 'button' },
    });
    done.addEventListener('click', () => this.close());
  }

  private toggleSelection(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.render();
  }

  private removeSelected(): void {
    if (this.selected.size === 0) return;
    this.store.removeMany(this.selected);
    this.selected.clear();
    this.render();
  }

  private handleKeydown(event: KeyboardEvent): void {
    const inSearchField = (event.target as HTMLElement)?.tagName === 'INPUT';

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      this.close();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !inSearchField) {
      event.preventDefault();
      for (const item of this.store.getItems()) {
        if (item.state !== 'failed') this.selected.add(item.id);
      }
      this.render();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !inSearchField) {
      event.preventDefault();
      if (this.selected.size > 0) {
        this.removeSelected();
      } else if (this.focusedId) {
        this.store.remove(this.focusedId);
        this.focusedId = null;
      }
      return;
    }
    if (event.key === ' ' && !inSearchField && this.focusedId) {
      event.preventDefault();
      this.toggleSelection(this.focusedId);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (this.rowOrder.length === 0) return;
      event.preventDefault();
      const current = this.focusedId ? this.rowOrder.indexOf(this.focusedId) : -1;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(
        this.rowOrder.length - 1,
        Math.max(0, current === -1 ? (step > 0 ? 0 : this.rowOrder.length - 1) : current + step),
      );
      this.focusedId = this.rowOrder[next];
      this.highlightFocusedRow();
    }
  }

  private highlightFocusedRow(): void {
    const rows = this.listEl?.querySelectorAll<HTMLElement>('.grimoire-context-row') ?? [];
    for (const row of Array.from(rows)) {
      row.toggleClass('is-focused', row.dataset.contextId === this.focusedId);
    }
  }
}
