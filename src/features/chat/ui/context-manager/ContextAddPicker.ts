import { setIcon } from 'obsidian';

import { t } from '../../../../i18n/i18n';
import { markDecorative } from '../../../../shared/components/activatable';
import { formatTokens } from './contextItems';
import type { ContextCandidate } from './ContextManagerModal';
import type { ContextStore } from './ContextStore';

export interface ContextAddPickerCallbacks {
  search: (query: string) => ContextCandidate[];
  attach: (candidate: ContextCandidate) => void;
  /** The three quick sources in the footer, in the order they are shown. */
  quickSources: () => Array<{ id: string; label: string; run: () => void }>;
  /** The id an attached candidate would have, so a row can say "attached". */
  identify: (candidate: ContextCandidate) => string;
}

/**
 * Which side of its anchor the panel opens on.
 *
 * Above the composer, below the manage dialog's search band - a dialog is its
 * own stacking context, so a panel drawn in the composer while the dialog is
 * open is drawn behind it, and the control that opened it looks broken.
 */
export type ContextPickerPlacement = 'above' | 'below';

/**
 * A fast search over the vault that can stay open across repeated adds.
 *
 * Enter adds and closes; Tab adds and keeps the picker open, which is the
 * whole reason this is not a `SuggestModal`: attaching six notes should not
 * mean opening the same dialog six times.
 */
export class ContextAddPicker {
  private readonly rootEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly resultsEl: HTMLElement;
  private candidates: ContextCandidate[] = [];
  private highlighted = 0;
  private readonly outsideClick = (event: MouseEvent): void => {
    if (this.rootEl.contains(event.target as Node)) return;
    this.close();
  };

  constructor(
    parentEl: HTMLElement,
    private readonly store: ContextStore,
    private readonly callbacks: ContextAddPickerCallbacks,
    private readonly returnFocusTo: HTMLElement | null,
    placement: ContextPickerPlacement = 'above',
  ) {
    this.rootEl = parentEl.createDiv({
      cls: placement === 'below'
        ? 'grimoire-context-picker grimoire-context-picker--below'
        : 'grimoire-context-picker',
    });
    this.rootEl.setAttribute('role', 'dialog');
    this.rootEl.setAttribute('aria-label', t('chat.ui.contextManager.addContext'));

    const search = this.rootEl.createDiv({ cls: 'grimoire-context-picker-search' });
    const icon = search.createSpan({ cls: 'grimoire-context-picker-icon' });
    setIcon(icon, 'search');
    markDecorative(icon);
    this.inputEl = search.createEl('input', {
      cls: 'grimoire-context-picker-input',
      attr: {
        type: 'text',
        placeholder: t('chat.ui.contextManager.pickerPlaceholder'),
        'aria-label': t('chat.ui.contextManager.pickerPlaceholder'),
      },
    });
    search.createSpan({
      cls: 'grimoire-context-picker-hint',
      text: t('chat.ui.contextManager.pickerHint'),
    });

    this.resultsEl = this.rootEl.createDiv({ cls: 'grimoire-context-picker-results' });
    this.resultsEl.setAttribute('role', 'listbox');
    this.renderFooter();

    this.inputEl.addEventListener('input', () => this.refresh());
    this.inputEl.addEventListener('keydown', event => this.handleKeydown(event));
    this.rootEl.ownerDocument.addEventListener('click', this.outsideClick, true);

    this.refresh();
    this.inputEl.focus();
  }

  close(): void {
    this.rootEl.ownerDocument.removeEventListener('click', this.outsideClick, true);
    this.rootEl.remove();
    this.returnFocusTo?.focus?.();
  }

  private refresh(): void {
    this.candidates = this.callbacks.search(this.inputEl.value.trim()).slice(0, 40);
    this.highlighted = 0;
    this.renderResults();
  }

  private renderResults(): void {
    this.resultsEl.empty();
    if (this.candidates.length === 0) {
      this.resultsEl.createDiv({
        cls: 'grimoire-context-picker-empty',
        text: t('chat.ui.contextManager.noMatches'),
      });
      return;
    }

    const query = this.inputEl.value.trim().toLowerCase();
    this.candidates.forEach((candidate, index) => {
      const attached = this.store.has(this.callbacks.identify(candidate));
      const row = this.resultsEl.createDiv({
        cls: [
          'grimoire-context-picker-row',
          index === this.highlighted ? 'is-highlighted' : '',
          attached ? 'is-attached' : '',
        ].filter(Boolean).join(' '),
      });
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === this.highlighted));
      const icon = row.createSpan({ cls: 'grimoire-context-picker-row-icon' });
      setIcon(icon, candidate.folder ? 'folder' : 'file-text');
      markDecorative(icon);

      const nameEl = row.createSpan({ cls: 'grimoire-context-picker-row-name' });
      this.renderMatch(nameEl, candidate.name, query);
      row.createDiv({ cls: 'grimoire-context-picker-row-spacer' });
      row.createSpan({
        cls: 'grimoire-context-picker-row-meta',
        // A row for something already in context is inert and says so, rather
        // than looking addable and doing nothing. A folder prices what is
        // inside it and says how much of it there is - "4 notes · 5.2k" -
        // because its name alone does not say what attaching it costs.
        text: attached
          ? t('chat.ui.contextManager.attached')
          : candidate.folder && candidate.detail
            ? `${candidate.detail} · ${formatTokens(candidate.tokens)}`
            : formatTokens(candidate.tokens),
      });

      if (attached) return;
      row.addEventListener('click', () => {
        this.callbacks.attach(candidate);
        this.close();
      });
    });
  }

  /** Underlines the matched substring in the accent, and nothing else. */
  private renderMatch(target: HTMLElement, name: string, query: string): void {
    if (!query) {
      target.setText(name);
      return;
    }
    const at = name.toLowerCase().indexOf(query);
    if (at === -1) {
      target.setText(name);
      return;
    }
    target.appendText(name.slice(0, at));
    target.createSpan({
      cls: 'grimoire-context-picker-match',
      text: name.slice(at, at + query.length),
    });
    target.appendText(name.slice(at + query.length));
  }

  private renderFooter(): void {
    const footer = this.rootEl.createDiv({ cls: 'grimoire-context-picker-footer' });
    const sources = this.callbacks.quickSources();
    sources.forEach((source, index) => {
      if (index > 0) footer.createSpan({ cls: 'grimoire-context-picker-sep', text: '·' });
      const button = footer.createEl('button', {
        cls: 'grimoire-context-picker-quick',
        text: source.label,
        attr: { type: 'button' },
      });
      button.addEventListener('click', () => {
        source.run();
        this.close();
      });
    });
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Escape closes the panel, not whatever is behind it: unstopped, the
      // manage dialog's own Escape scope reads the same press and both go.
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (this.candidates.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.highlighted = Math.min(
        this.candidates.length - 1,
        Math.max(0, this.highlighted + step),
      );
      this.renderResults();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const candidate = this.candidates[this.highlighted];
      if (!candidate) return;
      event.preventDefault();
      this.callbacks.attach(candidate);
      if (event.key === 'Enter') {
        this.close();
        return;
      }
      // Tab keeps it open: attaching six notes should not mean opening the
      // same dialog six times.
      this.inputEl.value = '';
      this.refresh();
    }
  }
}
