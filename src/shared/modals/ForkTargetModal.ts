import { type App, Modal } from 'obsidian';

import { asActivatable } from '@/shared/components/activatable';

import { t } from '../../i18n/i18n';

export type ForkTarget = 'new-tab' | 'current-tab';

export function chooseForkTarget(app: App): Promise<ForkTarget | null> {
  return new Promise(resolve => {
    new ForkTargetModal(app, resolve).open();
  });
}

class ForkTargetModal extends Modal {
  private resolve: (target: ForkTarget | null) => void;
  private resolved = false;

  constructor(app: App, resolve: (target: ForkTarget | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    this.setTitle(t('chat.fork.chooseTarget'));
    this.modalEl.addClass('grimoire-fork-target-modal');

    const list = this.contentEl.createDiv({ cls: 'grimoire-fork-target-list' });

    this.createOption(list, 'current-tab', t('chat.fork.targetCurrentTab'));
    this.createOption(list, 'new-tab', t('chat.fork.targetNewTab'));
  }

  private createOption(container: HTMLElement, target: ForkTarget, label: string): void {
    const item = container.createDiv({ cls: 'grimoire-fork-target-option', text: label });
    // This modal offers a choice and had no way to make it without a mouse:
    // the only key it answered was Escape, which declines.
    asActivatable(item, {
      label,
      onActivate: () => {
        this.resolved = true;
        this.resolve(target);
        this.close();
      },
    });
  }

  onClose() {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
