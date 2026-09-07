import { createMockEl } from '@test/helpers/mockElement';

import { chooseForkTarget } from '@/shared/modals/ForkTargetModal';

let lastModalInstance: any;

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');

  class MockModal {
    app: any;
    modalEl: any = { addClass: jest.fn() };
    contentEl: any;
    scope: any = { register: jest.fn(), unregister: jest.fn() };

    constructor(app: any) {
      this.app = app;
      this.contentEl = createMockEl();
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastModalInstance = this;
    }

    setTitle = jest.fn();

    open() {
      this.onOpen();
    }

    close() {
      this.onClose();
    }

    onOpen() {
      // Overridden by subclass
    }

    onClose() {
      // Overridden by subclass
    }
  }

  return {
    ...actual,
    Modal: MockModal,
  };
});

function getOptionItems(): Array<{ key: string; text: string; click: () => void }> {
  const listEl = lastModalInstance.contentEl.children?.find(
    (c: any) => c.hasClass?.('grimoire-fork-target-list'),
  );
  if (!listEl) return [];
  return (listEl.children || [])
    .filter((c: any) => c.hasClass?.('grimoire-fork-target-option'))
    .map((c: any) => ({
      // The row is a digit and a label now, so its text lives in the second child.
      key: c.children?.[0]?.textContent ?? '',
      text: c.children?.[1]?.textContent ?? '',
      click: () => {
        const handler = c._eventListeners?.get('click')?.[0];
        handler?.();
      },
    }));
}

/** Presses the digit a row is numbered with, the way the dialog registers it. */
function pressKey(key: string): void {
  const call = lastModalInstance.scope.register.mock.calls.find((c: any[]) => c[1] === key);
  call?.[2]({ preventDefault: jest.fn() });
}

beforeEach(() => {
  lastModalInstance = null;
});

describe('ForkTargetModal', () => {
  const mockApp = {} as any;

  describe('chooseForkTarget', () => {
    it('should resolve "current-tab" when current tab option is clicked', async () => {
      const result = chooseForkTarget(mockApp);
      const items = getOptionItems();
      const item = items.find(i => i.text === 'Current tab');
      item!.click();
      expect(await result).toBe('current-tab');
    });

    it('should resolve "new-tab" when new tab option is clicked', async () => {
      const result = chooseForkTarget(mockApp);
      const items = getOptionItems();
      const item = items.find(i => i.text === 'New tab');
      item!.click();
      expect(await result).toBe('new-tab');
    });

    it('should resolve null when modal is closed without selection', async () => {
      const result = chooseForkTarget(mockApp);
      lastModalInstance.close();
      expect(await result).toBeNull();
    });

    it('offers the new tab first, and numbers both choices', () => {
      void chooseForkTarget(mockApp);
      const items = getOptionItems();
      expect(items).toHaveLength(2);
      // A fork that replaces the tab it came from is the destructive one, so it
      // is second: the safe choice is the one under the cursor when it opens.
      expect(items.map(i => i.text)).toEqual(['New tab', 'Current tab']);
      expect(items.map(i => i.key)).toEqual(['1', '2']);
    });

    it('answers the digit beside each choice', async () => {
      const result = chooseForkTarget(mockApp);
      pressKey('2');
      expect(await result).toBe('current-tab');
    });
  });
});
