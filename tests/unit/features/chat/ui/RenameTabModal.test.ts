import { createMockEl } from '@test/helpers/mockElement';
import { Notice } from 'obsidian';

import { RenameTabModal } from '@/features/chat/ui/RenameTabModal';

const mockNotice = Notice as unknown as jest.Mock;

function createController(options: {
  enabled?: boolean;
  canSuggest?: boolean;
  suggest?: () => Promise<any>;
} = {}) {
  return {
    isAutoTitleEnabled: jest.fn().mockReturnValue(options.enabled ?? true),
    canSuggestTitle: jest.fn().mockReturnValue(options.canSuggest ?? true),
    suggestTitle: jest.fn(options.suggest ?? (async () => ({ ok: true, title: 'Drying PETG' }))),
    cancelTitleSuggestion: jest.fn(),
  };
}

function openModal(controller: any, currentTitle = 'New Chat') {
  const resolveResult = jest.fn();
  const autoSource = controller ? { controller, conversationId: 'conv-1' } : null;
  const modal = new RenameTabModal({} as any, currentTitle, autoSource, resolveResult);
  const contentEl = createMockEl();

  (modal as any).contentEl = contentEl;
  (modal as any).modalEl = createMockEl();
  (modal as any).setTitle = jest.fn();
  // The obsidian mock declares onOpen/onClose as instance fields, which shadow the
  // subclass methods: reach for the prototype so the real modal code runs.
  const onClose = () => RenameTabModal.prototype.onClose.call(modal);
  (modal as any).close = jest.fn(onClose);

  RenameTabModal.prototype.onOpen.call(modal);

  return {
    modal,
    resolveResult,
    contentEl,
    input: contentEl.querySelector('.grimoire-rename-tab-input'),
    suggestBtn: contentEl.querySelector('.grimoire-rename-tab-suggest'),
    saveBtn: contentEl.querySelector('.grimoire-rename-tab-save'),
  };
}

describe('RenameTabModal auto-rename control', () => {
  beforeEach(() => {
    mockNotice.mockClear();
  });

  it('omits the control when auto title generation is off', () => {
    const { suggestBtn } = openModal(createController({ enabled: false }));

    expect(suggestBtn).toBeNull();
  });

  it('omits the control when the tab has no conversation', () => {
    const { suggestBtn } = openModal(null);

    expect(suggestBtn).toBeNull();
  });

  it('disables the control when there is nothing to name yet', () => {
    const { suggestBtn } = openModal(createController({ canSuggest: false }));

    expect(suggestBtn).not.toBeNull();
    expect(suggestBtn?.disabled).toBe(true);
  });

  it('puts the generated title into the field without saving', async () => {
    const controller = createController();
    const { suggestBtn, input, resolveResult } = openModal(controller);

    suggestBtn?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.suggestTitle).toHaveBeenCalledWith('conv-1');
    expect(input?.value).toBe('Drying PETG');
    expect(resolveResult).not.toHaveBeenCalled();
  });

  it('blocks the field and saving while generating, then restores them', async () => {
    let release: (value: any) => void = () => {};
    const controller = createController({
      suggest: () => new Promise((resolve) => { release = resolve; }),
    });
    const { suggestBtn, input, saveBtn } = openModal(controller);

    suggestBtn?.click();

    expect(input?.disabled).toBe(true);
    expect(saveBtn?.disabled).toBe(true);
    expect(suggestBtn?.disabled).toBe(true);
    expect(suggestBtn?.hasClass('is-loading')).toBe(true);

    release({ ok: true, title: 'Drying PETG' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(input?.disabled).toBe(false);
    expect(saveBtn?.disabled).toBe(false);
    expect(suggestBtn?.disabled).toBe(false);
    expect(suggestBtn?.hasClass('is-loading')).toBe(false);
  });

  it('keeps the current text and warns when generation fails', async () => {
    const controller = createController({
      suggest: async () => ({ ok: false, reason: 'failed' }),
    });
    const { suggestBtn, input } = openModal(controller, 'Keep me');

    suggestBtn?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(input?.value).toBe('Keep me');
    expect(mockNotice).toHaveBeenCalled();
  });

  it('cancels generation on close and ignores a late result', async () => {
    let release: (value: any) => void = () => {};
    const controller = createController({
      suggest: () => new Promise((resolve) => { release = resolve; }),
    });
    const { modal, suggestBtn, input, resolveResult } = openModal(controller, 'Keep me');

    suggestBtn?.click();
    (modal as any).close();

    expect(controller.cancelTitleSuggestion).toHaveBeenCalledWith('conv-1');
    expect(resolveResult).toHaveBeenCalledWith(null);

    release({ ok: true, title: 'Too late' });
    await Promise.resolve();
    await Promise.resolve();

    expect(input?.value).toBe('Keep me');
  });

  it('cancels nothing when it has no generation of its own running', async () => {
    const controller = createController();
    const { modal, suggestBtn } = openModal(controller);

    // Never generated at all.
    (modal as any).close();
    expect(controller.cancelTitleSuggestion).not.toHaveBeenCalled();

    // Generated, finished, then closed: the tab's service is shared, so cancelling here
    // would abort whatever generation is running by then, not this dialog's.
    const second = openModal(controller);
    second.suggestBtn?.click();
    await Promise.resolve();
    await Promise.resolve();
    (second.modal as any).close();

    expect(suggestBtn).not.toBeNull();
    expect(controller.cancelTitleSuggestion).not.toHaveBeenCalled();
  });
});
