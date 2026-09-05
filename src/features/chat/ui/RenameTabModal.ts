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

    const form = this.contentEl.createEl('form', { cls: 'grimoire-rename-tab-form' });
    const inputId = 'grimoire-rename-tab-input';
    form.createEl('label', {
      cls: 'grimoire-rename-tab-label',
      text: t('chat.ui.tabs.name'),
      attr: { for: inputId },
    });
    const field = form.createDiv({ cls: 'grimoire-rename-tab-field' });
    const input = field.createEl('input', {
      cls: 'grimoire-rename-tab-input',
      attr: {
        type: 'text',
        id: inputId,
        maxlength: String(MAX_TAB_TITLE_LENGTH),
        autocomplete: 'off',
        spellcheck: 'false',
      },
    });
    input.value = this.currentTitle.slice(0, MAX_TAB_TITLE_LENGTH);

    const suggestButton = this.createSuggestButton(field);

    const resetButton = field.createEl('button', {
      cls: 'grimoire-rename-tab-reset',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.tabs.resetName'),
      },
    });
    setIcon(resetButton, 'rotate-ccw');
    setTooltip(resetButton, t('chat.ui.tabs.resetName'), { placement: 'top' });

    const footer = form.createDiv({ cls: 'grimoire-rename-tab-footer' });
    const counter = footer.createDiv({ cls: 'grimoire-rename-tab-counter' });
    const actions = footer.createDiv({ cls: 'grimoire-rename-tab-actions' });
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
            setTooltip(suggestButton, t('chat.ui.tabs.autoRename'), { placement: 'top' });
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
      cls: 'grimoire-rename-tab-suggest',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.tabs.autoRename'),
      },
    });
    button.disabled = !available;
    setIcon(button, 'sparkles');
    setTooltip(
      button,
      available ? t('chat.ui.tabs.autoRename') : t('chat.ui.tabs.autoRenameNeedsMessage'),
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
