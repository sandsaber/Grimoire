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
  it('offers Add from an empty composer, and nothing else', () => {
    // The row hid itself when nothing was attached, so on a fresh chat the
    // only way to attach a first file was to already know that `@` opens a
    // picker - the control that says so appeared only once you had.
    const { root } = mount([]);

    expect(root?.hasClass('grimoire-hidden')).toBe(false);
    const chips = root!.querySelectorAll('.grimoire-file-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].hasClass('grimoire-file-chip--add')).toBe(true);
    expect(root!.querySelector('.grimoire-context-summary-bar')).toBeNull();
  });

  it('offers the dialog while the chip still fits', () => {
    // Manage lives in the summary row, which the single-chip state does not
    // draw - so with one file attached the dialog had nothing to open it.
    const { root, callbacks } = mount([item('a')]);

    const manage = root!.querySelector('.grimoire-context-chips-manage');
    expect(manage).not.toBeNull();
    manage!.dispatchEvent('click');
    expect(callbacks.onOpenManager).toHaveBeenCalledTimes(1);
  });

  it('offers no dialog when nothing is attached to manage', () => {
    const { root } = mount([]);

    expect(root!.querySelector('.grimoire-context-chips-manage')).toBeNull();
  });

  it('draws the one chip that always fits, plus the control that adds a second', () => {
    const { root } = mount([item('a')]);

    const chips = root!.querySelectorAll('.grimoire-file-chip');
    expect(chips).toHaveLength(2);
    expect(chips[1].hasClass('grimoire-file-chip--add')).toBe(true);
    expect(root!.querySelector('.grimoire-context-summary-bar')).toBeNull();
  });

  it('collapses to a summary at the second, without losing the count or the cost', () => {
    // A second chip is already a row that wraps in a sidebar, and it takes the
    // space the message was going to be written in.
    const { root } = mount(
      [item('a'), item('b')],
      { windowTokens: 100_000, usedTokens: 0 },
    );

    const summary = root!.querySelector('.grimoire-context-summary-bar');
    expect(summary).not.toBeNull();
    expect(summary!.querySelector('.grimoire-context-summary-count')?.textContent).toBe('2 files');
    expect(summary!.querySelector('.grimoire-context-summary-cost')?.textContent)
      .toBe('~2.0k · 2% of window');
  });

  it('draws the summary and nothing under it', () => {
    // The summary used to carry a second row echoing the three most recent
    // names with no remove on them: something to read, nothing to do, and it
    // wrapped at every sidebar width.
    const { root } = mount([item('a'), item('b'), item('c'), item('d'), item('e'), item('f')]);

    expect(root!.querySelector('.grimoire-context-summary-bar')).not.toBeNull();
    expect(root!.querySelectorAll('.grimoire-context-chips')).toHaveLength(0);
    expect(root!.querySelectorAll('.grimoire-file-chip')).toHaveLength(0);
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
    const { root, store } = mount([item('a')]);

    root!.querySelectorAll('.grimoire-file-chip-remove')[0].click();

    expect(store.getItems()).toHaveLength(0);
  });

  it('reaches the dialog from the summary', () => {
    const { root, callbacks } = mount(
      [item('a'), item('b'), item('c'), item('d'), item('e'), item('f')],
    );

    root!.querySelector('.grimoire-context-summary-manage')!.click();

    expect(callbacks.onOpenManager).toHaveBeenCalledTimes(1);
  });
});
