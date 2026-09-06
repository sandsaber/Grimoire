// Mock for Obsidian API

export const addIcon = jest.fn();
export const requestUrl = jest.fn();
export const setTooltip = jest.fn();

export class Plugin {
  app: any;
  manifest: any;

  constructor(app?: any, manifest?: any) {
    this.app = app;
    this.manifest = manifest;
  }

  addRibbonIcon = jest.fn();
  addCommand = jest.fn();
  addSettingTab = jest.fn();
  registerView = jest.fn();
  loadData = jest.fn().mockResolvedValue({});
  saveData = jest.fn().mockResolvedValue(undefined);
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any = {
    empty: jest.fn(),
    createEl: jest.fn().mockReturnValue({ createEl: jest.fn(), createDiv: jest.fn() }),
    createDiv: jest.fn().mockReturnValue({ createEl: jest.fn(), createDiv: jest.fn() }),
  };

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }

  display() {}
  update = jest.fn();
}

export class ItemView {
  app: any;
  leaf: any;
  containerEl: any = {
    children: [{}, { empty: jest.fn(), addClass: jest.fn(), createDiv: jest.fn().mockReturnValue({
      createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn(), setAttribute: jest.fn() }),
      createDiv: jest.fn().mockReturnValue({ createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn() }) }),
    }) }],
  };

  constructor(leaf: any) {
    this.leaf = leaf;
  }

  getViewType(): string {
    return '';
  }

  getDisplayText(): string {
    return '';
  }

  getIcon(): string {
    return '';
  }
}

export class WorkspaceLeaf {}

export class Scope {
  static instances: Scope[] = [];

  parent?: Scope;
  handlers: Array<{
    modifiers: string[] | null;
    key: string | null;
    func: (evt: KeyboardEvent, ctx?: unknown) => unknown;
  }> = [];

  constructor(parent?: Scope) {
    this.parent = parent;
    Scope.instances.push(this);
  }

  register = jest.fn((
    modifiers: string[] | null,
    key: string | null,
    func: (evt: KeyboardEvent, ctx?: unknown) => unknown
  ) => {
    const handler = { modifiers, key, func };
    this.handlers.push(handler);
    return handler;
  });

  unregister = jest.fn((handler: unknown) => {
    this.handlers = this.handlers.filter((entry) => entry !== handler);
  });
}

export const Platform = {
  isMacOS: true,
};

export class App {
  vault: any = {
    adapter: {
      basePath: '/mock/vault/path',
    },
  };
  workspace: any = {
    getLeavesOfType: jest.fn().mockReturnValue([]),
    getRightLeaf: jest.fn().mockReturnValue({
      setViewState: jest.fn().mockResolvedValue(undefined),
    }),
    getLeftLeaf: jest.fn().mockReturnValue({
      setViewState: jest.fn().mockResolvedValue(undefined),
    }),
    getLeaf: jest.fn().mockReturnValue({
      setViewState: jest.fn().mockResolvedValue(undefined),
    }),
    setActiveLeaf: jest.fn(),
    revealLeaf: jest.fn(),
  };
}

export class MarkdownView {
  editor: any;
  file?: any;

  constructor(editor?: any, file?: any) {
    this.editor = editor;
    this.file = file;
  }
}

export class Setting {
  settingEl: any;
  controlEl: any;
  nameEl: any;
  descEl: any;

  constructor(containerEl: any) {
    this.settingEl = containerEl?.createDiv?.({ cls: 'setting-item' }) ?? {};
    const infoEl = this.settingEl.createDiv?.({ cls: 'setting-item-info' }) ?? {};
    this.nameEl = infoEl.createDiv?.({ cls: 'setting-item-name' }) ?? {};
    this.descEl = infoEl.createDiv?.({ cls: 'setting-item-description' }) ?? {};
    this.controlEl = this.settingEl.createDiv?.({ cls: 'setting-item-control' }) ?? {};
  }

  setName = jest.fn((name: string) => {
    this.nameEl?.setText?.(name);
    return this;
  });

  setDesc = jest.fn((desc: string) => {
    this.descEl?.setText?.(desc);
    return this;
  });

  setHeading = jest.fn(() => {
    this.settingEl?.addClass?.('setting-item-heading');
    return this;
  });

  addDropdown = jest.fn((callback?: (dropdown: DropdownComponent) => void) => {
    const dropdown = new DropdownComponent(this.controlEl);
    callback?.(dropdown);
    return this;
  });

  addSlider = jest.fn((callback?: (slider: SliderComponent) => void) => {
    const slider = new SliderComponent(this.controlEl);
    callback?.(slider);
    return this;
  });

  addText = jest.fn((callback?: (text: TextComponent) => void) => {
    const text = new TextComponent(this.controlEl);
    callback?.(text);
    return this;
  });

  addToggle = jest.fn((callback?: (toggle: ToggleComponent) => void) => {
    const toggle = new ToggleComponent(this.controlEl);
    callback?.(toggle);
    return this;
  });

  addButton = jest.fn((callback?: (button: ButtonComponent) => void) => {
    const button = new ButtonComponent(this.controlEl);
    callback?.(button);
    return this;
  });

  addTextArea = jest.fn((callback?: (text: TextAreaComponent) => void) => {
    const text = new TextAreaComponent(this.controlEl);
    callback?.(text);
    return this;
  });
}

export class ButtonComponent {
  buttonEl: any;

  constructor(containerEl?: any) {
    this.buttonEl = containerEl?.createEl?.('button') ?? {};
  }

  setButtonText(text: string): this {
    this.buttonEl?.setText?.(text);
    return this;
  }

  setDisabled(disabled: boolean): this {
    if (this.buttonEl) {
      this.buttonEl.disabled = disabled;
    }
    return this;
  }

  onClick(handler: () => void | Promise<void>): this {
    this.buttonEl?.addEventListener?.('click', handler);
    return this;
  }
}

export class DropdownComponent {
  selectEl: any;
  options: Record<string, string> = {};
  value = '';
  onChangeHandler: ((value: string) => void | Promise<void>) | null = null;

  constructor(containerEl?: any) {
    this.selectEl = containerEl?.createEl?.('select') ?? {};
  }

  addOption(value: string, display: string): this {
    this.options[value] = display;
    this.selectEl?.createEl?.('option', { text: display, attr: { value } });
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    this.selectEl.value = value;
    return this;
  }

  onChange(handler: (value: string) => void | Promise<void>): this {
    this.onChangeHandler = handler;
    this.selectEl?.addEventListener?.('change', () => {
      void handler(this.selectEl.value ?? '');
    });
    return this;
  }
}

export class SliderComponent {
  sliderEl: any;
  min = 0;
  max = 100;
  step = 1;
  value = 0;
  onChangeHandler: ((value: number) => void | Promise<void>) | null = null;

  constructor(containerEl?: any) {
    this.sliderEl = containerEl?.createEl?.('input', {
      attr: { type: 'range' },
    }) ?? {};
  }

  setLimits(min: number, max: number, step: number): this {
    this.min = min;
    this.max = max;
    this.step = step;
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }

  setValue(value: number): this {
    this.value = value;
    this.sliderEl.value = String(value);
    return this;
  }

  setDynamicTooltip(): this {
    return this;
  }

  onChange(handler: (value: number) => void | Promise<void>): this {
    this.onChangeHandler = handler;
    return this;
  }
}

export class TextComponent {
  inputEl: any;
  private _value = '';

  constructor(containerEl?: any) {
    this.inputEl = containerEl?.createEl?.('input', { attr: { type: 'text' } }) ?? {
      addClass: jest.fn(),
      addEventListener: jest.fn(),
    };
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    this.inputEl?.setAttribute?.('placeholder', value);
    return this;
  }

  setValue(value: string): this {
    this._value = value;
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this._value;
  }

  onChange(handler: (value: string) => void | Promise<void>): this {
    this.inputEl?.addEventListener?.('change', () => {
      void handler(this.inputEl.value ?? '');
    });
    return this;
  }
}

export class ToggleComponent {
  toggleEl: any;
  value = false;

  constructor(containerEl?: any) {
    this.toggleEl = containerEl?.createEl?.('input', {
      attr: { type: 'checkbox' },
    }) ?? {};
  }

  setValue(value: boolean): this {
    this.value = value;
    this.toggleEl.checked = value;
    return this;
  }

  onChange(handler: (value: boolean) => void | Promise<void>): this {
    this.toggleEl?.addEventListener?.('change', () => {
      void handler(Boolean(this.toggleEl.checked));
    });
    return this;
  }
}

export class TextAreaComponent {
  inputEl: any;
  private _value = '';

  constructor(containerEl?: any) {
    this.inputEl = containerEl?.createEl?.('textarea') ?? {
      addClass: jest.fn(),
      rows: 0,
      placeholder: '',
      focus: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  }

  setValue(value: string): this {
    this._value = value;
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this._value;
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    this.inputEl?.setAttribute?.('placeholder', value);
    return this;
  }

  onChange(handler: (value: string) => void | Promise<void>): this {
    this.inputEl?.addEventListener?.('change', () => {
      void handler(this.inputEl.value ?? '');
    });
    return this;
  }
}

export class Modal {
  app: any;
  containerEl: any = {
    createDiv: jest.fn().mockReturnValue({
      createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn() }),
      createDiv: jest.fn().mockReturnValue({
        createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn() }),
        createDiv: jest.fn().mockReturnValue({
          createEl: jest.fn(),
        }),
        setText: jest.fn(),
      }),
      addClass: jest.fn(),
      setText: jest.fn(),
    }),
    empty: jest.fn(),
    addClass: jest.fn(),
  };
  contentEl: any = {
    createDiv: jest.fn().mockReturnValue({
      createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn() }),
      createDiv: jest.fn().mockReturnValue({
        createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn() }),
        createDiv: jest.fn().mockReturnValue({
          createEl: jest.fn(),
        }),
        setText: jest.fn(),
      }),
      addClass: jest.fn(),
      setText: jest.fn(),
    }),
    empty: jest.fn(),
    addClass: jest.fn(),
  };

  constructor(app: any) {
    this.app = app;
  }

  open = jest.fn();
  close = jest.fn();
  onOpen = jest.fn();
  onClose = jest.fn();
}

class MockMenuItem {
  title = '';
  icon = '';
  disabled = false;
  clickHandler: (() => void) | null = null;

  setTitle = jest.fn((title: string) => {
    this.title = title;
    return this;
  });

  setIcon = jest.fn((icon: string) => {
    this.icon = icon;
    return this;
  });

  setDisabled = jest.fn((disabled: boolean) => {
    this.disabled = disabled;
    return this;
  });

  setIsLabel = jest.fn((_isLabel: boolean) => this);

  onClick = jest.fn((handler: () => void) => {
    this.clickHandler = handler;
    return this;
  });
}

export class Menu {
  static instances: Menu[] = [];

  items: MockMenuItem[] = [];
  showAtMouseEvent = jest.fn();

  constructor() {
    Menu.instances.push(this);
  }

  addItem(callback: (item: MockMenuItem) => MockMenuItem | void): this {
    const item = new MockMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    return this;
  }
}

const renderMarkdownMock = jest.fn<Promise<void>, [string, unknown, string, unknown]>().mockResolvedValue(undefined);

export const MarkdownRenderer = {
  render: jest.fn<Promise<void>, [unknown, string, unknown, string, unknown]>(
    (_app, markdown, el, sourcePath, component) => renderMarkdownMock(markdown, el, sourcePath, component),
  ),
  renderMarkdown: renderMarkdownMock,
};

export const setIcon = jest.fn();

// Notice mock that tracks constructor calls
export const Notice = jest.fn().mockImplementation((_message: string, _timeout?: number) => {});

function unquoteYaml(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlValue(rawValue: string): unknown {
  if (!rawValue) return null;

  if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
    try { return JSON.parse(rawValue); } catch { /* fall through */ }
  }

  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    return rawValue.slice(1, -1).split(',').map(item => unquoteYaml(item.trim())).filter(Boolean);
  }

  if (rawValue === 'true' || rawValue === 'false') {
    return rawValue === 'true';
  }

  const numberValue = Number(rawValue);
  if (!Number.isNaN(numberValue) && rawValue !== '') {
    return numberValue;
  }

  return unquoteYaml(rawValue);
}

export function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split(/\r?\n/);
  let currentArrayKey: string | null = null;
  let currentArray: string[] = [];
  let blockScalarKey: string | null = null;
  let blockScalarStyle: 'literal' | 'folded' | null = null;
  let blockScalarLines: string[] = [];
  let blockScalarIndent: number | null = null;

  const flushArray = () => {
    if (currentArrayKey) {
      result[currentArrayKey] = currentArray;
      currentArrayKey = null;
      currentArray = [];
    }
  };

  const flushBlockScalar = () => {
    if (!blockScalarKey) return;
    let value: string;
    if (blockScalarStyle === 'literal') {
      value = blockScalarLines.join('\n');
    } else {
      value = blockScalarLines.join('\n').replace(/(?<!\n)\n(?!\n)/g, ' ').trim();
    }
    result[blockScalarKey] = value;
    blockScalarKey = null;
    blockScalarStyle = null;
    blockScalarLines = [];
    blockScalarIndent = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle block scalar content
    if (blockScalarKey) {
      if (trimmed === '') {
        blockScalarLines.push('');
        continue;
      }
      const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (blockScalarIndent === null) {
        if (leadingSpaces === 0) {
          flushBlockScalar();
          // fall through to process this line
        } else {
          blockScalarIndent = leadingSpaces;
          blockScalarLines.push(line.slice(blockScalarIndent));
          continue;
        }
      } else if (leadingSpaces >= blockScalarIndent) {
        blockScalarLines.push(line.slice(blockScalarIndent));
        continue;
      } else {
        flushBlockScalar();
        // fall through
      }
    }

    // Handle YAML list items (- value)
    if (currentArrayKey && trimmed.startsWith('- ')) {
      currentArray.push(unquoteYaml(trimmed.slice(2).trim()));
      continue;
    }

    // Not a list item — flush any pending array
    if (currentArrayKey && trimmed !== '') {
      flushArray();
    }

    if (!trimmed) continue;

    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    const rawValue = match[2].trim();
    if (!key) continue;

    // Check for block scalar indicator (| or >) with optional chomping
    const blockMatch = rawValue.match(/^([|>])([+-])?$/);
    if (blockMatch) {
      blockScalarKey = key;
      blockScalarStyle = blockMatch[1] === '|' ? 'literal' : 'folded';
      blockScalarLines = [];
      blockScalarIndent = null;
      continue;
    }

    if (!rawValue) {
      // Could be start of a YAML list or a null value — peek ahead
      currentArrayKey = key;
      currentArray = [];
      continue;
    }

    result[key] = parseYamlValue(rawValue);
  }

  if (blockScalarKey) flushBlockScalar();
  flushArray();

  return result;
}

// TFile class for instanceof checks
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;

  constructor(path: string = '') {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.extension = this.name.split('.').pop() || '';
  }
}

export class TFolder {
  path: string;
  name: string;
  children: any[] = [];

  constructor(path: string = '') {
    this.path = path;
    this.name = path.split('/').pop() || '';
  }
}
