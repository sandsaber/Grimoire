import { createMockEl } from '@test/helpers/mockElement';

import { ContextAddPicker } from '@/features/chat/ui/context-manager/ContextAddPicker';
import type { ContextCandidate } from '@/features/chat/ui/context-manager/ContextManagerModal';
import { ContextStore } from '@/features/chat/ui/context-manager/ContextStore';

jest.mock('obsidian', () => ({
  setIcon: jest.fn((el: any, icon: string) => el.setAttribute('data-icon', icon)),
}));

function mount(quickSources: Array<{ id: string; label: string; run: () => void }>) {
  const parent = createMockEl();
  const anchor = createMockEl();
  const callbacks = {
    search: jest.fn((): ContextCandidate[] => []),
    attach: jest.fn(),
    identify: (candidate: ContextCandidate) => `vault:${candidate.path}`,
    quickSources: () => quickSources,
  };
  const picker = new ContextAddPicker(
    parent,
    new ContextStore(),
    callbacks,
    anchor,
  );
  return { parent, picker, root: parent.querySelector('.grimoire-context-picker') };
}

describe('ContextAddPicker quick sources', () => {
  it('draws one control per source, separated', () => {
    const { root } = mount([
      { id: 'open-file', label: 'Open file', run: jest.fn() },
      { id: 'browse', label: 'Browse…', run: jest.fn() },
    ]);

    const quick = root!.querySelectorAll('.grimoire-context-picker-quick');
    expect(quick.map((el: { textContent: string }) => el.textContent)).toEqual(['Open file', 'Browse…']);
    expect(root!.querySelectorAll('.grimoire-context-picker-sep')).toHaveLength(1);
  });

  it('runs a source and closes, because the dialog it opens owns the screen next', () => {
    const browse = jest.fn();
    const { parent, root } = mount([{ id: 'browse', label: 'Browse…', run: browse }]);

    root!.querySelectorAll('.grimoire-context-picker-quick')[0].dispatchEvent('click');

    expect(browse).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('.grimoire-context-picker')).toBeNull();
  });

  it('draws no footer when there is no quick source to offer', () => {
    const { root } = mount([]);

    expect(root!.querySelectorAll('.grimoire-context-picker-quick')).toHaveLength(0);
  });
});
