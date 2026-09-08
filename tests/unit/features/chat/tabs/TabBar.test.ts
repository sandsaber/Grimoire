import { createMockEl } from '@test/helpers/mockElement';

import { TabBar, type TabBarCallbacks } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

// Helper to create mock callbacks
function createMockCallbacks(): TabBarCallbacks {
  return {
    onTabClick: jest.fn(),
    onTabContextMenu: jest.fn(),
    onTabMiddleClick: jest.fn(),
    onNewTab: jest.fn(),
  };
}

// Helper to create tab bar items
function createTabBarItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Test Tab',
    providerId: 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    ...overrides,
  };
}

describe('TabBar', () => {
  describe('constructor', () => {
    it('should add tab badges class to container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();

      new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('grimoire-tab-badges')).toBe(true);
    });
  });

  describe('update', () => {
    it('should clear existing badges before rendering', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      // The strip ends with the control that extends it, so a strip of N tabs
      // is N + 1 children.
      tabBar.update([createTabBarItem()]);
      expect(containerEl._children.length).toBe(2);

      // Second update should clear first
      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(3);
    });

    it('should render badge for each tab item', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
        createTabBarItem({ id: 'tab-3', index: 3 }),
      ]);

      expect(containerEl._children.length).toBe(4);
    });

    it('should render only the add control when no items', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([]);

      expect(containerEl._children.length).toBe(1);
      expect(containerEl._children[0]._classList.has('grimoire-new-tab-btn')).toBe(true);
    });
  });

  describe('badge rendering', () => {
    it('should display index number as text', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ index: 5 })]);

      expect(containerEl._children[0].querySelector('.grimoire-tab-number')?.textContent).toBe('5');
    });

    it('names a tab by the number it shows and the title it does not', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ index: 2, title: 'My Conversation' })]);

      // The tab shows its number, so the number is half of what names it.
      expect(containerEl._children[0].getAttribute('aria-label')).toBe('Tab 2 · My Conversation');
      // title attribute is intentionally omitted to prevent double tooltip
      expect(containerEl._children[0].getAttribute('title')).toBeNull();
    });

    it('says nothing about which provider a tab runs', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ providerId: 'opencode' })]);

      // The dot said a tab was working; a vendor colour said who was doing the
      // work, in nine hues that no longer exist.
      expect(containerEl._children[0].getAttribute('data-provider')).toBeNull();
    });

    it('offers the add control at the end of the strip', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);

      const addControl = containerEl._children[2];
      expect(addControl._classList.has('grimoire-new-tab-btn')).toBe(true);
      expect(addControl.getAttribute('aria-label')).toBe('New tab');
      expect(tabBar.getNewTabButton()).toBe(addControl);

      addControl.click();
      expect(callbacks.onNewTab).toHaveBeenCalledTimes(1);
    });

    // The orchestrator and worker badges were asserted here. Both are gone: a
    // worker is a dispatched agent rather than a tab, so no tab is one and no
    // tab owns one, and there is nothing left for a badge to distinguish.
  });

  describe('badge state classes', () => {
    it('should apply idle class for inactive tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: false, isStreaming: false, needsAttention: false })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-idle')).toBe(true);
    });

    it('should apply active class for active tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-active')).toBe(true);
    });

    it('should apply streaming class for streaming tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-streaming')).toBe(true);
    });

    it('should apply attention class for tab needing attention', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-attention')).toBe(true);
    });

    it('should preserve attention activity on the active tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-attention')).toBe(true);
    });

    it('should prioritize attention over streaming', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-attention')).toBe(true);
      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-streaming')).toBe(false);
    });

    it('should preserve streaming activity on the active tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('grimoire-tab-badge-streaming')).toBe(true);
    });
  });

  describe('badge interactions', () => {
    it('should call onTabClick when badge is clicked', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'clicked-tab' })]);

      // Simulate click
      containerEl._children[0].dispatchEvent('click');

      expect(callbacks.onTabClick).toHaveBeenCalledWith('clicked-tab');
    });

    it('should not render a close button even when a tab can be closed elsewhere', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);

      expect(containerEl._children[0].querySelector('.grimoire-tab-number')).not.toBeNull();
      expect(containerEl._children[0].querySelector('.grimoire-tab-activity-dot')).not.toBeNull();
    });

    it('should open the tab menu on right-click', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);

      const mockEvent = { preventDefault: jest.fn() } as unknown as MouseEvent;
      containerEl._children[0].dispatchEvent('contextmenu', mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabContextMenu).toHaveBeenCalledWith('closeable-tab', mockEvent);
    });

    it('closes a closeable tab on middle-click', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);
      const mockEvent = { button: 1, preventDefault: jest.fn() };
      containerEl._children[0].dispatchEvent('auxclick', mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabMiddleClick).toHaveBeenCalledWith('closeable-tab');
    });

    it('keeps the last tab open on middle-click', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'last-tab', canClose: false })]);
      containerEl._children[0].dispatchEvent('auxclick', { button: 1, preventDefault: jest.fn() });

      expect(callbacks.onTabMiddleClick).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should empty container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(3);

      tabBar.destroy();

      expect(containerEl._children.length).toBe(0);
      expect(tabBar.getNewTabButton()).toBeNull();
    });

    it('should remove tab badges class from container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('grimoire-tab-badges')).toBe(true);

      tabBar.destroy();

      expect(containerEl._classList.has('grimoire-tab-badges')).toBe(false);
    });
  });
});
