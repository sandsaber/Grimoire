import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Scope, setIcon } from 'obsidian';

import { GrimoireView } from '@/features/chat/GrimoireView';

const MockScope = Scope as typeof Scope & { instances: Scope[] };

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
    const orchestratorStreamController = {
      setOrchestratorCallbacks: jest.fn(),
    };
    const created: string[] = [];
    const updated: { id: string; updates: Record<string, unknown> }[] = [];
    const prepareAndDispatch = jest.fn().mockResolvedValue(undefined);
    const agentDispatcher = { dispatch: jest.fn() };
    view.plugin = {
      settings: {},
      createConversation: jest.fn(async () => {
        const id = `conv-worker-${created.length + 1}`;
        created.push(id);
        return { id, providerId: 'codex', messages: [] };
      }),
      updateConversation: jest.fn(async (id: string, updates: Record<string, unknown>) => {
        updated.push({ id, updates });
      }),
      getApplicationRuntimeOrNull: () => ({
        agents: { prepareAndDispatch },
        agentDispatcher,
      }),
    };
    const orchestratorTab = {
      id: 'orchestrator-tab',
      providerId: 'codex',
      lifecycleState: 'blank',
      draftSettings: { model: 'gpt-5.6-luna', effortLevel: 'high' },
      orchestratorMode: true,
      state: { currentConversationId: 'conv-orchestrator' },
      controllers: {
        streamController: orchestratorStreamController,
      },
    };
    view.tabManager = {
      getTab: jest.fn(() => orchestratorTab),
    };
    view.updateTabBar = jest.fn();
    view.persistTabState = jest.fn();

    return {
      agentDispatcher,
      created,
      orchestratorStreamController,
      orchestratorTab,
      prepareAndDispatch,
      updated,
      view,
    };
  }

  it('dispatches a durable agent per task of an approved plan', async () => {
    // **Workers are not tabs any more.** An approved plan used to spawn one
    // chat tab per task and type the prompt into it; each task is a dispatched
    // agent now, with its own conversation to run its turn in — because a
    // conversation runs one turn at a time — and the orchestrator's
    // conversation as its owner, so the background work card on the tab a
    // person is looking at lists what that tab started.
    const {
      created,
      orchestratorStreamController,
      orchestratorTab,
      prepareAndDispatch,
      updated,
      view,
    } = createOrchestratorHarness();
    const containerEl = createMockEl();

    view.wireOrchestratorCallbacks(orchestratorTab);
    const [onPlanDetected, isOrchestratorMode] = orchestratorStreamController
      .setOrchestratorCallbacks.mock.calls[0];

    expect(isOrchestratorMode()).toBe(true);

    onPlanDetected(containerEl, {
      type: 'parallel_worker_plan',
      tasks: [
        { id: 'research', description: 'Research implementation', prompt: 'Inspect the files' },
        { id: 'tests', description: 'Add regression tests', prompt: 'Write focused tests' },
      ],
    });

    containerEl.querySelector('.grimoire-orchestrator-plan-spawn-button')?.click();
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }

    expect(created).toEqual(['conv-worker-1', 'conv-worker-2']);
    // **The task text is written into the conversation, not into a record.** A
    // control record holds references and a prompt is free text somebody wrote,
    // so this is what the dispatcher reads the goal back from — including after
    // a reload, which is what makes a redispatch find the same task.
    expect(updated.map(entry => entry.updates.messages)).toEqual([
      [expect.objectContaining({ role: 'user', content: 'Inspect the files' })],
      [expect.objectContaining({ role: 'user', content: 'Write focused tests' })],
    ]);
    expect(prepareAndDispatch).toHaveBeenCalledTimes(2);
    expect(prepareAndDispatch.mock.calls[0][0]).toEqual(expect.objectContaining({
      providerId: 'codex',
      rootOwner: { kind: 'conversation', ownerId: 'conv-orchestrator' },
      conversationId: 'conv-worker-1',
      attachment: 'detached',
    }));
    expect(view.updateTabBar).toHaveBeenCalled();
    expect(view.persistTabState).toHaveBeenCalled();
  });

  it('dispatches nothing from a tab with no conversation to own the work', async () => {
    // A plan approved in a blank tab. Dispatching against a conversation that
    // does not exist would write runs nobody can find.
    const { orchestratorStreamController, orchestratorTab, prepareAndDispatch, view } =
      createOrchestratorHarness();
    orchestratorTab.state = { currentConversationId: null } as never;
    const containerEl = createMockEl();

    view.wireOrchestratorCallbacks(orchestratorTab);
    const [onPlanDetected] = orchestratorStreamController.setOrchestratorCallbacks.mock.calls[0];
    onPlanDetected(containerEl, {
      type: 'parallel_worker_plan',
      tasks: [{ id: 'a', description: 'A', prompt: 'Do the thing' }],
    });
    containerEl.querySelector('.grimoire-orchestrator-plan-spawn-button')?.click();
    for (let tick = 0; tick < 4; tick += 1) {
      await Promise.resolve();
    }

    expect(prepareAndDispatch).not.toHaveBeenCalled();
  });

  it('offers the plan callback to every tab, because none is a worker', () => {
    // The exclusion this replaces was real: a worker tab had to be refused a
    // plan callback or an approved plan could spawn its own fleet. There is no
    // worker tab to refuse.
    const { orchestratorStreamController, orchestratorTab, view } = createOrchestratorHarness();
    orchestratorTab.orchestratorMode = false;

    view.wireOrchestratorCallbacks(orchestratorTab);

    const [onPlanDetected, isOrchestratorMode] = orchestratorStreamController
      .setOrchestratorCallbacks.mock.calls[0];
    expect(onPlanDetected).toBeInstanceOf(Function);
    expect(isOrchestratorMode()).toBe(false);
  });
});
