import { createMockEl } from '@test/helpers/mockElement';

import { ContextComposerView } from '@/features/chat/ui/context-manager/ContextComposerView';
import type { ContextItem } from '@/features/chat/ui/context-manager/contextItems';
import { ContextStore } from '@/features/chat/ui/context-manager/ContextStore';

jest.mock('obsidian', () => ({
  setIcon: jest.fn((el: any, icon: string) => el.setAttribute('data-icon', icon)),
}));

function item(id: string, tokens: number | null = 1000): ContextItem {
  return {
    id,
    kind: 'vault-file',
    name: `${id}.md`,
    detail: '',
    path: `Fieldnotes/${id}.md`,
    tokens,
    state: 'loaded',
    addedBy: 'mention',
  };
}

function mount(items: ContextItem[], budget = { windowTokens: 0, usedTokens: 0 }) {
  const parent = createMockEl();
  const card = createMockEl();
  const store = new ContextStore();
  store.replace(items);
  store.setBudget(budget);
  const callbacks = {
    onOpenManager: jest.fn(),
    onOpenPicker: jest.fn(),
    cardEl: card as unknown as HTMLElement,
  };
  const view = new ContextComposerView(parent, store, callbacks);
  const root = parent.querySelector('.grimoire-context-attachments');
  return { parent, card, store, callbacks, view, root };
}

describe('ContextComposerView', () => {
  it('says nothing when nothing is attached', () => {
    const { root } = mount([]);

    expect(root?.hasClass('grimoire-hidden')).toBe(true);
  });

  it('draws a chip for each of up to four, plus the control that adds a fifth', () => {
    const { root } = mount([item('a'), item('b'), item('c'), item('d')]);

    const chips = root!.querySelectorAll('.grimoire-file-chip');
    expect(chips).toHaveLength(5);
    expect(chips[4].hasClass('grimoire-file-chip--add')).toBe(true);
    expect(root!.querySelector('.grimoire-context-summary-bar')).toBeNull();
  });

  it('collapses to a summary at the fifth, without losing the count or the cost', () => {
    // Past four the chip row wraps to three lines and takes the space the
    // message was going to be written in.
    const { root } = mount(
      [item('a'), item('b'), item('c'), item('d'), item('e')],
      { windowTokens: 100_000, usedTokens: 0 },
    );

    const summary = root!.querySelector('.grimoire-context-summary-bar');
    expect(summary).not.toBeNull();
    expect(summary!.querySelector('.grimoire-context-summary-count')?.textContent).toBe('5 files');
    expect(summary!.querySelector('.grimoire-context-summary-cost')?.textContent)
      .toBe('~5.0k · 5% of window');
  });

  it('keeps the three most recent visible and counts the rest', () => {
    const { root } = mount([item('a'), item('b'), item('c'), item('d'), item('e'), item('f')]);

    const recent = root!.querySelector('.grimoire-context-chips--recent');
    expect(recent!.querySelectorAll('.grimoire-file-chip')).toHaveLength(3);
    expect(recent!.querySelector('.grimoire-context-more')?.textContent).toBe('+3 more');
  });

  it('names the overage in the composer, and moves the card border', () => {
    // Visible without opening the dialog, and it says by how much.
    const { root, card } = mount(
      [item('a', 90_000), item('b', 30_000)],
      { windowTokens: 100_000, usedTokens: 0 },
    );

    expect(card.hasClass('is-over-budget')).toBe(true);
    const row = root!.querySelector('.grimoire-context-summary-bar');
    expect(row?.hasClass('is-over-budget')).toBe(true);
    expect(row!.querySelector('.grimoire-context-summary-cost')?.textContent).toBe('over by ~20k');
  });

  it('removes an attachment from the chip it is drawn as', () => {
    const { root, store } = mount([item('a'), item('b')]);

    const remove = root!.querySelectorAll('.grimoire-file-chip-remove')[0];
    remove.click();

    expect(store.getItems().map(entry => entry.id)).toEqual(['b']);
  });

  it('reaches the dialog from the summary and from the overflow count alike', () => {
    const { root, callbacks } = mount(
      [item('a'), item('b'), item('c'), item('d'), item('e'), item('f')],
    );

    root!.querySelector('.grimoire-context-summary-manage')!.click();
    root!.querySelector('.grimoire-context-more')!.click();

    expect(callbacks.onOpenManager).toHaveBeenCalledTimes(2);
  });
});
