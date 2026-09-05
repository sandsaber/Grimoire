import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Menu, Scope, setIcon } from 'obsidian';

import { GrimoireView } from '@/features/chat/GrimoireView';

const MockScope = Scope as typeof Scope & { instances: Scope[] };
const MockMenu = Menu as unknown as typeof Menu & { instances: any[] };

function createViewHarness(options: {
  canCreateTab: boolean;
  tabBarPosition?: 'input' | 'header';
  tabCount?: number;
}): {
  newTabButtonEl: ReturnType<typeof createMockEl>;
  view: any;
} {
  const newTabButtonEl = createMockEl();
  const view = Object.create(GrimoireView.prototype);

  view.plugin = {
    settings: {
      tabBarPosition: options.tabBarPosition ?? 'input',
    },
  };
  view.tabManager = {
    canCreateTab: jest.fn().mockReturnValue(options.canCreateTab),
    getTabCount: jest.fn().mockReturnValue(options.tabCount ?? 1),
  };
  view.tabBarContainerEl = createMockEl();
  view.newTabButtonEl = newTabButtonEl;

  return { newTabButtonEl, view };
}

describe('GrimoireView tab controls', () => {
  it('uses the Grimoire display text', () => {
    const view = Object.create(GrimoireView.prototype) as GrimoireView;

    expect(view.getDisplayText()).toBe('Grimoire');
  });

  it('uses the custom Grimoire app icon', () => {
    const view = Object.create(GrimoireView.prototype) as GrimoireView;

    expect(view.getIcon()).toBe('grimoire');
  });

  it('builds the composer session controls with a context meter', () => {
    const containerEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;

    const nav = view.buildNavRowContent();

    expect(nav.querySelector('.grimoire-tab-bar-container')).not.toBeNull();
    expect(nav.querySelector('.grimoire-context-meter')).not.toBeNull();
    expect(nav.querySelector('.grimoire-new-tab-btn')).not.toBeNull();
  });

  it('places the shared session controls above the panel-view row', () => {
    const view = Object.create(GrimoireView.prototype);
    const navContentEl = createMockEl();
    const sessionStripEl = createMockEl();

    view.navContentEl = navContentEl;
    view.sessionStripEl = sessionStripEl;

    view.updateNavRowLocation();

    expect(sessionStripEl.children).toContain(navContentEl);
  });

  it('places the history button after the new-tab control without appearance controls', () => {
    const containerEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;

    (setIcon as jest.Mock).mockClear();
    const nav = view.buildNavRowContent();
    const actions = nav.querySelector('.grimoire-header-actions');
    const newTabButton = nav.querySelector('.grimoire-new-tab-btn');
    const historyButton = nav.querySelector('.grimoire-history-btn');
    const appearanceButton = nav.querySelector('.grimoire-appearance-btn');

    expect(historyButton).not.toBeNull();
    expect(historyButton?.getAttribute('aria-label')).toBe('Chat history');
    expect(historyButton?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(historyButton?.getAttribute('aria-expanded')).toBe('false');
    expect(historyButton?.tagName).toBe('DIV');
    expect(historyButton?.getAttribute('role')).toBe('button');
    expect(historyButton?.getAttribute('tabindex')).toBe('0');
    expect(historyButton?.children.some((child: any) => child.tagName === 'svg'.toUpperCase())).toBe(true);
    expect(setIcon).not.toHaveBeenCalled();
    expect(actions?.children.indexOf(newTabButton)).toBeLessThan(actions?.children.indexOf(historyButton) ?? -1);
    expect(appearanceButton).toBeNull();
  });

  it('toggles the full-pane history sheet without visually selecting the button', () => {
    const containerEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;
    view.historyDropdown = createMockEl();
    view.historyDropdown.setAttribute('aria-hidden', 'true');
    view.updateHistoryDropdown = jest.fn();

    const nav = view.buildNavRowContent();
    const historyButton = nav.querySelector('.grimoire-history-btn');

    historyButton?.click();

    expect(view.historyDropdown.hasClass('visible')).toBe(true);
    expect(view.historyDropdown.getAttribute('aria-hidden')).toBe('false');
    expect(historyButton?.hasClass('active')).toBe(false);
    expect(historyButton?.getAttribute('aria-expanded')).toBe('true');

    historyButton?.click();

    expect(view.historyDropdown.hasClass('visible')).toBe(false);
    expect(view.historyDropdown.getAttribute('aria-hidden')).toBe('true');
    expect(historyButton?.hasClass('active')).toBe(false);
    expect(historyButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('builds the history sheet inside the chat shell with a dialog role', () => {
    const view = Object.create(GrimoireView.prototype);
    const shell = createMockEl();
    view.historyDialogTitleId = 'grimoire-history-title-test';

    const sheet = view.buildHistorySheet(shell);

    expect(sheet.hasClass('grimoire-history-menu')).toBe(true);
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-label')).toBeNull();
    expect(sheet.getAttribute('aria-labelledby')).toBe('grimoire-history-title-test');
    expect(sheet.getAttribute('aria-hidden')).toBe('true');
    expect(shell.children.includes(sheet)).toBe(true);
  });

  it('uses final chat-window classes for the root shell', async () => {
    const containerEl = createMockEl();
    const contentEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;
    view.contentEl = contentEl;
    view.plugin = {
      settings: {},
      app: {
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
      findConversationAcrossViews: jest.fn(),
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.restoreOrCreateTabs = jest.fn().mockResolvedValue(undefined);
    view.syncProviderBrandColor = jest.fn();
    view.wireEventHandlers = jest.fn();

    await view.onOpen();

    expect(contentEl.hasClass('grimoire-container')).toBe(true);
    expect(contentEl.hasClass('grimoire-container--chat-window')).toBe(true);
    expect(contentEl.hasClass('grimoire-container--workbench')).toBe(false);
    expect(contentEl.querySelector('.grimoire-chat-window-shell')).not.toBeNull();
    expect(contentEl.querySelector('.grimoire-session-strip')).not.toBeNull();
  });

  it('renders pending what is new release inside the chat window and acknowledges dismissal', async () => {
    const containerEl = createMockEl();
    const contentEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);
    const acknowledgePendingWhatsNew = jest.fn().mockResolvedValue(undefined);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;
    view.contentEl = contentEl;
    view.plugin = {
      settings: {},
      app: {
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
      findConversationAcrossViews: jest.fn(),
      getPendingWhatsNewRelease: jest.fn().mockReturnValue({
        version: '1.0.0',
        date: '2026-06-21',
        categories: [
          { title: 'Added', items: ['Inline release card.'] },
        ],
      }),
      acknowledgePendingWhatsNew,
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.restoreOrCreateTabs = jest.fn().mockResolvedValue(undefined);
    view.syncProviderBrandColor = jest.fn();
    view.wireEventHandlers = jest.fn();

    await view.onOpen();

    expect(contentEl.querySelector('.grimoire-whats-new-host')).not.toBeNull();
    expect(contentEl.querySelector('.grimoire-whats-new-card-title')?.textContent)
      .toBe('What\'s New in Grimoire v1.0.0');
    expect(contentEl.querySelector('.grimoire-whats-new-card-item')?.textContent)
      .toContain('Inline release card.');

    contentEl.querySelector('.grimoire-whats-new-card-dismiss')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(acknowledgePendingWhatsNew).toHaveBeenCalledTimes(1);
    expect(contentEl.querySelector('.grimoire-whats-new-card')).toBeNull();
  });

  it('can render pending what is new release after the chat window is already open', async () => {
    const containerEl = createMockEl();
    const contentEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);
    const getPendingWhatsNewRelease = jest.fn().mockReturnValue(null);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;
    view.contentEl = contentEl;
    view.plugin = {
      settings: {},
      app: {
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
      findConversationAcrossViews: jest.fn(),
      getPendingWhatsNewRelease,
      acknowledgePendingWhatsNew: jest.fn().mockResolvedValue(undefined),
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.restoreOrCreateTabs = jest.fn().mockResolvedValue(undefined);
    view.syncProviderBrandColor = jest.fn();
    view.wireEventHandlers = jest.fn();

    await view.onOpen();

    expect(contentEl.querySelector('.grimoire-whats-new-card')).toBeNull();

    getPendingWhatsNewRelease.mockReturnValue({
      version: '1.0.0',
      categories: [
        { title: 'Fixed', items: ['Refresh opened Grimoire windows.'] },
      ],
    });

    view.showPendingWhatsNew();

    expect(contentEl.querySelector('.grimoire-whats-new-card-title')?.textContent)
      .toBe('What\'s New in Grimoire v1.0.0');
    expect(contentEl.querySelector('.grimoire-whats-new-card-item')?.textContent)
      .toContain('Refresh opened Grimoire windows.');
  });

  it('persists tab state when blank tab draft settings change', async () => {
    const containerEl = createMockEl();
    const contentEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;
    view.contentEl = contentEl;
    view.plugin = {
      settings: {},
      app: {
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
      findConversationAcrossViews: jest.fn(),
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.restoreOrCreateTabs = jest.fn().mockResolvedValue(undefined);
    view.syncProviderBrandColor = jest.fn();
    view.syncHeaderContextUsage = jest.fn();
    view.wireEventHandlers = jest.fn();

    await view.onOpen();

    view.updateTabBar = jest.fn();
    view.persistTabState = jest.fn();

    view.tabManager.callbacks.onTabDraftSettingsChanged('tab-1', 'codex', {
      model: 'gpt-5.5',
    });

    expect(view.updateTabBar).toHaveBeenCalled();
    expect(view.persistTabState).toHaveBeenCalled();
    expect(view.syncProviderBrandColor).toHaveBeenCalled();
    expect(view.syncHeaderContextUsage).toHaveBeenCalled();
  });

  it('does not build the removed quick appearance sheet', async () => {
    const containerEl = createMockEl();
    const contentEl = createMockEl();
    const view = Object.create(GrimoireView.prototype);
    const saveSettings = jest.fn().mockResolvedValue(undefined);

    containerEl.ownerDocument.createDocumentFragment = jest.fn(() => createMockEl('fragment'));
    view.containerEl = containerEl;
    view.contentEl = contentEl;
    view.plugin = {
      settings: {},
      app: {
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
      findConversationAcrossViews: jest.fn(),
      saveSettings,
    };
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.restoreOrCreateTabs = jest.fn().mockResolvedValue(undefined);
    view.syncProviderBrandColor = jest.fn();
    view.wireEventHandlers = jest.fn();

    await view.onOpen();

    expect(contentEl.querySelector('.grimoire-appearance-sheet')).toBeNull();
    expect(contentEl.querySelector('.grimoire-appearance-btn')).toBeNull();
    expect(contentEl.dataset.theme).toBeUndefined();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('hides the new-tab button when the tab manager is at capacity', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: false });

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('grimoire-hidden')).toBe(true);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBe('true');
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the new-tab button when another tab can be created', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: true });
    newTabButtonEl.addClass('grimoire-hidden');
    newTabButtonEl.setAttribute('aria-disabled', 'true');
    newTabButtonEl.setAttribute('aria-hidden', 'true');

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('grimoire-hidden')).toBe(false);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBeNull();
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('GrimoireView Escape handling', () => {
  beforeEach(() => {
    MockScope.instances.length = 0;
  });

  function createEscapeHarness(options: {
    isStreaming: boolean;
    tabCount?: number;
  }): {
    cancelStreaming: jest.Mock;
    eventRefs: unknown[];
    requestTabClose: jest.Mock;
    view: any;
  } {
    const cancelStreaming = jest.fn();
    const requestTabClose = jest.fn().mockResolvedValue(undefined);
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(GrimoireView.prototype);

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: options.isStreaming },
        controllers: {
          inputController: { cancelStreaming },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
      getTabCount: jest.fn().mockReturnValue(options.tabCount ?? 2),
      getActiveTabId: jest.fn().mockReturnValue('active-tab'),
    };
    view.requestTabClose = requestTabClose;

    return { cancelStreaming, eventRefs, requestTabClose, view };
  }

  it('registers Escape on the Obsidian view scope instead of document keydown capture', () => {
    const { view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();

    expect(view.scope).toBeInstanceOf(Scope);
    expect(view.scope.parent).toBe(view.app.scope);
    expect(view.scope.register).toHaveBeenCalledWith([], 'Escape', expect.any(Function));
    expect(view.registerDomEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'keydown',
      expect.any(Function),
      { capture: true }
    );
  });

  it('cancels streaming and consumes scoped Escape', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false });

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('consumes scoped Escape without cancelling when not streaming', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: false });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false });

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes already handled scoped Escape without cancelling again', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({
      key: 'Escape',
      isComposing: false,
      defaultPrevented: true,
    });

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('closes the active Grimoire tab with Mod+W', () => {
    const { requestTabClose, view } = createEscapeHarness({
      isStreaming: false,
      tabCount: 3,
    });

    view.wireEventHandlers();
    const closeHandler = view.scope.handlers.find((handler: any) => (
      handler.key === 'w' && handler.modifiers?.includes('Mod')
    ));
    const result = closeHandler.func({ key: 'w', isComposing: false });

    expect(requestTabClose).toHaveBeenCalledWith('active-tab');
    expect(result).toBe(false);
  });

  it('keeps the last Grimoire tab open while consuming Mod+W', () => {
    const { requestTabClose, view } = createEscapeHarness({
      isStreaming: false,
      tabCount: 1,
    });

    view.wireEventHandlers();
    const closeHandler = view.scope.handlers.find((handler: any) => (
      handler.key === 'w' && handler.modifiers?.includes('Mod')
    ));
    const result = closeHandler.func({ key: 'w', isComposing: false });

    expect(requestTabClose).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe('GrimoireView permission mode shortcut', () => {
  function createPermissionShortcutHarness(permissionMode: string) {
    const handlers: Array<(event: KeyboardEvent) => void> = [];
    const inputWrapper = createMockEl();
    const activeTab = {
      providerId: 'claude',
      lifecycleState: 'active',
      conversationId: null,
      draftModel: null,
      service: null,
      state: { prePlanPermissionMode: null },
      ui: { permissionToggle: { updateDisplay: jest.fn() } },
      dom: { inputWrapper },
    };
    const view = Object.create(GrimoireView.prototype);

    view.app = { scope: new Scope() };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.eventRefs = [];
    view.registerDomEvent = jest.fn((_target, eventName, handler) => {
      if (eventName === 'keydown') handlers.push(handler);
    });
    view.registerEvent = jest.fn();
    view.plugin = {
      settings: {
        settingsProvider: 'claude',
        providerConfigs: { claude: { enabled: true } },
        model: 'sonnet',
        permissionMode,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      app: {
        vault: { on: jest.fn() },
        workspace: { on: jest.fn() },
      },
    };
    view.tabManager = { getActiveTab: jest.fn().mockReturnValue(activeTab) };
    view.wireEventHandlers();

    const keydown = handlers[0];
    const pressShiftTab = () => keydown({
      key: 'Tab',
      shiftKey: true,
      isComposing: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent);

    return { activeTab, pressShiftTab, view };
  }

  it('cycles Safe, Auto-approve, and Plan with Shift+Tab', () => {
    const { activeTab, pressShiftTab, view } = createPermissionShortcutHarness('normal');

    pressShiftTab();
    expect(view.plugin.settings.permissionMode).toBe('full_access');

    pressShiftTab();
    expect(view.plugin.settings.permissionMode).toBe('plan');
    expect(activeTab.state.prePlanPermissionMode).toBe('full_access');

    pressShiftTab();
    expect(view.plugin.settings.permissionMode).toBe('normal');
    expect(activeTab.state.prePlanPermissionMode).toBeNull();
  });
});

describe('GrimoireView orchestrator wiring', () => {
  function createOrchestratorHarness() {
    const view = Object.create(GrimoireView.prototype);
    view.plugin = { settings: {} };
    const orchestratorStreamController = {
      setOrchestratorCallbacks: jest.fn(),
    };
    const workerStreamController = {
      setOrchestratorCallbacks: jest.fn(),
    };
    const workerSendMessage = jest.fn().mockResolvedValue(undefined);
    const workerTab = {
      id: 'worker-tab',
      orchestratorMode: false,
      orchestratorTabId: 'orchestrator-tab',
      controllers: {
        inputController: { sendMessage: workerSendMessage },
        streamController: workerStreamController,
      },
    };
    const orchestratorTab = {
      id: 'orchestrator-tab',
      providerId: 'codex',
      lifecycleState: 'blank',
      draftSettings: { model: 'gpt-5.6-luna', effortLevel: 'high' },
      orchestratorMode: true,
      controllers: {
        streamController: orchestratorStreamController,
      },
    };
    const tabManager = {
      createWorkerTab: jest.fn().mockResolvedValue(workerTab),
      getTab: jest.fn((tabId: string) => {
        if (tabId === 'orchestrator-tab') return orchestratorTab;
        if (tabId === 'worker-tab') return workerTab;
        return null;
      }),
    };
    view.tabManager = tabManager;
    view.updateTabBar = jest.fn();
    view.persistTabState = jest.fn();

    return {
      orchestratorStreamController,
      orchestratorTab,
      tabManager,
      view,
      workerSendMessage,
      workerStreamController,
      workerTab,
    };
  }

  it('spawns worker tabs from an approved orchestrator plan', async () => {
    const {
      orchestratorStreamController,
      orchestratorTab,
      tabManager,
      view,
      workerSendMessage,
      workerStreamController,
    } = createOrchestratorHarness();
    const containerEl = createMockEl();

    view.wireOrchestratorCallbacks(orchestratorTab);
    const [onPlanDetected, isOrchestratorMode] = orchestratorStreamController
      .setOrchestratorCallbacks.mock.calls[0];

    expect(isOrchestratorMode()).toBe(true);

    onPlanDetected(containerEl, {
      type: 'parallel_worker_plan',
      tasks: [
        {
          id: 'research',
          description: 'Research implementation',
          prompt: 'Inspect the implementation files',
        },
        {
          id: 'tests',
          description: 'Add regression tests',
          prompt: 'Write focused tests',
        },
      ],
    });

    containerEl.querySelector('.grimoire-orchestrator-plan-spawn-button')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(tabManager.createWorkerTab).toHaveBeenCalledTimes(2);
    expect(tabManager.createWorkerTab).toHaveBeenCalledWith('orchestrator-tab');
    expect(workerSendMessage).toHaveBeenCalledWith({ content: 'Inspect the implementation files' });
    expect(workerStreamController.setOrchestratorCallbacks).toHaveBeenCalled();
    expect(view.updateTabBar).toHaveBeenCalled();
    expect(view.persistTabState).toHaveBeenCalled();
  });

  it('does not attach plan or result-forwarding callbacks to worker tabs', () => {
    const { view, workerStreamController, workerTab } = createOrchestratorHarness();

    view.wireOrchestratorCallbacks(workerTab);

    const [onPlanDetected, isOrchestratorMode] = workerStreamController
      .setOrchestratorCallbacks.mock.calls[0];
    expect(onPlanDetected).toBeUndefined();
    expect(isOrchestratorMode()).toBe(false);
  });
});

describe('GrimoireView tab context menu auto-rename', () => {
  function createMenuHarness(options: {
    enabled?: boolean;
    canSuggest?: boolean;
    hasController?: boolean;
    title?: string;
  } = {}) {
    const regenerateTitle = jest.fn().mockResolvedValue(undefined);
    const controller = {
      isAutoTitleEnabled: jest.fn().mockReturnValue(options.enabled ?? true),
      canSuggestTitle: jest.fn().mockReturnValue(options.canSuggest ?? true),
      regenerateTitle,
    };
    const tab = {
      id: 'tab-1',
      conversationId: 'conv-1',
      titleOverride: options.title ?? 'Tab One',
      controllers: {
        conversationController: (options.hasController ?? true) ? controller : null,
      },
    };
    const view = Object.create(GrimoireView.prototype);
    view.app = {};
    view.plugin = {
      settings: { enableAutoTitleGeneration: options.enabled ?? true },
      getConversationSync: jest.fn().mockReturnValue(null),
    };
    view.tabManager = {
      getTab: jest.fn().mockReturnValue(tab),
      getTabIds: jest.fn().mockReturnValue(['tab-1', 'tab-2']),
      canCreateTab: jest.fn().mockReturnValue(true),
    };

    MockMenu.instances.length = 0;
    view.showTabContextMenu('tab-1', {});

    const menu = MockMenu.instances[MockMenu.instances.length - 1];
    const item = menu.items.find((entry: any) => entry.title === 'Auto-rename');
    return { item, regenerateTitle, controller, menu };
  }

  it('offers auto-rename for a tab with a conversation', () => {
    const { item, regenerateTitle } = createMenuHarness();

    expect(item).toBeDefined();
    expect(item?.disabled).toBe(false);

    item?.clickHandler?.();

    expect(regenerateTitle).toHaveBeenCalledWith('conv-1');
  });

  it('hides auto-rename when the setting is off', () => {
    expect(createMenuHarness({ enabled: false }).item).toBeUndefined();
  });

  it('hides auto-rename when the tab has no controller', () => {
    expect(createMenuHarness({ hasController: false }).item).toBeUndefined();
  });

  it('disables auto-rename when there is nothing to name yet', () => {
    const { item, regenerateTitle } = createMenuHarness({ canSuggest: false });

    expect(item?.disabled).toBe(true);
    expect(regenerateTitle).not.toHaveBeenCalled();
  });

  it('heads the menu with the tab title as the user wrote it', () => {
    const { menu } = createMenuHarness({ title: 'Объяснить логику Grimoire' });

    expect(menu.items[0].title).toBe('Объяснить логику Grimoire');
  });

  // The shortened form needs a DOM; it is covered in tabMenuHeading.test.ts (jsdom).
});
