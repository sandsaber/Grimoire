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

    const targets: ForkTarget[] = ['new-tab', 'current-tab'];
    const labels: Record<ForkTarget, string> = {
      'new-tab': t('chat.fork.targetNewTab'),
      'current-tab': t('chat.fork.targetCurrentTab'),
    };
    targets.forEach((target, index) => {
      this.createOption(list, target, labels[target], index + 1);
    });

    // A choice that fits on two rows should answer the digit beside it. The
    // dialog took Escape and nothing else, so declining was the only thing it
    // could be told without a mouse.
    this.scopeKeys(targets);
    window.setTimeout(() => {
      const first = this.contentEl.querySelector<HTMLElement>('.grimoire-fork-target-option');
      first?.focus();
    }, 0);
  }

  private scopeKeys(targets: ForkTarget[]): void {
    targets.forEach((target, index) => {
      this.scope.register([], String(index + 1), event => {
        event.preventDefault();
        this.choose(target);
      });
    });
  }

  private createOption(
    container: HTMLElement,
    target: ForkTarget,
    label: string,
    key: number,
  ): void {
    // The first choice is the default answer, and it is marked as one. It used
    // to rely on `:focus-visible` alone, which a browser withholds when the
    // dialog was opened by a click - so the modal opened with nothing marked.
    const item = container.createDiv({
      cls: `grimoire-fork-target-option${key === 1 ? ' is-selected' : ''}`,
    });
    item.createEl('kbd', { cls: 'grimoire-fork-target-key', text: String(key) });
    item.createSpan({ text: label });
    asActivatable(item, {
      label,
      onActivate: () => this.choose(target),
    });
  }

  private choose(target: ForkTarget): void {
    this.resolved = true;
    this.resolve(target);
    this.close();
  }

  onClose() {
    if (!this.resolved) {
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
