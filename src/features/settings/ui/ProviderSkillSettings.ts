import { type App, Modal, Notice, setIcon, Setting } from 'obsidian';

import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { providerCatalog } from '../../../core/providers/ProviderCatalog';
import type { ProviderId } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { confirmDelete } from '../../../shared/modals/ConfirmModal';
import { validateCommandName } from '../../../utils/slashCommand';

interface ProviderSkillModalOptions {
  catalog: ProviderCommandCatalog;
  entries: ProviderCommandEntry[];
  existing: ProviderCommandEntry | null;
  providerId: ProviderId;
  onSaved(): Promise<void>;
}

export function hasProviderSkillNameConflict(
  entries: ProviderCommandEntry[],
  name: string,
  targetStoragePath: string | null | undefined,
  currentId?: string,
): boolean {
  if (!targetStoragePath) return false;
  return entries.some((entry) => (
    entry.name.toLowerCase() === name.toLowerCase()
    && entry.id !== currentId
    && entry.storagePath === targetStoragePath
  ));
}

export class ProviderSkillModal extends Modal {
  constructor(
    app: App,
    private readonly options: ProviderSkillModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { existing } = this.options;
    const skillLabel = t('settings.slashCommandEditor.skill');
    this.setTitle(existing
      ? t('settings.slashCommandEditor.titleEdit', { type: skillLabel })
      : t('settings.slashCommandEditor.titleAdd', { type: skillLabel }));
    this.modalEl.addClass('grimoire-sp-modal');

    let nameInput: HTMLInputElement;
    let descriptionInput: HTMLInputElement;

    new Setting(this.contentEl)
      .setName(t('settings.codexSkills.name'))
      .addText((text) => {
        nameInput = text.inputEl;
        text.setValue(existing?.name ?? '').setPlaceholder('Review-code');
      });

    new Setting(this.contentEl)
      .setName(t('settings.subagents.modal.description'))
      .addText((text) => {
        descriptionInput = text.inputEl;
        text.setValue(existing?.description ?? '');
      });

    new Setting(this.contentEl)
      .setName(t('settings.codexSkills.instructions'))
      .setDesc(t('settings.codexSkills.instructionsDesc'));

    const contentArea = this.contentEl.createEl('textarea', {
      cls: 'grimoire-sp-content-area',
      attr: {
        rows: '10',
        placeholder: t('settings.codexSkills.instructionsPlaceholder'),
      },
    });
    contentArea.value = existing?.content ?? '';

    const buttons = this.contentEl.createDiv({ cls: 'grimoire-sp-modal-buttons' });
    buttons.createEl('button', {
      text: t('common.cancel'),
      cls: 'grimoire-cancel-btn',
    }).addEventListener('click', () => this.close());

    const saveButton = buttons.createEl('button', {
      text: t('common.save'),
      cls: 'grimoire-save-btn',
    });
    saveButton.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const name = nameInput.value.trim();
        const validationError = validateCommandName(name);
        if (validationError) {
          new Notice(validationError);
          return;
        }
        const description = descriptionInput.value.trim();
        if (!description) {
          new Notice(t('settings.subagents.descriptionRequired'));
          return;
        }
        if (!contentArea.value.trim()) {
          new Notice(t('settings.codexSkills.instructionsRequired'));
          return;
        }
        const targetStoragePath = existing?.storagePath
          ?? this.options.catalog.defaultVaultStoragePath?.();
        const duplicate = hasProviderSkillNameConflict(
          this.options.entries,
          name,
          targetStoragePath,
          existing?.id,
        );
        if (duplicate) {
          new Notice(t('settings.slashCommandEditor.skillExists', { name }));
          return;
        }

        const prefix = providerCatalog()
          .declarations(this.options.providerId).commandDropdown?.skillPrefix ?? '/';
        try {
          await this.options.catalog.saveVaultEntry({
            id: existing?.id ?? `${this.options.providerId}-skill-${name}`,
            providerId: this.options.providerId,
            kind: 'skill',
            name,
            description,
            content: contentArea.value,
            scope: 'vault',
            source: 'user',
            isEditable: true,
            isDeletable: true,
            displayPrefix: prefix,
            insertPrefix: prefix,
            persistenceKey: existing?.persistenceKey,
          });
          await this.options.onSaved();
          this.close();
        } catch {
          new Notice(t('settings.slashCommandEditor.saveSkillFailed'));
        }
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ProviderSkillSettings {
  private entries: ProviderCommandEntry[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly app: App,
    private readonly providerId: ProviderId,
    private readonly catalog: ProviderCommandCatalog,
    private readonly onChanged?: () => Promise<void>,
  ) {
    void this.loadAndRender();
  }

  async loadAndRender(): Promise<void> {
    try {
      this.entries = (await this.catalog.listVaultEntries())
        .filter((entry) => entry.kind === 'skill');
    } catch {
      this.entries = [];
    }
    this.render();
  }

  private render(): void {
    this.container.empty();
    const header = this.container.createDiv({ cls: 'grimoire-sp-header' });
    header.createSpan({ text: t('settings.hub.skills'), cls: 'grimoire-sp-label' });
    const actions = header.createDiv({ cls: 'grimoire-sp-header-actions' });

    const refreshButton = actions.createEl('button', {
      cls: 'grimoire-settings-action-btn',
      attr: { 'aria-label': t('common.refresh') },
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', () => {
      void (async (): Promise<void> => {
        await this.catalog.refresh();
        await this.loadAndRender();
      })();
    });

    const addButton = actions.createEl('button', {
      cls: 'grimoire-settings-action-btn',
      attr: { 'aria-label': t('common.add') },
    });
    setIcon(addButton, 'plus');
    addButton.addEventListener('click', () => this.openModal(null));

    if (this.entries.length === 0) {
      this.container.createDiv({
        cls: 'grimoire-sp-empty-state',
        text: t('settings.hub.none'),
      });
      return;
    }

    const list = this.container.createDiv({ cls: 'grimoire-sp-list' });
    for (const entry of this.entries) {
      const item = list.createDiv({ cls: 'grimoire-sp-item' });
      const info = item.createDiv({ cls: 'grimoire-sp-info' });
      const title = info.createDiv({ cls: 'grimoire-sp-item-header' });
      title.createSpan({
        cls: 'grimoire-sp-item-name',
        text: `${entry.displayPrefix}${entry.name}`,
      });
      title.createSpan({
        cls: 'grimoire-slash-item-badge',
        text: t('settings.slashCommandEditor.skillBadge'),
      });
      if (entry.description) {
        info.createDiv({ cls: 'grimoire-sp-item-desc', text: entry.description });
      }

      const itemActions = item.createDiv({ cls: 'grimoire-sp-item-actions' });
      if (entry.isEditable) {
        const editButton = itemActions.createEl('button', {
          cls: 'grimoire-settings-action-btn',
          attr: { 'aria-label': t('common.edit') },
        });
        setIcon(editButton, 'pencil');
        editButton.addEventListener('click', () => this.openModal(entry));
      }
      if (entry.isDeletable) {
        const deleteButton = itemActions.createEl('button', {
          cls: 'grimoire-settings-action-btn grimoire-settings-delete-btn',
          attr: { 'aria-label': t('common.delete') },
        });
        setIcon(deleteButton, 'trash-2');
        deleteButton.addEventListener('click', () => {
          void (async (): Promise<void> => {
            if (!(await confirmDelete(
              this.app,
              t('settings.hub.deleteConfirm', { name: entry.name }),
            ))) {
              return;
            }
            try {
              await this.catalog.deleteVaultEntry(entry);
              await this.onChanged?.();
              await this.loadAndRender();
            } catch {
              new Notice(t('settings.slashCommandEditor.deleteSkillFailed'));
            }
          })();
        });
      }
    }
  }

  private openModal(existing: ProviderCommandEntry | null): void {
    new ProviderSkillModal(this.app, {
      catalog: this.catalog,
      entries: this.entries,
      existing,
      providerId: this.providerId,
      onSaved: async () => {
        await this.onChanged?.();
        await this.loadAndRender();
      },
    }).open();
  }
}
