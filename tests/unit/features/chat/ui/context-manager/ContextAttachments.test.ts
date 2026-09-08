import { createMockEl } from '@test/helpers/mockElement';

import { ContextAttachments } from '@/features/chat/ui/context-manager/ContextAttachments';

jest.mock('obsidian', () => {
  const { createMockEl: mockEl } = jest.requireActual('@test/helpers/mockElement');
  const opened: any[] = [];
  class TFile {}
  class TFolder {}
  class Modal {
    contentEl: any = mockEl();
    modalEl: any = mockEl();
    containerEl: any = mockEl();
    scope = { register: jest.fn(), unregister: jest.fn() };
    constructor(public app: any) {
      opened.push(this);
    }
    open(): void {
      (this as any).onOpen?.();
    }
    close(): void {
      (this as any).onClose?.();
    }
  }
  return {
    setIcon: jest.fn((el: any, icon: string) => el.setAttribute('data-icon', icon)),
    TFile,
    TFolder,
    Modal,
    __openedModals: opened,
  };
});

const openedModals: any[] = jest.requireMock('obsidian').__openedModals;

function mount(vaultPaths: string[] = []) {
  const composerEl = createMockEl();
  const browseExternal = jest.fn();
  const attachOpenFile = jest.fn();
  const app = {
    vault: {
      getFiles: () => [],
      getAllLoadedFiles: () => [],
      getAbstractFileByPath: () => null,
    },
  };
  const attachments = new ContextAttachments(composerEl, {
    app: app as never,
    getOpenNotePath: () => null,
    getVaultPaths: () => vaultPaths,
    getExternalPaths: () => [],
    detachOpenNote: jest.fn(),
    detachVaultPath: jest.fn(),
    detachExternalPath: jest.fn(),
    attachVaultPath: jest.fn(),
    getBudget: () => ({ windowTokens: 0, usedTokens: 0 }),
    isStreaming: () => false,
    openPath: jest.fn(),
    attachOpenFile,
    browseExternal,
  });

  // The add chip is the only way into the picker from an empty composer, and
  // running a quick source closes it - so each one is reached from a fresh
  // opening rather than from a footer that is no longer on screen.
  const openPicker = () => {
    composerEl.querySelector('.grimoire-file-chip--add')!.dispatchEvent('click');
    return composerEl.querySelectorAll('.grimoire-context-picker-quick');
  };
  const openManager = () => {
    openedModals.length = 0;
    composerEl.querySelector('.grimoire-context-summary-manage')!.dispatchEvent('click');
    return openedModals[0];
  };
  return { attachments, composerEl, openPicker, openManager, browseExternal, attachOpenFile };
}

describe('ContextAttachments quick sources', () => {
  it('asks for an external file and an external folder separately', () => {
    // Windows and Linux cannot show one dialog that returns either, and
    // Electron resolves the combined request by showing the folder picker -
    // so one "browse" control is a control that cannot attach a file there.
    const { openPicker, browseExternal, attachOpenFile } = mount();

    const footer = openPicker();
    expect(footer).toHaveLength(3);
    footer[1].dispatchEvent('click');

    openPicker()[2].dispatchEvent('click');

    expect(browseExternal.mock.calls).toEqual([['file'], ['folder']]);
    expect(attachOpenFile).not.toHaveBeenCalled();
  });

  it('runs the open-note source without a dialog', () => {
    const { openPicker, attachOpenFile, browseExternal } = mount();

    openPicker()[0].dispatchEvent('click');

    expect(attachOpenFile).toHaveBeenCalledTimes(1);
    expect(browseExternal).not.toHaveBeenCalled();
  });
});

describe('ContextAttachments manage dialog', () => {
  it('mounts the add picker inside the dialog, not behind it', () => {
    // A modal is its own stacking context, so the panel drawn in the composer
    // landed behind it however high its z-index - and the control that opened
    // it read as a button that does nothing.
    const { composerEl, openManager } = mount(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
    const modal = openManager();

    modal.contentEl.querySelector('.grimoire-primary-action')!.dispatchEvent('click');

    const picker = modal.contentEl.querySelector('.grimoire-context-picker');
    expect(picker).not.toBeNull();
    expect(picker.hasClass('grimoire-context-picker--below')).toBe(true);
    expect(composerEl.querySelector('.grimoire-context-picker')).toBeNull();
  });

  it('releases the picker when the dialog that hosted it closes', () => {
    // The dialog empties itself on close, which removes the panel's element
    // but not the document listener it watches for outside clicks with.
    const { openManager } = mount(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
    const modal = openManager();
    const add = modal.contentEl.querySelector('.grimoire-primary-action')!;
    // Closing is observable through the panel returning focus to the control
    // that opened it, which is the last thing it does.
    const refocused = jest.fn();
    add.addEventListener('focus', refocused);
    add.dispatchEvent('click');
    expect(refocused).not.toHaveBeenCalled();

    modal.close();

    expect(refocused).toHaveBeenCalledTimes(1);
  });
});
