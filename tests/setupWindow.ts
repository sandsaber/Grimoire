type TestWindow = typeof globalThis & {
  cancelAnimationFrame?: (handle: number) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

import * as nodeTimers from 'node:timers';
const testWindow = globalThis as TestWindow;

function ensureGlobalTimers(): void {
  const timerEntries = {
    clearInterval: nodeTimers.clearInterval,
    clearTimeout: nodeTimers.clearTimeout,
    setInterval: nodeTimers.setInterval,
    setTimeout: nodeTimers.setTimeout,
  } as const;

  for (const [name, fallback] of Object.entries(timerEntries)) {
    const key = name as keyof typeof timerEntries;
    if (typeof globalThis[key] !== 'function') {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value: fallback,
        writable: true,
      });
    }
  }
}

function installObsidianDomHelpers(): void {
  if (typeof Element === 'undefined') return;

  if (typeof Document !== 'undefined') {
    const documentPrototype = Document.prototype as unknown as Record<string, any>;
    if (!Object.getOwnPropertyDescriptor(documentPrototype, 'win')) {
      Object.defineProperty(documentPrototype, 'win', {
        configurable: true,
        get(this: Document): Window | null {
          return this.defaultView;
        },
      });
    }
  }

  if (typeof Window !== 'undefined') {
    const windowPrototype = Window.prototype as unknown as Record<string, any>;
    if (typeof windowPrototype.createFragment !== 'function') {
      windowPrototype.createFragment = function createFragment(this: Window): DocumentFragment {
        return this.document.createDocumentFragment();
      };
    }
  }

  const prototype = Element.prototype as unknown as Record<string, any>;
  if (typeof prototype.createEl !== 'function') {
    prototype.createEl = function createEl(
      this: Element,
      tagName: string,
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLElement {
      const element = this.ownerDocument.createElement(tagName);
      if (options?.cls) element.className = options.cls;
      if (options?.text) element.textContent = options.text;
      for (const [name, value] of Object.entries(options?.attr ?? {})) {
        element.setAttribute(name, value);
      }
      this.appendChild(element);
      return element;
    };
  }
  if (typeof prototype.createDiv !== 'function') {
    prototype.createDiv = function createDiv(
      this: Element,
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLDivElement {
      return (this as any).createEl('div', options);
    };
  }
  if (typeof prototype.createSpan !== 'function') {
    prototype.createSpan = function createSpan(
      this: Element,
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLSpanElement {
      return (this as any).createEl('span', options);
    };
  }
  if (typeof prototype.createSvg !== 'function') {
    prototype.createSvg = function createSvg(
      this: Element,
      tagName: string,
      options?: { cls?: string; attr?: Record<string, string> },
    ): SVGElement {
      const element = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tagName);
      if (options?.cls) element.setAttribute('class', options.cls);
      for (const [name, value] of Object.entries(options?.attr ?? {})) {
        element.setAttribute(name, value);
      }
      this.appendChild(element);
      return element;
    };
  }
  if (typeof prototype.detach !== 'function') {
    prototype.detach = function detach(this: Element): Element {
      this.remove();
      return this;
    };
  }

  installObsidianGlobalFactories();
}

/**
 * Obsidian declares `createFragment`/`createSpan`/`createDiv` as globals, and the repo's
 * lint rules require using them over raw DOM calls. jsdom provides neither, so code that
 * follows those rules is untestable without these stubs.
 */
function installObsidianGlobalFactories(): void {
  if (typeof document === 'undefined') return;

  const globals = globalThis as unknown as Record<string, unknown>;

  // An own property, because `Window.prototype.createFragment` above is reachable as a
  // bare global but loses its `this` when called that way.
  if (!Object.getOwnPropertyDescriptor(globalThis, 'createFragment')) {
    globals.createFragment = function createFragment(
      callback?: (fragment: DocumentFragment) => void,
    ): DocumentFragment {
      const fragment = document.createDocumentFragment();
      callback?.(fragment);
      return fragment;
    };
  }

  for (const [name, tagName] of [['createSpan', 'span'], ['createDiv', 'div']] as const) {
    if (Object.getOwnPropertyDescriptor(globalThis, name)) continue;
    globals[name] = function createDetachedEl(
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLElement {
      const element = document.createElement(tagName);
      if (options?.cls) element.setAttribute('class', options.cls);
      if (options?.text !== undefined) element.textContent = options.text;
      for (const [attribute, value] of Object.entries(options?.attr ?? {})) {
        element.setAttribute(attribute, value);
      }
      return element;
    };
  }
}

ensureGlobalTimers();
installObsidianDomHelpers();

if (!testWindow.requestAnimationFrame) {
  testWindow.requestAnimationFrame = (callback: FrameRequestCallback): number => (
    Number(globalThis.setTimeout(() => callback(Date.now()), 0))
  );
}

if (!testWindow.cancelAnimationFrame) {
  testWindow.cancelAnimationFrame = (handle: number): void => {
    globalThis.clearTimeout(handle);
  };
}

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
    writable: true,
  });
}

beforeEach(() => {
  ensureGlobalTimers();
  installObsidianDomHelpers();
});

afterEach(() => {
  ensureGlobalTimers();
});
