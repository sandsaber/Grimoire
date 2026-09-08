import { type App, Modal, Notice, setIcon, setTooltip } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { ConversationController } from '../controllers/ConversationController';
import { MAX_TAB_TITLE_LENGTH } from '../tabs/types';

export interface TabRenameAutoSource {
  controller: ConversationController;
  conversationId: string;
}

export function requestTabRename(
  app: App,
  currentTitle: string,
  autoSource?: TabRenameAutoSource | null,
): Promise<string | null> {
  return new Promise((resolve) => {
    new RenameTabModal(app, currentTitle, autoSource ?? null, resolve).open();
  });
}

/** Exported for tests: the Obsidian mock's `open()` does not invoke `onOpen()`. */
export class RenameTabModal extends Modal {
  private resolved = false;
  private closed = false;
  private generating = false;
  private generationToken = 0;

  constructor(
    app: App,
    private readonly currentTitle: string,
    private readonly autoSource: TabRenameAutoSource | null,
    private readonly resolveResult: (title: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('grimoire-rename-tab-modal');
    this.setTitle(t('chat.ui.tabs.renameTitle'));

    const form = this.contentEl.createEl('form', {
      cls: 'grimoire-rename-tab-form grimoire-dialog-body',
    });
    // The dialog's own title already names the field, so a second label above it
    // would say the same word twice; the input carries the name instead.
    const field = form.createDiv({ cls: 'grimoire-rename-tab-field grimoire-dialog-field' });
    const input = field.createEl('input', {
      cls: 'grimoire-rename-tab-input grimoire-dialog-input',
      attr: {
        type: 'text',
        id: 'grimoire-rename-tab-input',
        maxlength: String(MAX_TAB_TITLE_LENGTH),
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': t('chat.ui.tabs.name'),
      },
    });
    input.value = this.currentTitle.slice(0, MAX_TAB_TITLE_LENGTH);

    const resetButton = field.createEl('button', {
      cls: 'grimoire-rename-tab-reset grimoire-dialog-field-btn',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.tabs.resetName'),
      },
    });
    setIcon(resetButton, 'rotate-ccw');
    setTooltip(resetButton, t('chat.ui.tabs.resetName'), { placement: 'top' });

    const suggestButton = this.createSuggestButton(field);

    const footer = form.createDiv({ cls: 'grimoire-rename-tab-footer grimoire-dialog-footer' });
    const counter = footer.createDiv({ cls: 'grimoire-rename-tab-counter grimoire-dialog-note' });
    const actions = footer.createDiv({ cls: 'grimoire-rename-tab-actions grimoire-dialog-actions' });
    const cancelButton = actions.createEl('button', {
      cls: 'grimoire-rename-tab-cancel',
      text: t('common.cancel'),
      attr: { type: 'button' },
    });
    const saveButton = actions.createEl('button', {
      cls: 'grimoire-rename-tab-save mod-cta',
      text: t('common.save'),
      attr: { type: 'submit' },
    });

    const updateState = () => {
      const remaining = Math.max(0, MAX_TAB_TITLE_LENGTH - input.value.length);
      counter.setText(t('chat.ui.tabs.charactersLeft', { count: remaining }));
      saveButton.disabled = this.generating || input.value.trim().length === 0;
    };
    const restoreCurrentTitle = () => {
      input.value = this.currentTitle.slice(0, MAX_TAB_TITLE_LENGTH);
      updateState();
      input.focus();
      input.select();
    };

    input.addEventListener('input', updateState);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    resetButton.addEventListener('click', restoreCurrentTitle);
    cancelButton.addEventListener('click', () => this.close());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) this.submit(input.value);
    });

    if (suggestButton) {
      suggestButton.addEventListener('click', () => {
        const source = this.autoSource;
        if (!source || suggestButton.disabled || this.generating) return;

        this.generating = true;
        const token = ++this.generationToken;

        input.disabled = true;
        suggestButton.disabled = true;
        suggestButton.addClass('is-loading');
        setIcon(suggestButton, 'loader-2');
        setTooltip(suggestButton, t('chat.ui.tabs.autoRenaming'), { placement: 'top' });
        updateState();

        void source.controller.suggestTitle(source.conversationId)
          .then((suggestion) => {
            if (this.closed || token !== this.generationToken) return;
            if (suggestion.ok) {
              input.value = suggestion.title.slice(0, MAX_TAB_TITLE_LENGTH);
            } else {
              new Notice(t('chat.ui.tabs.autoRenameFailed'));
            }
          })
          .finally(() => {
            if (token !== this.generationToken) return;
            this.generating = false;
            if (this.closed) return;
            input.disabled = false;
            suggestButton.disabled = false;
            suggestButton.removeClass('is-loading');
            setIcon(suggestButton, 'sparkles');
            setTooltip(suggestButton, t('chat.ui.history.regenerateTitle'), { placement: 'top' });
            updateState();
            input.focus();
            input.select();
          });
      });
    }

    updateState();
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  /** Renders the auto-rename control, or nothing when the feature cannot apply here. */
  private createSuggestButton(field: HTMLElement): HTMLButtonElement | null {
    const source = this.autoSource;
    if (!source || !source.controller.isAutoTitleEnabled()) return null;

    const available = source.controller.canSuggestTitle(source.conversationId);
    const button = field.createEl('button', {
      cls: 'grimoire-rename-tab-suggest grimoire-dialog-field-btn grimoire-dialog-field-btn--accent',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.history.regenerateTitle'),
      },
    });
    button.disabled = !available;
    setIcon(button, 'sparkles');
    setTooltip(
      button,
      available ? t('chat.ui.history.regenerateTitle') : t('chat.ui.tabs.autoRenameNeedsMessage'),
      { placement: 'top' },
    );
    return button;
  }

  private submit(title: string): void {
    this.resolved = true;
    this.resolveResult(title.trim());
    this.close();
  }

  onClose(): void {
    this.closed = true;
    // Only our own generation, and only while it is still running: the tab's title service
    // is shared, so an unscoped cancel here would abort a generation this dialog never
    // started — the auto-title of the conversation the tab was on before, say.
    if (this.generating && this.autoSource) {
      this.autoSource.controller.cancelTitleSuggestion(this.autoSource.conversationId);
      this.generating = false;
    }
    if (!this.resolved) this.resolveResult(null);
    this.contentEl.empty();
  }
}
