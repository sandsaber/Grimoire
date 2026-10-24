import { getBuiltInCommandsForDropdown } from '../../core/commands/builtInCommands';
import type { ProviderCommandDropdownConfig } from '../../core/providers/commands/ProviderCommandCatalog';
import type {
  ProviderCommandEntry,
  ProviderCommandScope,
} from '../../core/providers/commands/ProviderCommandEntry';
import type { SlashCommand } from '../../core/types';
import { t } from '../../i18n/i18n';
import { normalizeArgumentHint } from '../../utils/slashCommand';

interface DropdownItem {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
  displayPrefix: string;
  insertPrefix: string;
  isBuiltIn: boolean;
  slashCommand?: SlashCommand;
  providerEntry?: ProviderCommandEntry;
}

export interface SlashCommandDropdownCallbacks {
  onSelect: (command: SlashCommand) => void;
  onHide: () => void;
}

export interface SlashCommandDropdownOptions {
  fixed?: boolean;
  hiddenCommands?: Set<string>;
  providerConfig?: ProviderCommandDropdownConfig;
  getProviderEntries?: () => Promise<readonly ProviderCommandEntry[]>;
}

/** Where a listed command comes from, in the words the badge uses. */
function scopeOf(item: DropdownItem): ProviderCommandScope {
  if (item.isBuiltIn) return 'builtin';
  return item.providerEntry?.scope ?? 'vault';
}

export class SlashCommandDropdown {
  private containerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | HTMLInputElement;
  private callbacks: SlashCommandDropdownCallbacks;
  private enabled = true;
  private onInput: (event: Event) => void;
  private onCompositionStart: () => void;
  private onCompositionEnd: () => void;
  private isComposing = false;
  private triggerStartIndex = -1;
  private activeTriggerChar = '/';
  private selectedIndex = 0;
  private filteredItems: DropdownItem[] = [];
  private isFixed: boolean;
  private hiddenCommands: Set<string>;

  private providerConfig: ProviderCommandDropdownConfig | null;
  private getProviderEntries: (() => Promise<readonly ProviderCommandEntry[]>) | null;
  private cachedProviderEntries: ProviderCommandEntry[] = [];
  private providerEntriesFetched = false;
  private providerEntriesPromise: Promise<void> | null = null;
  private catalogGeneration = 0;

  private requestId = 0;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement | HTMLInputElement,
    callbacks: SlashCommandDropdownCallbacks,
    options: SlashCommandDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.isFixed = options.fixed ?? false;
    this.hiddenCommands = options.hiddenCommands ?? new Set();
    this.providerConfig = options.providerConfig ?? null;
    this.getProviderEntries = options.getProviderEntries ?? null;

    this.onInput = (event) => {
      if (!this.isComposing && !(event as InputEvent).isComposing) this.handleInputChange();
    };
    this.onCompositionStart = () => {
      this.isComposing = true;
      this.hide();
    };
    this.onCompositionEnd = () => {
      this.isComposing = false;
      this.handleInputChange();
    };
    this.inputEl.addEventListener('input', this.onInput);
    this.inputEl.addEventListener('compositionstart', this.onCompositionStart);
    this.inputEl.addEventListener('compositionend', this.onCompositionEnd);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
    }
  }

  setHiddenCommands(commands: Set<string>): void {
    this.hiddenCommands = commands;
  }

  setProviderCatalog(
    config: ProviderCommandDropdownConfig,
    getEntries: () => Promise<readonly ProviderCommandEntry[]>,
  ): void {
    this.providerConfig = config;
    this.getProviderEntries = getEntries;
    this.resetSdkSkillsCache();
  }

  handleInputChange(): void {
    if (!this.enabled || this.isComposing) return;

    const text = this.getInputValue();
    const cursorPos = this.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const triggerChars = this.providerConfig?.triggerChars ?? ['/'];

    // Scan backward from cursor for the nearest valid trigger char.
    // Valid trigger: at position 0, or preceded by whitespace.
    let triggerIndex = -1;
    let triggerChar = '';

    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = textBeforeCursor.charAt(i);
      if (/\s/.test(ch)) break;
      if (triggerChars.includes(ch)) {
        if (i === 0 || /\s/.test(textBeforeCursor.charAt(i - 1))) {
          triggerIndex = i;
          triggerChar = ch;
        }
        break;
      }
    }

    if (triggerIndex === -1) {
      this.hide();
      return;
    }

    const searchText = textBeforeCursor.substring(triggerIndex + 1);

    if (/\s/.test(searchText)) {
      this.hide();
      return;
    }

    this.triggerStartIndex = triggerIndex;
    this.activeTriggerChar = triggerChar;
    const isAtPosition0 = triggerIndex === 0;
    void this.showDropdown(searchText, isAtPosition0);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    // Legacy 229 is required for macOS IME candidate confirmation.
    if (this.isComposing || e.isComposing || (e as { readonly keyCode: number }).keyCode === 229 || !this.enabled || !this.isVisible()) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.navigate(1);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.navigate(-1);
        return true;
      case 'Enter':
      case 'Tab':
        if (this.filteredItems.length > 0) {
          e.preventDefault();
          this.selectItem();
          return true;
        }
        return false;
      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;
    }
    return false;
  }

  isVisible(): boolean {
    return this.dropdownEl?.hasClass('visible') ?? false;
  }

  hide(): void {
    this.requestId++;
    if (this.dropdownEl) {
      this.dropdownEl.removeClass('visible');
    }
    this.triggerStartIndex = -1;
    this.callbacks.onHide();
  }

  destroy(): void {
    this.hide();
    this.catalogGeneration++;
    this.inputEl.removeEventListener('input', this.onInput);
    this.inputEl.removeEventListener('compositionstart', this.onCompositionStart);
    this.inputEl.removeEventListener('compositionend', this.onCompositionEnd);
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  resetSdkSkillsCache(): void {
    this.cachedProviderEntries = [];
    this.providerEntriesFetched = false;
    this.providerEntriesPromise = null;
    this.catalogGeneration++;
    this.requestId++;
  }

  private getInputValue(): string {
    return this.inputEl.value;
  }

  private getCursorPosition(): number {
    return this.inputEl.selectionStart || 0;
  }

  private setInputValue(value: string): void {
    this.inputEl.value = value;
  }

  private setCursorPosition(pos: number): void {
    this.inputEl.selectionStart = pos;
    this.inputEl.selectionEnd = pos;
  }

  private async showDropdown(searchText: string, isAtPosition0 = true): Promise<void> {
    const currentRequest = ++this.requestId;
    const searchLower = searchText.toLowerCase();
    const includeBuiltIns = isAtPosition0 && this.activeTriggerChar === '/';
    const discoveryPending = !this.providerEntriesFetched && this.getProviderEntries !== null;

    // Local commands are usable while the provider discovers its skill catalog.
    if (discoveryPending) {
      this.filteredItems = this.buildFilteredItems(searchLower, includeBuiltIns);
      this.selectedIndex = 0;
      if (this.filteredItems.length > 0) {
        this.render();
      } else {
        // Hide stale rows without invalidating discovery or the active trigger.
        this.dropdownEl?.removeClass('visible');
      }
      await this.fetchProviderEntries();

      if (currentRequest !== this.requestId) return;
    }

    const selectedName = discoveryPending ? this.filteredItems[this.selectedIndex]?.name : undefined;
    this.filteredItems = this.buildFilteredItems(searchLower, includeBuiltIns);
    if (searchText.length > 0 && this.filteredItems.length === 0) {
      this.hide();
      return;
    }

    this.selectedIndex = Math.max(0, this.filteredItems.findIndex(item => item.name === selectedName));
    this.render();
  }

  private buildFilteredItems(searchLower: string, includeBuiltIns: boolean): DropdownItem[] {
    return this.buildItemList(includeBuiltIns)
      .filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async fetchProviderEntries(): Promise<void> {
    if (this.providerEntriesFetched || !this.getProviderEntries) return;
    if (this.providerEntriesPromise) return this.providerEntriesPromise;
    const generation = this.catalogGeneration;
    const getEntries = this.getProviderEntries;
    const pending = Promise.resolve().then(async () => {
      const entries = await getEntries();
      if (generation !== this.catalogGeneration) return;
      if (entries.length > 0) {
        this.cachedProviderEntries = [...entries];
        this.providerEntriesFetched = true;
      }
    }).catch(() => {
      // A failed discovery can be retried on the next menu request.
    });
    this.providerEntriesPromise = pending;
    try {
      await pending;
    } finally {
      if (this.providerEntriesPromise === pending) {
        this.providerEntriesPromise = null;
      }
    }
  }

  private buildItemList(includeBuiltIns: boolean): DropdownItem[] {
    const seenNames = new Set<string>();
    const items: DropdownItem[] = [];

    if (includeBuiltIns) {
      const builtIns = getBuiltInCommandsForDropdown(this.providerConfig?.providerId);
      for (const cmd of builtIns) {
        const nameLower = cmd.name.toLowerCase();
        if (!seenNames.has(nameLower)) {
          seenNames.add(nameLower);
          items.push({
            name: cmd.name,
            description: cmd.description,
            argumentHint: cmd.argumentHint,
            content: cmd.content,
            displayPrefix: '/',
            insertPrefix: '/',
            isBuiltIn: true,
            slashCommand: cmd,
          });
        }
      }
    }

    for (const entry of this.cachedProviderEntries) {
      const nameLower = entry.name.toLowerCase();
      if (seenNames.has(nameLower) || this.hiddenCommands.has(nameLower)) {
        continue;
      }
      seenNames.add(nameLower);
      items.push({
        name: entry.name,
        description: entry.description,
        argumentHint: entry.argumentHint,
        content: entry.content,
        displayPrefix: entry.displayPrefix,
        insertPrefix: entry.insertPrefix,
        isBuiltIn: false,
        providerEntry: entry,
        slashCommand: {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          content: entry.content,
          argumentHint: entry.argumentHint,
          allowedTools: entry.allowedTools,
          model: entry.model,
          source: entry.source,
          kind: entry.kind,
          disableModelInvocation: entry.disableModelInvocation,
          userInvocable: entry.userInvocable,
          context: entry.context,
          agent: entry.agent,
          hooks: entry.hooks,
        },
      });
    }

    return items;
  }

  private render(): void {
    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }

    // Assemble rows off-document so input does not repeatedly mutate the live list.
    const contentEl = this.inputEl.ownerDocument.win.createFragment();

    if (this.filteredItems.length === 0) {
      const emptyEl = contentEl.createDiv({ cls: 'grimoire-slash-empty' });
      emptyEl.setText(t('shared.slashCommands.noMatches'));
    } else {
      for (let i = 0; i < this.filteredItems.length; i++) {
        const item = this.filteredItems[i];
        const itemEl = contentEl.createDiv({ cls: 'grimoire-slash-item' });

        if (i === this.selectedIndex) {
          itemEl.addClass('selected');
        }

        const nameEl = itemEl.createSpan({ cls: 'grimoire-slash-name' });
        nameEl.setText(`${item.displayPrefix}${item.name}`);

        if (item.argumentHint) {
          const hintEl = itemEl.createSpan({ cls: 'grimoire-slash-hint' });
          hintEl.setText(normalizeArgumentHint(item.argumentHint));
        }

        // Where a command comes from decides whether the reader can change it,
        // and two commands can share a name across those places. The list said
        // nothing about it, so `/review` from the vault and `/review` from the
        // CLI were the same row twice.
        itemEl.createSpan({
          cls: 'grimoire-slash-scope',
          text: t(`shared.slashCommands.scope.${scopeOf(item)}`),
        });

        if (item.description) {
          const descEl = itemEl.createDiv({ cls: 'grimoire-slash-desc' });
          descEl.setText(item.description);
        }

        itemEl.addEventListener('click', () => {
          this.selectedIndex = i;
          this.selectItem();
        });

        itemEl.addEventListener('mouseenter', () => {
          this.selectedIndex = i;
          this.updateSelection();
        });
      }
    }

    this.dropdownEl.replaceChildren(...Array.from(contentEl.childNodes));
    this.dropdownEl.addClass('visible');

    if (this.isFixed) {
      this.positionFixed();
    }
  }

  private createDropdownElement(): HTMLElement {
    if (this.isFixed) {
      return this.containerEl.createDiv({
        cls: 'grimoire-slash-dropdown grimoire-slash-dropdown-fixed',
      });
    } else {
      return this.containerEl.createDiv({ cls: 'grimoire-slash-dropdown' });
    }
  }

  private positionFixed(): void {
    if (!this.dropdownEl || !this.isFixed) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    this.dropdownEl.setCssProps({
      '--grimoire-fixed-dropdown-bottom': `${window.innerHeight - inputRect.top + 4}px`,
      '--grimoire-fixed-dropdown-left': `${inputRect.left}px`,
      '--grimoire-fixed-dropdown-width': `${Math.max(inputRect.width, 280)}px`,
    });
  }

  private navigate(direction: number): void {
    const maxIndex = this.filteredItems.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + direction));
    this.updateSelection();
  }

  private updateSelection(): void {
    const items = this.dropdownEl?.querySelectorAll('.grimoire-slash-item');
    items?.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.addClass('selected');
        (item as HTMLElement).scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('selected');
      }
    });
  }

  private selectItem(): void {
    if (this.filteredItems.length === 0) return;

    const selected = this.filteredItems[this.selectedIndex];
    if (!selected) return;

    const text = this.getInputValue();
    const beforeTrigger = text.substring(0, this.triggerStartIndex);
    const afterCursor = text.substring(this.getCursorPosition());
    const replacement = `${selected.insertPrefix}${selected.name} `;

    this.setInputValue(beforeTrigger + replacement + afterCursor);
    this.setCursorPosition(beforeTrigger.length + replacement.length);

    this.hide();
    if (selected.slashCommand) {
      this.callbacks.onSelect(selected.slashCommand);
    }
    this.inputEl.focus();
  }
}
