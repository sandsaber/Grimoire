import { NavigationSidebar } from '@/features/chat/ui/NavigationSidebar';
import { setLocale } from '@/i18n/i18n';

// Mock obsidian
jest.mock('obsidian', () => ({
  setIcon: jest.fn((el: any, iconName: string) => {
    el.setAttribute('data-icon', iconName);
  }),
}));

type Listener = (event: any) => void;

class MockClassList {
  private classes = new Set<string>();

  add(...items: string[]): void {
    items.forEach((item) => this.classes.add(item));
  }

  remove(...items: string[]): void {
    items.forEach((item) => this.classes.delete(item));
  }

  contains(item: string): boolean {
    return this.classes.has(item);
  }

  toggle(item: string, force?: boolean): void {
    if (force === undefined) {
      if (this.classes.has(item)) {
        this.classes.delete(item);
      } else {
        this.classes.add(item);
      }
      return;
    }
    if (force) {
      this.classes.add(item);
    } else {
      this.classes.delete(item);
    }
  }

  clear(): void {
    this.classes.clear();
  }

  toArray(): string[] {
    return Array.from(this.classes);
  }
}

class MockElement {
  tagName: string;
  classList = new MockClassList();
  style: Record<string, string> = {};
  ownerDocument: { defaultView: Window | null };
  children: MockElement[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  parent: MockElement | null = null;
  textContent = '';
  private _scrollTop = 0;
  private _scrollHeight = 500;
  private _clientHeight = 500;
  private listeners: Record<string, Listener[]> = {};
  public scrollToCalls: Array<{ top: number; behavior: string }> = [];

  offsetTop = 0;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = {
      defaultView: (globalThis as { window?: Window }).window ?? null,
    };
  }

  set className(value: string) {
    this.classList.clear();
    value.split(/\s+/).filter(Boolean).forEach((cls) => this.classList.add(cls));
  }

  get className(): string {
    return this.classList.toArray().join(' ');
  }

  addClass(...classes: string[]): void {
    this.classList.add(...classes);
  }

  hasClass(className: string): boolean {
    return this.classList.contains(className);
  }

  get scrollHeight(): number {
    return this._scrollHeight;
  }

  set scrollHeight(value: number) {
    this._scrollHeight = value;
  }

  get clientHeight(): number {
    return this._clientHeight;
  }

  set clientHeight(value: number) {
    this._clientHeight = value;
  }

  get scrollTop(): number {
    return this._scrollTop;
  }

  set scrollTop(value: number) {
    this._scrollTop = value;
  }

  scrollTo(options: { top: number; behavior: string }): void {
    this.scrollToCalls.push(options);
    this._scrollTop = options.top;
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  addEventListener(type: string, listener: Listener, _options?: any): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: any): void {
    const listeners = this.listeners[event.type] || [];
    for (const listener of listeners) {
      listener(event);
    }
  }

  click(): void {
    this.dispatchEvent({ type: 'click', stopPropagation: jest.fn(), preventDefault: jest.fn() });
  }

  empty(): void {
    this.children = [];
    this.textContent = '';
  }

  createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): MockElement {
    const el = new MockElement('div');
    if (options?.cls) el.className = options.cls;
    if (options?.text) el.textContent = options.text;
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, value);
      }
    }
    this.appendChild(el);
    return el;
  }

  createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): MockElement {
    const el = new MockElement('span');
    if (options?.cls) el.className = options.cls;
    if (options?.text) el.textContent = options.text;
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, value);
      }
    }
    this.appendChild(el);
    return el;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const matches: MockElement[] = [];
    const traverse = (el: MockElement): void => {
      // Handle class selectors
      if (selector.startsWith('.')) {
        const className = selector.slice(1);
        if (el.classList.contains(className)) {
          matches.push(el);
        }
      }
      for (const child of el.children) {
        traverse(child);
      }
    };
    traverse(this);
    return matches;
  }
}

describe('NavigationSidebar', () => {
  let parentEl: MockElement;
  let messagesEl: MockElement;
  let sidebar: NavigationSidebar;
  let originalWindow: Window | undefined;

  beforeEach(() => {
    setLocale('en');
    jest.useFakeTimers();
    originalWindow = (globalThis as { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', {
      value: {
        requestAnimationFrame: (callback: FrameRequestCallback): number =>
          globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number,
        cancelAnimationFrame: (handle: number): void => {
          globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
        },
        setTimeout: (callback: () => void, timeout: number): number =>
          globalThis.setTimeout(callback, timeout) as unknown as number,
        clearTimeout: (handle: number): void => {
          globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
        },
      },
      configurable: true,
    });
    parentEl = new MockElement('div');
    messagesEl = new MockElement('div');
    parentEl.appendChild(messagesEl);
  });

  afterEach(() => {
    sidebar?.destroy();
    setLocale('en');
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create container with correct class', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      expect(container).not.toBeNull();
    });

    it('should create three navigation buttons', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      expect(container).not.toBeNull();
      // Prev and next went with the float: the outline reaches any message in
              // one press and names it, which is what stepping was for.
              expect(container!.children.length).toBe(3);
    });

    it('should set correct aria-labels on buttons', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      const buttons = container!.children;

      expect(buttons[0].getAttribute('aria-label')).toBe('Scroll to top');
      expect(buttons[1].getAttribute('aria-label')).toBe('Thread outline');
      expect(buttons[2].getAttribute('aria-label')).toBe('Scroll to bottom');
    });

    it('should set correct icons on buttons', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      const buttons = container!.children;

      expect(buttons[0].getAttribute('data-icon')).toBe('arrow-up-to-line');
      expect(buttons[1].getAttribute('data-icon')).toBe('list');
      expect(buttons[2].getAttribute('data-icon')).toBe('arrow-down-to-line');
    });

    it('should localize navigation labels in Simplified Chinese', () => {
      setLocale('zh-CN');
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      const buttons = parentEl.querySelector('.grimoire-nav-sidebar')!.children;
      expect(buttons[0].getAttribute('aria-label')).toBe('滚动至顶部');
      expect(buttons[1].getAttribute('aria-label')).toBe('对话大纲');
      expect(buttons[2].getAttribute('aria-label')).toBe('滚动至底部');
    });
  });

  describe('visibility', () => {
    it('should be hidden when content does not overflow', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      expect(container!.classList.contains('visible')).toBe(false);
    });

    it('should be visible when content overflows', () => {
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      expect(container!.classList.contains('visible')).toBe(true);
    });

    it('should update visibility when updateVisibility is called', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      expect(container!.classList.contains('visible')).toBe(false);

      // Simulate content growth
      messagesEl.scrollHeight = 1000;
      sidebar.updateVisibility();
      jest.advanceTimersByTime(16);

      expect(container!.classList.contains('visible')).toBe(true);
    });

    it('should batch visibility updates until the next animation frame', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      messagesEl.scrollHeight = 1000;
      sidebar.updateVisibility();
      sidebar.updateVisibility();

      expect(container!.classList.contains('visible')).toBe(false);

      jest.advanceTimersByTime(16);

      expect(container!.classList.contains('visible')).toBe(true);
    });
  });

  describe('scroll to top button', () => {
    it('should scroll to top when clicked', () => {
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;
      messagesEl.scrollTop = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      const topBtn = container!.children[0];
      topBtn.click();

      expect(messagesEl.scrollToCalls.length).toBe(1);
      expect(messagesEl.scrollToCalls[0].top).toBe(0);
      expect(messagesEl.scrollToCalls[0].behavior).toBe('smooth');
    });
  });

  describe('scroll to bottom button', () => {
    it('should scroll to bottom when clicked', () => {
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;
      messagesEl.scrollTop = 0;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.grimoire-nav-sidebar');
      const bottomBtn = container!.children[2];
      bottomBtn.click();

      expect(messagesEl.scrollToCalls.length).toBe(1);
      expect(messagesEl.scrollToCalls[0].top).toBe(1000);
      expect(messagesEl.scrollToCalls[0].behavior).toBe('smooth');
    });

    it('delegates to the tab auto-scroll callback when provided', () => {
      const onScrollBottom = jest.fn();
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
        onScrollBottom,
      );

      parentEl.querySelector('.grimoire-nav-sidebar')!.children[2].click();

      expect(onScrollBottom).toHaveBeenCalledTimes(1);
      expect(messagesEl.scrollToCalls).toHaveLength(0);
    });
  });

  describe('conversation directory', () => {
    it('lists user prompts and scrolls the real chat viewport', () => {
      const parent = new MockElement('div');
      const scrollEl = parent.createDiv({ cls: 'grimoire-chat-scroll' });
      const messageListEl = scrollEl.createDiv({ cls: 'grimoire-messages' });
      scrollEl.scrollHeight = 1800;
      scrollEl.clientHeight = 500;

      const first = messageListEl.createDiv({ cls: 'grimoire-message-user' });
      first.textContent = 'First prompt';
      first.offsetTop = 120;
      const second = messageListEl.createDiv({ cls: 'grimoire-message-user' });
      second.textContent = 'Second prompt with more detail';
      second.offsetTop = 620;

      sidebar = new NavigationSidebar(
        parent as unknown as HTMLElement,
        scrollEl as unknown as HTMLElement,
        messageListEl as unknown as HTMLElement,
      );

      const directoryButton = parent.querySelector('.grimoire-nav-sidebar')!.children[1];
      directoryButton.click();

      const directory = parent.querySelector('.grimoire-nav-directory');
      const items = parent.querySelector('.grimoire-nav-directory-list')!.children;
      expect(directory).not.toBeNull();
      expect(directoryButton.getAttribute('aria-expanded')).toBe('true');
      expect(items.map(item => item.querySelector('.grimoire-nav-directory-number')?.textContent)).toEqual([
        '01',
        '02',
      ]);
      expect(items.map(item => item.querySelector('.grimoire-nav-directory-label')?.textContent)).toEqual([
        'First prompt',
        'Second prompt with more detail',
      ]);
      expect(items[0].hasClass('is-active')).toBe(true);
      expect(items[0].getAttribute('aria-current')).toBe('location');
      expect(items[1].hasClass('is-active')).toBe(false);

      items[1].click();
      expect(scrollEl.scrollToCalls.at(-1)?.top).toBe(610);
      expect(parent.querySelector('.grimoire-nav-directory')).toBeNull();
      expect(directoryButton.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows a localized empty state when the conversation has no prompts', () => {
      setLocale('zh-CN');
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      parentEl.querySelector('.grimoire-nav-sidebar')!.children[1].click();

      expect(parentEl.querySelector('.grimoire-nav-directory-title')?.textContent).toBe('对话大纲');
      expect(parentEl.querySelector('.grimoire-nav-directory-empty')?.textContent).toBe('此会话中还没有提问');
    });

    it('highlights the prompt nearest the current scroll position', () => {
      const parent = new MockElement('div');
      const scrollEl = parent.createDiv({ cls: 'grimoire-chat-scroll' });
      const messageListEl = scrollEl.createDiv({ cls: 'grimoire-messages' });
      scrollEl.scrollHeight = 1800;
      scrollEl.clientHeight = 500;
      scrollEl.scrollTop = 650;

      const first = messageListEl.createDiv({ cls: 'grimoire-message-user' });
      first.textContent = 'First prompt';
      first.offsetTop = 120;
      const second = messageListEl.createDiv({ cls: 'grimoire-message-user' });
      second.textContent = 'Second prompt';
      second.offsetTop = 620;

      sidebar = new NavigationSidebar(
        parent as unknown as HTMLElement,
        scrollEl as unknown as HTMLElement,
        messageListEl as unknown as HTMLElement,
      );

      parent.querySelector('.grimoire-nav-sidebar')!.children[1].click();

      const items = parent.querySelector('.grimoire-nav-directory-list')!.children;
      expect(items[0].hasClass('is-active')).toBe(false);
      expect(items[1].hasClass('is-active')).toBe(true);
      expect(items[1].getAttribute('aria-current')).toBe('location');
    });

    it('updates the open outline highlight when navigating to the next prompt', () => {
      const parent = new MockElement('div');
      const scrollEl = parent.createDiv({ cls: 'grimoire-chat-scroll' });
      const messageListEl = scrollEl.createDiv({ cls: 'grimoire-messages' });
      scrollEl.scrollHeight = 1800;
      scrollEl.clientHeight = 500;

      const first = messageListEl.createDiv({ cls: 'grimoire-message-user' });
      first.textContent = 'First prompt';
      first.offsetTop = 0;
      const second = messageListEl.createDiv({ cls: 'grimoire-message-user' });
      second.textContent = 'Second prompt';
      second.offsetTop = 620;

      sidebar = new NavigationSidebar(
        parent as unknown as HTMLElement,
        scrollEl as unknown as HTMLElement,
        messageListEl as unknown as HTMLElement,
      );

      const controls = parent.querySelector('.grimoire-nav-sidebar')!.children;
      controls[1].click();
      const items = parent.querySelector('.grimoire-nav-directory-list')!.children;
      expect(items[0].hasClass('is-active')).toBe(true);

      // Jumping to the latest message moves the reader past the second prompt,
      // and the open outline has to say so without being reopened.
      controls[2].click();

      expect(items[0].hasClass('is-active')).toBe(false);
      expect(items[0].getAttribute('aria-current')).toBeNull();
      expect(items[1].hasClass('is-active')).toBe(true);
      expect(items[1].getAttribute('aria-current')).toBe('location');
    });
  });

  describe('destroy', () => {
    it('should remove container from DOM', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      expect(parentEl.querySelector('.grimoire-nav-sidebar')).not.toBeNull();

      sidebar.destroy();

      expect(parentEl.querySelector('.grimoire-nav-sidebar')).toBeNull();
    });
  });
});
