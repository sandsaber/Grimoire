import { createMockEl } from '@test/helpers/mockElement';

import type { ContextItem } from '@/features/chat/ui/context-manager/contextItems';
import { ContextManagerModal } from '@/features/chat/ui/context-manager/ContextManagerModal';
import { ContextStore } from '@/features/chat/ui/context-manager/ContextStore';

jest.mock('obsidian', () => ({
  Modal: class {
    contentEl: any = createMockEl();
    modalEl: any = createMockEl();
    containerEl: any = createMockEl();
    scope = { register: jest.fn(), unregister: jest.fn() };
    constructor(public app: any) {}
    open(): void {}
    close(): void {}
  },
  setIcon: jest.fn(),
}));

function item(overrides: Partial<ContextItem> & Pick<ContextItem, 'id'>): ContextItem {
  return {
    addedBy: 'picker',
    detail: 'Fieldnotes/',
    kind: 'vault-file',
    name: `${overrides.id}.md`,
    path: `Fieldnotes/${overrides.id}.md`,
    state: 'loaded',
    tokens: 1200,
    ...overrides,
  };
}

function openModal(items: ContextItem[]): { modal: ContextManagerModal; content: any } {
  const store = new ContextStore();
  store.replace(items);
  store.setBudget({ usedTokens: 0, windowTokens: 200000 });
  const modal = new ContextManagerModal({} as never, store, {
    attach: jest.fn(),
    openPicker: jest.fn(),
    search: jest.fn().mockReturnValue([]),
  });
  modal.onOpen();
  return { content: (modal as unknown as { contentEl: any }).contentEl, modal };
}

function rows(content: any): any[] {
  return content
    .querySelector('.grimoire-context-list')
    .children.filter((child: any) => child.hasClass('grimoire-context-item'));
}

function classesInOrder(row: any): string[] {
  return row.children.map((child: any) => {
    for (const name of [
      'grimoire-context-checkbox',
      'grimoire-context-item-icon',
      'grimoire-context-item-name',
      'grimoire-context-item-detail',
      'grimoire-context-item-error',
      'grimoire-context-item-spacer',
      'grimoire-context-item-tokens',
    ]) {
      if (child.hasClass(name)) return name;
    }
    return 'other';
  });
}

describe('ContextManagerModal rows', () => {
  it('prices a loaded file in the right-hand column', () => {
    const { content, modal } = openModal([item({ id: 'a' })]);

    expect(classesInOrder(rows(content)[0])).toEqual([
      'grimoire-context-checkbox',
      'grimoire-context-item-icon',
      'grimoire-context-item-name',
      'grimoire-context-item-detail',
      'grimoire-context-item-spacer',
      'grimoire-context-item-tokens',
      'other',
    ]);
    modal.onClose();
  });

  it('names a failure beside the file it is about, and charges nothing for it', () => {
    // The reason used to sit in the token column at the far right, so a row
    // read "plan-2026.pdf" with an unexplained gap and its cause pushed to the
    // edge of a 640px dialog. It replaces the path, not the price - a file
    // that cannot be read contributes no tokens to count.
    const { content, modal } = openModal([
      item({ error: 'unreadable - needs a text layer', id: 'b', state: 'failed' }),
    ]);
    const row = rows(content)[0];

    expect(classesInOrder(row)).toEqual([
      'grimoire-context-item-icon',
      'grimoire-context-item-name',
      'grimoire-context-item-error',
      'grimoire-context-item-spacer',
      'other',
    ]);
    expect(row.querySelector('.grimoire-context-item-tokens')).toBeNull();
    expect(row.querySelector('.grimoire-context-checkbox')).toBeNull();
    modal.onClose();
  });
});

describe('ContextManagerModal chrome', () => {
  it('draws no close of its own, because the host already draws one', () => {
    // Two crosses were stacked in the same corner, and hiding the host's meant
    // guessing where and when it builds the thing. Drawing none is the fix
    // that needs neither answer.
    const store = new ContextStore();
    const modal = new ContextManagerModal({} as never, store, {
      attach: jest.fn(),
      openPicker: jest.fn(),
      search: jest.fn().mockReturnValue([]),
    });

    modal.onOpen();

    const header = (modal as unknown as { contentEl: any }).contentEl
      .querySelector('.grimoire-context-header');
    expect(header.querySelectorAll('button')).toHaveLength(0);
    // Escape is what closes it instead, so it must still be registered.
    expect((modal as unknown as { scope: any }).scope.register)
      .toHaveBeenCalledWith([], 'Escape', expect.any(Function));
  });
});
