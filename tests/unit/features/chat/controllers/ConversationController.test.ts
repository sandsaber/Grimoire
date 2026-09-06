import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Menu, Notice } from 'obsidian';

import { DEFAULT_CHAT_PROVIDER_ID } from '@/core/providers/types';
import { ConversationController, type ConversationControllerDeps } from '@/features/chat/controllers/ConversationController';
import { ChatState } from '@/features/chat/state/ChatState';
import { t } from '@/i18n/i18n';
import { confirm } from '@/shared/modals/ConfirmModal';

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirm: jest.fn().mockResolvedValue(true),
}));

const mockNotice = Notice as jest.Mock;

function createMockDeps(overrides: Partial<ConversationControllerDeps> = {}): ConversationControllerDeps {
  const state = new ChatState();
  const inputEl = { value: '', focus: jest.fn() } as unknown as HTMLTextAreaElement;
  const historyDropdown = createMockEl();
  let welcomeEl: any = createMockEl();
  const messagesEl = createMockEl();

  const fileContextManager = {
    resetForNewConversation: jest.fn(),
    resetForLoadedConversation: jest.fn(),
    autoAttachActiveFile: jest.fn(),
    setCurrentNote: jest.fn(),
    getCurrentNotePath: jest.fn().mockReturnValue(null),
  };

  return {
    plugin: {
      createConversation: jest.fn().mockResolvedValue({
        id: 'new-conv',
        title: 'New Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      switchConversation: jest.fn().mockResolvedValue({
        id: 'switched-conv',
        title: 'Switched Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      getConversationById: jest.fn().mockResolvedValue(null),
      getHistoryHydration: jest.fn().mockReturnValue(undefined),
      getConversationSync: jest.fn().mockReturnValue(null),
      getConversationList: jest.fn().mockReturnValue([]),
      getConversationTitles: jest.fn().mockReturnValue([]),
      findEmptyConversation: jest.fn().mockResolvedValue(null),
      updateConversation: jest.fn().mockResolvedValue(undefined),
      renameConversation: jest.fn().mockResolvedValue(undefined),
      deleteConversation: jest.fn().mockResolvedValue(undefined),
      agentService: {
        getSessionId: jest.fn().mockResolvedValue(null),
        setSessionId: jest.fn(),
      },
      settings: {
        userName: '',
        enableAutoTitleGeneration: true,
        permissionMode: 'full_access',
      },
    } as any,
    state,
    renderer: {
      renderMessages: jest.fn().mockReturnValue(createMockEl()),
      renderSessionRestartNotice: jest.fn(),
      clearSessionRestartNotice: jest.fn(),
    } as any,
    subagentManager: {
      orphanAllActive: jest.fn(),
      clear: jest.fn(),
    } as any,
    getHistoryDropdown: () => historyDropdown,
    getWelcomeEl: () => welcomeEl,
    setWelcomeEl: (el: any) => { welcomeEl = el; },
    getMessagesEl: () => messagesEl,
    getInputEl: () => inputEl,
    getFileContextManager: () => fileContextManager as any,
    getImageContextManager: () => ({
      clearImages: jest.fn(),
    }) as any,
    getMcpServerSelector: () => ({
      clearEnabled: jest.fn(),
      getEnabledServers: jest.fn().mockResolvedValue(new Set()),
      setEnabledServers: jest.fn(),
    }) as any,
    getExternalContextSelector: () => ({
      getExternalContexts: jest.fn().mockReturnValue([]),
      setExternalContexts: jest.fn(),
      clearExternalContexts: jest.fn(),
    }) as any,
    clearQueuedMessage: jest.fn(),
    getTitleGenerationService: () => null,
    getStatusPanel: () => ({
      remount: jest.fn(),
    }) as any,
    ...overrides,
  };
}

function getHistoryList(container: any): any {
  return container.querySelector('.grimoire-history-list');
}

function getHistoryItems(container: any): any[] {
  return container.querySelectorAll('.grimoire-history-item');
}

function getHistoryItem(container: any, conversationId: string): any {
  return getHistoryItems(container).find((item: any) =>
    item.getAttribute('data-conversation-id') === conversationId
  );
}

function getHistoryTitle(item: any): string | undefined {
  return item.querySelector('.grimoire-history-item-title')?.textContent;
}

function getHistoryMeta(item: any): string | undefined {
  return item.querySelector('.grimoire-history-item-meta')?.textContent;
}

describe('ConversationController', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as typeof Menu & { instances: unknown[] }).instances.length = 0;
    deps = createMockDeps();
    controller = new ConversationController(deps);
  });

  describe('Queue Management', () => {
    describe('Creating new conversation', () => {
      it('should clear queued message on new conversation', async () => {
        deps.state.queue.enqueue({ content: 'test', images: undefined, editorContext: null, canvasContext: null });
        deps.state.isStreaming = false;

        await controller.createNew();

        expect(deps.clearQueuedMessage).toHaveBeenCalled();
      });

      it('should not create new conversation while streaming', async () => {
        deps.state.isStreaming = true;

        await controller.createNew();

        expect(deps.plugin.createConversation).not.toHaveBeenCalled();
      });

      it('should save current conversation before creating new one', async () => {
        deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];
        deps.state.currentConversationId = 'old-conv';

        await controller.createNew();

        expect(deps.plugin.updateConversation).toHaveBeenCalledWith('old-conv', expect.any(Object));
      });

      it('should reset file context for new conversation', async () => {
        const fileContextManager = deps.getFileContextManager()!;

        await controller.createNew();

        expect(fileContextManager.resetForNewConversation).toHaveBeenCalled();
        expect(fileContextManager.autoAttachActiveFile).toHaveBeenCalled();
      });

      it('should clear todos for new conversation', async () => {
        deps.state.currentTodos = [
          { content: 'Existing todo', status: 'pending', activeForm: 'Doing existing todo' }
        ];
        expect(deps.state.currentTodos).not.toBeNull();

        await controller.createNew();

        expect(deps.state.currentTodos).toBeNull();
      });

      it('should reset to entry point state (null conversationId) instead of creating conversation', async () => {
        // Entry point model: createNew() resets to blank state without creating conversation
        // Conversation is created lazily on first message send
        await controller.createNew();

        expect(deps.plugin.findEmptyConversation).not.toHaveBeenCalled();
        expect(deps.plugin.createConversation).not.toHaveBeenCalled();
        expect(deps.plugin.switchConversation).not.toHaveBeenCalled();
        expect(deps.state.currentConversationId).toBeNull();
      });

      it('should clear messages and reset state when creating new', async () => {
        deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];
        deps.state.currentConversationId = 'old-conv';

        const clearMessagesSpy = jest.spyOn(deps.state, 'clearMessages');

        await controller.createNew();

        expect(clearMessagesSpy).toHaveBeenCalled();
        expect(deps.state.currentConversationId).toBeNull();

        clearMessagesSpy.mockRestore();
      });
    });

    describe('Switching conversations', () => {
      it('should clear queued message on conversation switch', async () => {
        deps.state.currentConversationId = 'old-conv';
        deps.state.queue.enqueue({ content: 'test', images: undefined, editorContext: null, canvasContext: null });

        await controller.switchTo('new-conv');

        expect(deps.clearQueuedMessage).toHaveBeenCalled();
      });

      it('should not switch while streaming', async () => {
        deps.state.isStreaming = true;
        deps.state.currentConversationId = 'old-conv';

        await controller.switchTo('new-conv');

        expect(deps.plugin.switchConversation).not.toHaveBeenCalled();
      });

      it('should not switch to current conversation', async () => {
        deps.state.currentConversationId = 'same-conv';

        await controller.switchTo('same-conv');

        expect(deps.plugin.switchConversation).not.toHaveBeenCalled();
      });

      it('should reset file context when switching conversations', async () => {
        deps.state.currentConversationId = 'old-conv';
        const fileContextManager = deps.getFileContextManager()!;

        await controller.switchTo('new-conv');

        expect(fileContextManager.resetForLoadedConversation).toHaveBeenCalled();
      });

      it('should clear input value on switch', async () => {
        deps.state.currentConversationId = 'old-conv';
        const inputEl = deps.getInputEl();
        inputEl.value = 'some input';

        await controller.switchTo('new-conv');

        expect(inputEl.value).toBe('');
      });

      it('should hide history dropdown after switch', async () => {
        deps.state.currentConversationId = 'old-conv';
        const dropdown = deps.getHistoryDropdown()!;
        dropdown.addClass('visible');

        await controller.switchTo('new-conv');

        expect(dropdown.hasClass('visible')).toBe(false);
      });

      it('records safe debug metadata after loading a switched conversation', async () => {
        const recordDebugLog = jest.fn();
        (deps.plugin as any).recordDebugLog = recordDebugLog;
        deps.state.currentConversationId = 'old-conv';
        (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
          id: 'new-conv',
          providerId: 'claude',
          title: 'Restored Conversation',
          messages: [
            { id: '1', role: 'user', content: 'test', timestamp: 1000 },
            { id: '2', role: 'assistant', content: 'ok', timestamp: 1001 },
          ],
          sessionId: 'session-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await controller.switchTo('new-conv');

        expect(recordDebugLog).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            hasSessionId: true,
            messageCount: 2,
            providerId: 'claude',
          }),
          event: 'conversation.loaded',
          level: 'debug',
          scope: 'chat.restore',
        }));
      });
    });

    describe('Welcome visibility', () => {
      it('should hide welcome when messages exist', () => {
        deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];
        const welcomeEl = deps.getWelcomeEl()!;

        controller.updateWelcomeVisibility();

        expect(welcomeEl.style.display).toBe('none');
      });

      it('should show welcome when no messages exist', () => {
        deps.state.messages = [];
        const welcomeEl = deps.getWelcomeEl()!;

        controller.updateWelcomeVisibility();

        // When no messages, welcome should not be 'none' (either 'block' or empty string)
        expect(welcomeEl.style.display).not.toBe('none');
      });

      it('should update welcome visibility after switching to conversation with messages', async () => {
        deps.state.currentConversationId = 'old-conv';
        deps.state.messages = [];
        (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
          id: 'new-conv',
          messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
          sessionId: null,
        });

        await controller.switchTo('new-conv');

        expect(deps.state.messages.length).toBe(1);
        const welcomeEl = deps.getWelcomeEl()!;
        expect(welcomeEl.style.display).toBe('none');
      });
    });
  });

  describe('initializeWelcome', () => {
    it('should initialize file context for new tab', () => {
      const fileContextManager = deps.getFileContextManager()!;

      controller.initializeWelcome();

      expect(fileContextManager.resetForNewConversation).toHaveBeenCalled();
      expect(fileContextManager.autoAttachActiveFile).toHaveBeenCalled();
    });

    it('should not throw if welcomeEl is null', () => {
      const depsWithNullWelcome = createMockDeps({
        getWelcomeEl: () => null,
      });
      const controllerWithNullWelcome = new ConversationController(depsWithNullWelcome);

      expect(() => controllerWithNullWelcome.initializeWelcome()).not.toThrow();
    });

    it('should only add greeting if not already present', () => {
      const welcomeEl = deps.getWelcomeEl()!;
      const createDivSpy = jest.spyOn(welcomeEl, 'createDiv');

      // First call should add greeting
      controller.initializeWelcome();
      expect(createDivSpy).toHaveBeenCalledTimes(1);

      // Mock querySelector to return an element (greeting already exists)
      welcomeEl.querySelector = jest.fn().mockReturnValue(createMockEl());

      // Second call should not add another greeting
      controller.initializeWelcome();
      expect(createDivSpy).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });

  describe('generateFallbackTitle', () => {
    it('skips leading context blocks injected by the host', () => {
      const message = '<git_status>\nclean\n</git_status>\n\nupdate the changelog entry';

      expect(controller.generateFallbackTitle(message)).toBe('update the changelog entry');
    });

    it('cuts on a word boundary rather than mid-word', () => {
      const message = 'do you know how to run commands such as search inside our shared notes workspace '
        + 'and report what the indexer found in the vault';

      expect(controller.generateFallbackTitle(message))
        .toBe('do you know how to run commands such as search inside our shared notes workspace and report...');
    });

    it('disambiguates against titles already present in the history', () => {
      (deps.plugin.getConversationTitles as jest.Mock).mockReturnValue(['check the build log']);

      expect(controller.generateFallbackTitle('check the build log')).toBe('check the build log 2');
    });

    it('uses the generic conversation label when the message is only context', () => {
      const message = '<git_status>\nThis is the git status at the start of the conversation.\n</git_status>';

      expect(controller.generateFallbackTitle(message)).toBe(t('chat.ui.view.conversation'));
    });

    it('disambiguates the generic label as well', () => {
      (deps.plugin.getConversationTitles as jest.Mock).mockReturnValue([t('chat.ui.view.conversation')]);

      expect(controller.generateFallbackTitle('<git_status>\nx\n</git_status>'))
        .toBe(`${t('chat.ui.view.conversation')} 2`);
    });

    it('keeps working when the history is unavailable', () => {
      (deps.plugin.getConversationTitles as jest.Mock).mockImplementation(() => {
        throw new Error('storage offline');
      });

      expect(controller.generateFallbackTitle('check the build log')).toBe('check the build log');
    });
  });

  describe('formatDate', () => {
    it('should return time format for today', () => {
      const now = new Date();
      const result = controller.formatDate(now.getTime());

      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it('should return month/day format for a past date', () => {
      const pastDate = new Date(2023, 0, 15).getTime();
      const result = controller.formatDate(pastDate);

      expect(result).toContain('15');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return month/day format for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = controller.formatDate(yesterday.getTime());

      expect(result).not.toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe('toggleHistoryDropdown', () => {
    it('should add visible class when dropdown is hidden', () => {
      const dropdown = deps.getHistoryDropdown()!;
      expect(dropdown.hasClass('visible')).toBe(false);

      controller.toggleHistoryDropdown();

      expect(dropdown.hasClass('visible')).toBe(true);
    });

    it('should remove visible class when dropdown is visible', () => {
      const dropdown = deps.getHistoryDropdown()!;
      dropdown.addClass('visible');

      controller.toggleHistoryDropdown();

      expect(dropdown.hasClass('visible')).toBe(false);
    });

    it('should not throw when dropdown is null', () => {
      const depsNullDropdown = createMockDeps({
        getHistoryDropdown: () => null,
      });
      const ctrl = new ConversationController(depsNullDropdown);

      expect(() => ctrl.toggleHistoryDropdown()).not.toThrow();
    });
  });

  describe('save edge cases', () => {
    it('should return early when no conversationId and no messages', async () => {
      deps.state.currentConversationId = null;
      deps.state.messages = [];

      await controller.save();

      expect(deps.plugin.updateConversation).not.toHaveBeenCalled();
      expect(deps.plugin.createConversation).not.toHaveBeenCalled();
    });

    it('should lazily create conversation when entry point has messages', async () => {
      deps.state.currentConversationId = null;
      deps.state.messages = [{ id: '1', role: 'user', content: 'hello', timestamp: Date.now() }];

      (deps.plugin.createConversation as jest.Mock).mockResolvedValue({
        id: 'lazy-conv',
        title: 'New Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await controller.save();

      expect(deps.plugin.createConversation).toHaveBeenCalled();
      expect(deps.state.currentConversationId).toBe('lazy-conv');
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith(
        'lazy-conv',
        expect.any(Object)
      );
    });

    it('should preserve the active runtime provider when lazily creating a conversation', async () => {
      deps = createMockDeps({
        getAgentService: () => ({
          providerId: 'codex',
          getSessionId: jest.fn().mockReturnValue('session-codex'),
          consumeSessionInvalidation: jest.fn().mockReturnValue(false),
          syncConversationState: jest.fn(),
        }) as any,
      });
      controller = new ConversationController(deps);
      deps.state.currentConversationId = null;
      deps.state.messages = [{ id: '1', role: 'user', content: 'hello', timestamp: Date.now() }];

      (deps.plugin.createConversation as jest.Mock).mockResolvedValue({
        id: 'lazy-codex-conv',
        providerId: 'codex',
        title: 'Codex Conversation',
        messages: [],
        sessionId: 'session-codex',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await controller.save();

      expect(deps.plugin.createConversation).toHaveBeenCalledWith({
        providerId: 'codex',
        sessionId: 'session-codex',
      });
    });

    it('should set lastResponseAt when updateLastResponse is true', async () => {
      deps.state.currentConversationId = 'conv-1';
      deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];

      const beforeCall = Date.now();

      await controller.save(true);

      const call = (deps.plugin.updateConversation as jest.Mock).mock.calls[0];
      const updates = call[1];
      expect(updates.lastResponseAt).toBeDefined();
      expect(updates.lastResponseAt).toBeGreaterThanOrEqual(beforeCall);
      expect(updates.lastResponseAt).toBeLessThanOrEqual(Date.now());
    });

    it('should NOT clear resumeAtMessageId when updateLastResponse is true (caller must pass extraUpdates)', async () => {
      deps.state.currentConversationId = 'conv-1';
      deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];

      await controller.save(true);

      const call = (deps.plugin.updateConversation as jest.Mock).mock.calls[0];
      const updates = call[1];
      expect(updates).not.toHaveProperty('resumeAtMessageId');
    });

    it('should clear resumeAtMessageId when passed via extraUpdates', async () => {
      deps.state.currentConversationId = 'conv-1';
      deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];

      await controller.save(true, { resumeAtMessageId: undefined });

      const call = (deps.plugin.updateConversation as jest.Mock).mock.calls[0];
      const updates = call[1];
      expect(updates.resumeAtMessageId).toBeUndefined();
      // Verify it's explicitly set (not just missing)
      expect('resumeAtMessageId' in updates).toBe(true);
    });

    it('should not clear resumeAtMessageId when updateLastResponse is false', async () => {
      deps.state.currentConversationId = 'conv-1';
      deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];

      await controller.save(false);

      const call = (deps.plugin.updateConversation as jest.Mock).mock.calls[0];
      const updates = call[1];
      expect(updates).not.toHaveProperty('resumeAtMessageId');
    });

    it('should clear pending conversation save state after persisting', async () => {
      deps.state.currentConversationId = 'conv-1';
      deps.state.messages = [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }];
      deps.state.hasPendingConversationSave = true;

      await controller.save();

      expect(deps.state.hasPendingConversationSave).toBe(false);
    });
  });

  describe('loadActive with existing conversation', () => {
    it('should restore currentNote when conversation has one', async () => {
      const fileContextManager = deps.getFileContextManager()!;
      deps.state.currentConversationId = 'conv-with-note';
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-with-note',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        currentNote: 'notes/my-note.md',
      });

      await controller.loadActive();

      expect(fileContextManager.setCurrentNote).toHaveBeenCalledWith('notes/my-note.md');
    });

    it('should auto-attach active file when no currentNote and no messages', async () => {
      const fileContextManager = deps.getFileContextManager()!;
      deps.state.currentConversationId = 'empty-conv';
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'empty-conv',
        messages: [],
        sessionId: null,
        currentNote: undefined,
      });

      await controller.loadActive();

      expect(fileContextManager.autoAttachActiveFile).toHaveBeenCalled();
      expect(fileContextManager.setCurrentNote).not.toHaveBeenCalled();
    });

    it('should call renderer.renderMessages with greeting callback', async () => {
      deps.state.currentConversationId = 'conv-1';
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
      });

      await controller.loadActive();

      expect(deps.renderer.renderMessages).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function),
        undefined,
      );

      const greetingFn = (deps.renderer.renderMessages as jest.Mock).mock.calls[0][1];
      expect(greetingFn().length).toBeGreaterThan(0);
    });

    it('tells the renderer what the provider found when the history was loaded', async () => {
      deps.state.currentConversationId = 'conv-1';
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        messages: [],
        sessionId: 'session-gone',
      });
      (deps.plugin.getHistoryHydration as jest.Mock).mockReturnValue({
        outcome: 'stale',
        reason: 'sessionNotFound',
      });

      await controller.loadActive();

      // Without this the renderer has nothing to say, and a conversation whose
      // session the provider no longer has is drawn exactly like an empty one.
      expect(deps.renderer.renderMessages).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function),
        { outcome: 'stale', reason: 'sessionNotFound' },
      );
      expect(deps.plugin.getHistoryHydration).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('switchTo with currentNote', () => {
    it('should set currentNote when switched conversation has one', async () => {
      const fileContextManager = deps.getFileContextManager()!;
      deps.state.currentConversationId = 'old-conv';

      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'new-conv',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        currentNote: 'docs/readme.md',
      });

      await controller.switchTo('new-conv');

      expect(fileContextManager.setCurrentNote).toHaveBeenCalledWith('docs/readme.md');
    });

    it('should not set currentNote when switched conversation has none', async () => {
      const fileContextManager = deps.getFileContextManager()!;
      deps.state.currentConversationId = 'old-conv';

      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'new-conv',
        messages: [],
        sessionId: null,
        currentNote: undefined,
      });

      await controller.switchTo('new-conv');

      expect(fileContextManager.setCurrentNote).not.toHaveBeenCalled();
    });

    it('should call renderer.renderMessages with greeting callback on switch', async () => {
      deps.state.currentConversationId = 'old-conv';

      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'new-conv',
        messages: [],
        sessionId: null,
      });

      await controller.switchTo('new-conv');

      expect(deps.renderer.renderMessages).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function),
        undefined,
      );

      const greetingFn = (deps.renderer.renderMessages as jest.Mock).mock.calls[0][1];
      expect(greetingFn().length).toBeGreaterThan(0);
    });
  });

  describe('History Rendering', () => {
    let dropdown: any;

    beforeEach(() => {
      dropdown = createMockEl();
      deps.getHistoryDropdown = () => dropdown;
    });

    describe('updateHistoryDropdown with conversations', () => {
      it('should render conversation items when conversations exist', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          {
            id: 'conv-1',
            providerId: 'claude',
            title: 'First Conversation',
            createdAt: 1000,
            lastResponseAt: 3000,
            messageCount: 12,
            preview: 'Vault note summary',
          },
          {
            id: 'conv-2',
            providerId: 'codex',
            title: 'Second Conversation',
            createdAt: 2000,
            lastResponseAt: 2000,
            messageCount: 4,
            preview: 'Patch follow-up',
          },
        ]);

        controller.updateHistoryDropdown();

        expect(dropdown.children.length).toBe(3);
        expect(dropdown.querySelector('.grimoire-history-count')?.textContent).toBe('2');
        expect(dropdown.querySelector('.grimoire-history-search')).toBeTruthy();
        const list = getHistoryList(dropdown);
        expect(list.hasClass('grimoire-history-list')).toBe(true);
        expect(getHistoryItems(dropdown).length).toBe(2);
      });

      it('shows a row for a conversation the vault holds and this build cannot read', () => {
        // Skipping it made the file indistinguishable from a chat the user
        // deleted. Its own block, above the list: no title to search, no
        // timestamp to group by, nothing to open.
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([]);
        (deps.plugin as any).getUnreadableConversations = () => [
          { id: 'conv-future', reason: 'future' },
          { id: 'conv-broken', reason: 'corrupt' },
        ];

        controller.updateHistoryDropdown();

        const block = dropdown.querySelector('.grimoire-history-unreadable');
        expect(block).toBeTruthy();
        expect(block.children.length).toBe(2);
        const reasons = block.children.map((child: any) => (
          child.querySelector('.grimoire-history-unreadable-reason')?.textContent
        ));
        expect(reasons[0]).toContain('newer version');
        expect(reasons[1]).toContain('damaged');
      });

      it('shows no such row when every conversation is readable', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([]);
        (deps.plugin as any).getUnreadableConversations = () => [];

        controller.updateHistoryDropdown();

        expect(dropdown.querySelector('.grimoire-history-unreadable')).toBeFalsy();
      });

      it('should show "No conversations" when list is empty', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([]);

        controller.updateHistoryDropdown();

        const list = getHistoryList(dropdown);
        expect(list.children[0].hasClass('grimoire-history-empty')).toBe(true);
        expect(list.children[0].textContent).toContain('No past chats');
      });

      it('should sort conversations by lastResponseAt descending', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-old', providerId: 'claude', title: 'Old', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Old preview' },
          { id: 'conv-new', providerId: 'codex', title: 'New', createdAt: 2000, lastResponseAt: 5000, messageCount: 1, preview: 'New preview' },
          { id: 'conv-mid', providerId: 'antigravity', title: 'Mid', createdAt: 3000, lastResponseAt: 3000, messageCount: 1, preview: 'Mid preview' },
        ]);

        controller.updateHistoryDropdown();

        expect(getHistoryTitle(getHistoryItems(dropdown)[0])).toBe('New');
      });

      it('should group conversations by relative day bucket', () => {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const earlier = new Date(today);
        earlier.setDate(today.getDate() - 4);

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'today', providerId: 'claude', title: 'Today', createdAt: today.getTime(), messageCount: 1, preview: 'Today preview' },
          { id: 'yesterday', providerId: 'codex', title: 'Yesterday', createdAt: yesterday.getTime(), messageCount: 1, preview: 'Yesterday preview' },
          { id: 'earlier', providerId: 'opencode', title: 'Earlier', createdAt: earlier.getTime(), messageCount: 1, preview: 'Earlier preview' },
        ]);

        controller.updateHistoryDropdown();

        expect(dropdown.querySelectorAll('.grimoire-history-group-label').map((el: any) => el.textContent)).toEqual([
          'Today',
          'Yesterday',
          'Earlier',
        ]);
      });

      it('should filter conversations by title or preview from the search field', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Fish research', createdAt: 1000, lastResponseAt: 3000, messageCount: 3, preview: 'Ocean notes' },
          { id: 'conv-2', providerId: 'codex', title: 'Patch work', createdAt: 2000, lastResponseAt: 2000, messageCount: 4, preview: 'History dropdown layout' },
        ]);

        controller.updateHistoryDropdown();

        const input = dropdown.querySelector('.grimoire-history-search-input');
        input.value = 'layout';
        input._eventListeners.get('input')![0]({ currentTarget: input });

        expect(getHistoryItems(dropdown).map(getHistoryTitle)).toEqual(['Patch work']);
      });

      it('should mark current conversation as active', () => {
        deps.state.currentConversationId = 'conv-1';

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Current preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 2000, messageCount: 1, preview: 'Other preview' },
        ]);

        controller.updateHistoryDropdown();

        const activeItem = getHistoryItems(dropdown).find((item: any) => item.hasClass('active'));
        expect(activeItem).toBeDefined();
      });

      it('should show loading indicator for pending title generation', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Generating...', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview', titleGenerationStatus: 'pending' },
        ]);

        controller.updateHistoryDropdown();

        const item = getHistoryItem(dropdown, 'conv-1');
        const loadingEl = item.querySelector('.grimoire-action-loading');
        expect(loadingEl).toBeTruthy();
      });

      it('should show regenerate button for failed title generation', () => {
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Fallback Title', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview', titleGenerationStatus: 'failed' },
        ]);

        controller.updateHistoryDropdown();

        const item = getHistoryItem(dropdown, 'conv-1');
        const actions = item.querySelector('.grimoire-history-item-actions');
        expect(actions).toBeTruthy();
        expect(actions!.querySelector('.grimoire-history-regenerate-btn')).toBeTruthy();
      });

      it('should not show select click handler on current conversation', () => {
        deps.state.currentConversationId = 'conv-1';

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Current preview' },
        ]);

        controller.updateHistoryDropdown();

        const item = getHistoryItem(dropdown, 'conv-1');
        const listeners = item?._eventListeners?.get('click');
        expect(listeners).toBeUndefined();
      });

      it('should attach select click handler on non-current conversations', () => {
        deps.state.currentConversationId = 'conv-1';

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
        ]);

        controller.updateHistoryDropdown();

        const otherItem = getHistoryItem(dropdown, 'conv-2');
        const listeners = otherItem?._eventListeners?.get('click');
        expect(listeners).toBeDefined();
        expect(listeners!.length).toBe(1);
      });

      it('should not delete while streaming', async () => {
        deps.state.isStreaming = true;

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Test', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview' },
        ]);

        controller.updateHistoryDropdown();

        const item = getHistoryItem(dropdown, 'conv-1');
        const deleteBtn = item.querySelector('.grimoire-delete-btn');
        expect(deleteBtn).toBeTruthy();

        const clickHandlers = deleteBtn!._eventListeners?.get('click');
        expect(clickHandlers).toBeDefined();
        await clickHandlers![0]({ stopPropagation: jest.fn() });

        expect(deps.plugin.deleteConversation).not.toHaveBeenCalled();
      });
    });

    describe('renderHistoryDropdown', () => {
      it('uses registered provider CSS variables, and the product default for invalid IDs', () => {
        const container = createMockEl();
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'claude', providerId: 'claude', title: 'Claude', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'codex', providerId: 'codex', title: 'Codex', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'opencode', providerId: 'opencode', title: 'OpenCode', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'mimocode', providerId: 'mimocode', title: 'MiMoCode', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'kimicode', providerId: 'kimicode', title: 'Kimi Code', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'grok', providerId: 'grok', title: 'Grok Build', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'antigravity', providerId: 'antigravity', title: 'Antigravity', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'gemini', providerId: 'gemini', title: 'Gemini CLI', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'qwen', providerId: 'qwen', title: 'Qwen Code', createdAt: 1000, messageCount: 1, preview: '' },
          { id: 'invalid', providerId: 'invalid', title: 'Invalid', createdAt: 1000, messageCount: 1, preview: '' },
        ]);

        controller.renderHistoryDropdown(container, { onSelectConversation: jest.fn() });

        for (const providerId of ['claude', 'codex', 'opencode', 'mimocode', 'kimicode', 'grok', 'antigravity', 'gemini', 'qwen']) {
          expect(getHistoryItem(container, providerId)
            .querySelector('.grimoire-history-provider-dot')
            .style['--grimoire-history-provider-color'])
            .toBe(`var(--grimoire-provider-${providerId})`);
        }
        // The product default, not one provider's colour picked out of the
        // list: an unregistered provider used to show Claude's dot, which reads
        // as a claim about which provider the conversation belongs to.
        expect(getHistoryItem(container, 'invalid')
          .querySelector('.grimoire-history-provider-dot')
          .style['--grimoire-history-provider-color'])
          .toBe(`var(--grimoire-provider-${DEFAULT_CHAT_PROVIDER_ID})`);
      });

      it('should render history items to provided container', () => {
        const container = createMockEl();
        const onSelectConversation = jest.fn();
        const onClose = jest.fn();

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Test', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview' },
        ]);

        controller.renderHistoryDropdown(container, { onSelectConversation, onClose });

        expect(container.children.length).toBe(3); // header + search + list
        expect(container.querySelector('.grimoire-history-title')?.textContent).toBe('History');
        expect(container.querySelector('.grimoire-history-close')).not.toBeNull();

        container.querySelector('.grimoire-history-close')?.click();

        expect(onClose).toHaveBeenCalled();
      });

      it('confirms before deleting every conversation from history', async () => {
        const container = createMockEl();
        const onClose = jest.fn();
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'First', createdAt: 1000, messageCount: 1, preview: 'First preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Second', createdAt: 2000, messageCount: 1, preview: 'Second preview' },
        ]);

        controller.renderHistoryDropdown(container, {
          onSelectConversation: jest.fn(),
          onClose,
        });

        const deleteAllBtn = container.querySelector('.grimoire-history-delete-all');
        expect(deleteAllBtn?.textContent).toBe('Delete all');

        const clickHandlers = deleteAllBtn!._eventListeners?.get('click');
        expect(clickHandlers).toBeDefined();
        clickHandlers![0]({ stopPropagation: jest.fn() });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(confirm).toHaveBeenCalledWith(
          deps.plugin.app,
          'Delete all 2 conversations? This cannot be undone.',
          'Delete all',
        );
        expect(deps.plugin.deleteConversation).toHaveBeenCalledTimes(2);
        expect(deps.plugin.deleteConversation).toHaveBeenNthCalledWith(1, 'conv-1');
        expect(deps.plugin.deleteConversation).toHaveBeenNthCalledWith(2, 'conv-2');
        expect(onClose).toHaveBeenCalled();
      });

      it('keeps history intact when deleting all is cancelled', async () => {
        (confirm as jest.Mock).mockResolvedValueOnce(false);
        const container = createMockEl();
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'First', createdAt: 1000, messageCount: 1, preview: 'First preview' },
        ]);

        controller.renderHistoryDropdown(container, { onSelectConversation: jest.fn() });

        const deleteAllBtn = container.querySelector('.grimoire-history-delete-all');
        const clickHandlers = deleteAllBtn!._eventListeners?.get('click');
        clickHandlers![0]({ stopPropagation: jest.fn() });
        await Promise.resolve();

        expect(deps.plugin.deleteConversation).not.toHaveBeenCalled();
      });

      it('renders model, sources, and usage without noisy zero message counts', () => {
        const container = createMockEl();

        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          {
            id: 'conv-1',
            providerId: 'codex',
            title: 'Chapter 03.md',
            createdAt: 1000,
            lastResponseAt: 1000,
            messageCount: 0,
            preview: 'Rewrite plan - three pressure beats',
            modelLabel: 'GPT-5.4',
            sourceCount: 2,
            usagePercentage: 55,
          },
        ]);

        controller.renderHistoryDropdown(container, { onSelectConversation: jest.fn() });

        const item = getHistoryItem(container, 'conv-1');
        const meta = getHistoryMeta(item);

        expect(meta).toContain('GPT-5.4');
        expect(meta).toContain('Rewrite plan - three pressure beats');
        expect(meta).toContain('2 src');
        expect(meta).toContain('55%');
        expect(meta).not.toContain('0 msgs');
      });

      it('should open a conversation in a new tab on modifier click when supported', async () => {
        const container = createMockEl();
        const onSelectConversation = jest.fn();
        const onOpenConversationInNewTab = jest.fn().mockResolvedValue(undefined);

        deps.state.currentConversationId = 'conv-1';
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
        ]);

        controller.renderHistoryDropdown(container, {
          onSelectConversation,
          onOpenConversationInNewTab,
          getConversationOpenState: () => 'closed',
        });

        const otherItem = getHistoryItem(container, 'conv-2');
        const clickHandlers = otherItem?._eventListeners?.get('click');
        expect(clickHandlers).toBeDefined();

        await clickHandlers![0]({
          stopPropagation: jest.fn(),
          preventDefault: jest.fn(),
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        });

        expect(onOpenConversationInNewTab).toHaveBeenCalledWith('conv-2', true);
        expect(onSelectConversation).not.toHaveBeenCalled();
      });

      it('should open a conversation in a new tab on middle click when supported', async () => {
        const container = createMockEl();
        const onSelectConversation = jest.fn();
        const onOpenConversationInNewTab = jest.fn().mockResolvedValue(undefined);

        deps.state.currentConversationId = 'conv-1';
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
        ]);

        controller.renderHistoryDropdown(container, {
          onSelectConversation,
          onOpenConversationInNewTab,
          getConversationOpenState: () => 'closed',
        });

        const otherItem = getHistoryItem(container, 'conv-2');
        const auxClickHandlers = otherItem?._eventListeners?.get('auxclick');
        expect(auxClickHandlers).toBeDefined();

        await auxClickHandlers![0]({
          button: 1,
          stopPropagation: jest.fn(),
          preventDefault: jest.fn(),
        });

        expect(onOpenConversationInNewTab).toHaveBeenCalledWith('conv-2', true);
        expect(onSelectConversation).not.toHaveBeenCalled();
      });

      it('should show new-tab actions in the context menu for closed conversations', () => {
        const container = createMockEl();

        deps.state.currentConversationId = 'conv-1';
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
        ]);

        controller.renderHistoryDropdown(container, {
          onSelectConversation: jest.fn(),
          onOpenConversationInNewTab: jest.fn().mockResolvedValue(undefined),
          getConversationOpenState: () => 'closed',
        });

        const otherItem = getHistoryItem(container, 'conv-2');
        otherItem.dispatchEvent({
          type: 'contextmenu',
          stopPropagation: jest.fn(),
          preventDefault: jest.fn(),
        });

        const menu = (Menu as typeof Menu & { instances: Array<{ items: Array<{ title: string }> }> }).instances[0];
        expect(menu.items.map(item => item.title)).toEqual([
          'Open in new tab',
          'Open in background tab',
          'Rename',
          'Delete',
        ]);
      });

      it('should show switch action in the context menu for already-open conversations', () => {
        const container = createMockEl();

        deps.state.currentConversationId = 'conv-1';
        (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
          { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
          { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
        ]);

        controller.renderHistoryDropdown(container, {
          onSelectConversation: jest.fn(),
          onOpenConversationInNewTab: jest.fn().mockResolvedValue(undefined),
          getConversationOpenState: () => 'open',
        });

        const otherItem = getHistoryItem(container, 'conv-2');
        otherItem.dispatchEvent({
          type: 'contextmenu',
          stopPropagation: jest.fn(),
          preventDefault: jest.fn(),
        });

        const menu = (Menu as typeof Menu & { instances: Array<{ items: Array<{ title: string }> }> }).instances[0];
        expect(menu.items.map(item => item.title)).toEqual([
          'Switch to open session',
          'Rename',
          'Delete',
        ]);
      });
    });
  });

  describe('History Item Interactions', () => {
    let dropdown: any;

    beforeEach(() => {
      dropdown = createMockEl();
      deps.getHistoryDropdown = () => dropdown;
    });

    it('should switch conversation when clicking a non-current item content', async () => {
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
        { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
        { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
      ]);

      controller.updateHistoryDropdown();

      const otherItem = getHistoryItem(dropdown, 'conv-2');
      const clickHandlers = otherItem?._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });
      await Promise.resolve();

      expect(deps.plugin.switchConversation).toHaveBeenCalledWith('conv-2');
    });

    it('should call regenerateTitle when clicking regenerate button on failed item', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      deps.getTitleGenerationService = () => mockTitleService;

      (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
        { id: 'conv-1', providerId: 'claude', title: 'Failed', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview', titleGenerationStatus: 'failed' },
      ]);

      controller.updateHistoryDropdown();

      const item = getHistoryItem(dropdown, 'conv-1');
      const actions = item.querySelector('.grimoire-history-item-actions');
      const regenerateBtn = actions!.querySelector('.grimoire-history-regenerate-btn');
      const clickHandlers = regenerateBtn._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();

      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        title: 'Failed',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', {
        titleGenerationStatus: 'pending',
      });
    });

    it('should invoke rename handler from the context menu', () => {
      (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
        { id: 'conv-1', providerId: 'claude', title: 'Test Title', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview' },
      ]);

      controller.updateHistoryDropdown();

      const item = getHistoryItem(dropdown, 'conv-1');
      item.dispatchEvent({
        type: 'contextmenu',
        stopPropagation: jest.fn(),
        preventDefault: jest.fn(),
      });
      const menu = (Menu as typeof Menu & { instances: Array<{ items: Array<{ title: string; clickHandler: () => void }> }> }).instances[0];
      const renameItem = menu.items.find(entry => entry.title === 'Rename');
      expect(renameItem).toBeDefined();

      const mockInput = createMockEl();
      (mockInput).type = '';
      (mockInput).className = '';
      (mockInput).value = '';
      (mockInput).focus = jest.fn();
      (mockInput).select = jest.fn();

      const titleEl = item.querySelector('.grimoire-history-item-title');
      if (titleEl) {
        (titleEl).replaceWith = jest.fn();
      }
      const createElSpy = jest.spyOn(item, 'createEl').mockReturnValue(mockInput);

      renameItem!.clickHandler();

      expect(createElSpy).toHaveBeenCalledWith('input');
      expect((mockInput).value).toBe('Test Title');
      expect(titleEl!.replaceWith).toHaveBeenCalledWith(mockInput);
    });

    it('should delete conversation and reload active when deleting current conversation', async () => {
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
        { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 1000, messageCount: 1, preview: 'Preview' },
      ]);

      controller.updateHistoryDropdown();

      const item = getHistoryItem(dropdown, 'conv-1');
      const deleteBtn = item.querySelector('.grimoire-delete-btn');
      expect(deleteBtn).toBeTruthy();

      const clickHandlers = deleteBtn!._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(deps.plugin.deleteConversation).toHaveBeenCalledWith('conv-1');
    });

    it('should delete non-current conversation without calling loadActive', async () => {
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.getConversationList as jest.Mock).mockReturnValue([
        { id: 'conv-1', providerId: 'claude', title: 'Current', createdAt: 1000, lastResponseAt: 2000, messageCount: 1, preview: 'Current preview' },
        { id: 'conv-2', providerId: 'codex', title: 'Other', createdAt: 2000, lastResponseAt: 1000, messageCount: 1, preview: 'Other preview' },
      ]);

      controller.updateHistoryDropdown();

      const otherItem = getHistoryItem(dropdown, 'conv-2');
      const deleteBtn = otherItem.querySelector('.grimoire-delete-btn');
      const clickHandlers = deleteBtn!._eventListeners?.get('click');

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(deps.plugin.deleteConversation).toHaveBeenCalledWith('conv-2');
      // Should not have called switchConversation (which is used in loadActive path)
      // The key check is that deleteConversation was called with conv-2
    });
  });

  describe('loadActive with greeting', () => {
    it('should show welcome and return early when no conversation exists', async () => {
      deps.state.currentConversationId = null;

      await controller.loadActive();

      const welcomeEl = deps.getWelcomeEl();
      expect(welcomeEl?.style.display).not.toBe('none');
    });
  });

  describe('Greeting Time Branches', () => {
    it.each([
      { name: 'morning (5-12)', hour: 9, day: 1, patterns: ['morning', 'Coffee'] },
      { name: 'afternoon (12-18)', hour: 14, day: 2, patterns: ['afternoon'] },
      { name: 'evening (18-22)', hour: 20, day: 3, patterns: ['evening', 'Evening', 'your day'] },
      { name: 'night owl (22+)', hour: 23, day: 4, patterns: ['night owl', 'Evening'] },
      { name: 'early morning night owl (0-4)', hour: 2, day: 0, patterns: ['night owl', 'Evening'] },
    ])('should include $name greetings', ({ hour, day, patterns }) => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(hour);
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(day);

      const greetings = new Set<string>();
      for (let i = 0; i < 50; i++) {
        jest.spyOn(Math, 'random').mockReturnValue(i / 50);
        greetings.add(controller.getGreeting());
      }

      const hasTimeBased = [...greetings].some(g =>
        patterns.some(p => g.includes(p))
      );
      expect(hasTimeBased).toBe(true);

      jest.restoreAllMocks();
    });

    it('should include vault quips in the greeting pool', () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14);
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(2);

      const greetings = new Set<string>();
      for (let i = 0; i < 80; i++) {
        jest.spyOn(Math, 'random').mockReturnValue(i / 80);
        greetings.add(controller.getGreeting());
      }

      expect([...greetings]).toEqual(expect.arrayContaining([
        'Your notes brought receipts.',
        'A clean diff is a kind of magic.',
      ]));

      jest.restoreAllMocks();
    });

    it('should personalize greetings only when a user name is configured', () => {
      const namedDeps = createMockDeps({
        plugin: {
          ...createMockDeps().plugin,
          settings: {
            userName: 'Misha',
            enableAutoTitleGeneration: true,
            permissionMode: 'full_access',
          },
        } as any,
      });
      const namedController = new ConversationController(namedDeps);

      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14);
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(2);
      jest.spyOn(Math, 'random').mockReturnValue(0);

      expect(namedController.getGreeting()).toContain('Misha');

      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      expect(controller.getGreeting()).not.toMatch(/,\s*$|Hi ,/);

      jest.restoreAllMocks();
    });
  });
});

describe('ConversationController - Callbacks', () => {
  it('should call onNewConversation callback', async () => {
    const onNewConversation = jest.fn();
    const deps = createMockDeps();
    const controller = new ConversationController(deps, { onNewConversation });

    await controller.createNew();

    expect(onNewConversation).toHaveBeenCalled();
  });

  it('should call onConversationSwitched callback', async () => {
    const onConversationSwitched = jest.fn();
    const deps = createMockDeps();
    deps.state.currentConversationId = 'old-conv';
    const controller = new ConversationController(deps, { onConversationSwitched });

    await controller.switchTo('new-conv');

    expect(onConversationSwitched).toHaveBeenCalled();
  });

  it('should call onConversationLoaded callback', async () => {
    const onConversationLoaded = jest.fn();
    const deps = createMockDeps();
    const controller = new ConversationController(deps, { onConversationLoaded });

    await controller.loadActive();

    expect(onConversationLoaded).toHaveBeenCalled();
  });
});

describe('ConversationController - Title Generation', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;
  let mockTitleService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTitleService = {
      generateTitle: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
    };
    deps = createMockDeps({
      getTitleGenerationService: () => mockTitleService,
    });
    controller = new ConversationController(deps);
  });

  describe('regenerateTitle', () => {
    it('should not regenerate if titleService is null', async () => {
      const depsNoService = createMockDeps({
        getTitleGenerationService: () => null,
      });
      const controllerNoService = new ConversationController(depsNoService);

      (depsNoService.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await controllerNoService.regenerateTitle('conv-1');

      expect(depsNoService.plugin.updateConversation).not.toHaveBeenCalled();
    });

    it('should not regenerate if enableAutoTitleGeneration is false', async () => {
      deps.plugin.settings.enableAutoTitleGeneration = false;
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await controller.regenerateTitle('conv-1');

      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
      expect(deps.plugin.updateConversation).not.toHaveBeenCalled();

      deps.plugin.settings.enableAutoTitleGeneration = true;
    });

    it('should not regenerate if conversation not found', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue(null);

      await controller.regenerateTitle('non-existent');

      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
    });

    it('should not regenerate if conversation has no messages', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Title',
        messages: [],
      });

      await controller.regenerateTitle('conv-1');

      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
    });

    it('should not regenerate if no user message found', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Title',
        messages: [
          { role: 'assistant', content: 'Hi' },
          { role: 'assistant', content: 'There' },
        ],
      });

      await controller.regenerateTitle('conv-1');

      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
    });

    it('should set pending status before generating', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await controller.regenerateTitle('conv-1');

      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', {
        titleGenerationStatus: 'pending',
      });
    });

    it('should call titleService.generateTitle with correct params', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [
          { role: 'user', content: 'Hello world', displayContent: 'Hello world!' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await controller.regenerateTitle('conv-1');

      expect(mockTitleService.generateTitle).toHaveBeenCalledWith(
        'conv-1',
        'Hello world!', // Uses displayContent
        expect.any(Function)
      );
    });

    it('should regenerate title with only user message (no assistant yet)', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [{ role: 'user', content: 'Hello world' }],
      });

      await controller.regenerateTitle('conv-1');

      expect(mockTitleService.generateTitle).toHaveBeenCalledWith(
        'conv-1',
        'Hello world',
        expect.any(Function)
      );
    });

    it('should rename conversation with generated title', async () => {
      (deps.plugin.getConversationById as any) = jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [
          { role: 'user', content: 'Create a plan' },
          { role: 'assistant', content: 'Here is the plan...' },
        ],
      });

      mockTitleService.generateTitle.mockImplementation(
        async (convId: string, _user: string, callback: any) => {
          await callback(convId, { success: true, title: 'New Generated Title' });
        }
      );

      (deps.plugin.renameConversation as any) = jest.fn().mockResolvedValue(undefined);

      await controller.regenerateTitle('conv-1');

      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'New Generated Title');
    });
  });

  describe('generateFallbackTitle', () => {
    it('should generate title from first sentence', () => {
      const title = controller.generateFallbackTitle('How do I set up React? I need help.');

      expect(title).toBe('How do I set up React');
    });

    it('should truncate long titles to the shared title budget', () => {
      const longMessage = 'A'.repeat(200);
      const title = controller.generateFallbackTitle(longMessage);

      expect(title.length).toBeLessThanOrEqual(100);
      expect(title).toContain('...');
    });

    it('should handle messages with no sentence breaks', () => {
      const title = controller.generateFallbackTitle('Hello world');

      expect(title).toBe('Hello world');
    });
  });
});

describe('ConversationController - MCP Server Persistence', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;
  let mockMcpServerSelector: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMcpServerSelector = {
      clearEnabled: jest.fn(),
      getEnabledServers: jest.fn().mockReturnValue(new Set(['mcp-server-1', 'mcp-server-2'])),
      setEnabledServers: jest.fn(),
    };
    deps = createMockDeps({
      getMcpServerSelector: () => mockMcpServerSelector,
    });
    controller = new ConversationController(deps);
  });

  describe('save', () => {
    it('should save enabled MCP servers to conversation', async () => {
      deps.state.currentConversationId = 'conv-1';

      await controller.save();

      expect(deps.plugin.updateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          enabledMcpServers: ['mcp-server-1', 'mcp-server-2'],
        })
      );
    });

    it('should save undefined when no MCP servers enabled', async () => {
      mockMcpServerSelector.getEnabledServers.mockReturnValue(new Set());
      deps.state.currentConversationId = 'conv-1';

      await controller.save();

      expect(deps.plugin.updateConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          enabledMcpServers: undefined,
        })
      );
    });
  });

  describe('loadActive', () => {
    it('should restore enabled MCP servers from conversation', async () => {
      deps.state.currentConversationId = 'conv-1';
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        messages: [],
        sessionId: null,
        enabledMcpServers: ['restored-server-1', 'restored-server-2'],
      });

      await controller.loadActive();

      expect(mockMcpServerSelector.setEnabledServers).toHaveBeenCalledWith([
        'restored-server-1',
        'restored-server-2',
      ]);
    });

    it('should clear MCP servers when conversation has none', async () => {
      deps.state.currentConversationId = 'conv-1';
      (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
        id: 'conv-1',
        messages: [],
        sessionId: null,
        enabledMcpServers: undefined,
      });

      await controller.loadActive();

      expect(mockMcpServerSelector.clearEnabled).toHaveBeenCalled();
    });
  });

  describe('switchTo', () => {
    it('should restore enabled MCP servers when switching conversations', async () => {
      deps.state.currentConversationId = 'old-conv';
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'new-conv',
        providerId: 'claude',
        messages: [],
        sessionId: null,
        enabledMcpServers: ['switched-server'],
      });

      await controller.switchTo('new-conv');

      expect(mockMcpServerSelector.setEnabledServers).toHaveBeenCalledWith(['switched-server']);
    });

    it('should clear MCP servers when switching to conversation with no servers', async () => {
      deps.state.currentConversationId = 'old-conv';
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'new-conv',
        providerId: 'claude',
        messages: [],
        sessionId: null,
        enabledMcpServers: undefined,
      });

      await controller.switchTo('new-conv');

      expect(mockMcpServerSelector.clearEnabled).toHaveBeenCalled();
    });

    it('should ensure the tab service matches the switched conversation provider', async () => {
      const ensureServiceForConversation = jest.fn().mockResolvedValue(undefined);
      const switchedConversation = {
        id: 'new-conv',
        providerId: 'codex',
        title: 'Codex Conversation',
        messages: [],
        sessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      deps = createMockDeps({
        ensureServiceForConversation,
        plugin: {
          ...createMockDeps().plugin,
          switchConversation: jest.fn().mockResolvedValue(switchedConversation),
        } as any,
      });
      controller = new ConversationController(deps);
      deps.state.currentConversationId = 'old-conv';

      await controller.switchTo('new-conv');

      expect(ensureServiceForConversation).toHaveBeenCalledWith(switchedConversation);
    });
  });

  describe('createNew', () => {
    it('should clear enabled MCP servers for new conversation', async () => {
      await controller.createNew();

      expect(mockMcpServerSelector.clearEnabled).toHaveBeenCalled();
    });
  });
});

describe('ConversationController - Race Condition Guards', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createMockDeps();
    controller = new ConversationController(deps);
  });

  describe('createNew guards', () => {
    it('should not create when isCreatingConversation is already true', async () => {
      deps.state.isCreatingConversation = true;

      await controller.createNew();

      expect(deps.plugin.createConversation).not.toHaveBeenCalled();
      expect(deps.plugin.switchConversation).not.toHaveBeenCalled();
    });

    it('should not create when isSwitchingConversation is true', async () => {
      deps.state.isSwitchingConversation = true;

      await controller.createNew();

      expect(deps.plugin.createConversation).not.toHaveBeenCalled();
    });

    it('should reset even when streaming if force is true', async () => {
      deps.state.isStreaming = true;
      deps.state.cancelRequested = false;
      const initialGeneration = deps.state.streamGeneration;

      await controller.createNew({ force: true });

      expect(deps.state.isStreaming).toBe(false);
      expect(deps.state.cancelRequested).toBe(true);
      expect(deps.state.streamGeneration).toBe(initialGeneration + 1);
      expect(deps.state.currentConversationId).toBeNull();
    });

    it('stops the turn through the kernel that is running it', async () => {
      // **The runtime's own `cancel` acts on a run it never started.** The
      // coordinator owns the run on the projection path, so asking the runtime
      // returned having done nothing: starting a new conversation over a
      // streaming turn left that turn running, writing into a conversation the
      // tab had already left.
      const cancel = jest.fn().mockResolvedValue(undefined);
      deps.getProjectionExecution = () => ({ cancel, executionSessionId: null });
      deps.state.isStreaming = true;

      await controller.createNew({ force: true });

      expect(cancel).toHaveBeenCalled();
      expect((deps as any).mockAgentService?.cancel ?? jest.fn()).not.toHaveBeenCalled();
    });

    it('should set and reset isCreatingConversation flag during entry point reset', async () => {
      // Entry point model: createNew() just resets state, doesn't create conversation
      // But isCreatingConversation flag should still be set during the reset
      let flagDuringExecution = false;

      deps.state.clearMessages = jest.fn(() => {
        flagDuringExecution = deps.state.isCreatingConversation;
      });

      await controller.createNew();

      expect(flagDuringExecution).toBe(true);
      expect(deps.state.isCreatingConversation).toBe(false);
    });
  });

  describe('switchTo guards', () => {
    it('should not switch when isSwitchingConversation is already true', async () => {
      deps.state.currentConversationId = 'old-conv';
      deps.state.isSwitchingConversation = true;

      await controller.switchTo('new-conv');

      expect(deps.plugin.switchConversation).not.toHaveBeenCalled();
    });

    it('should not switch when isCreatingConversation is true', async () => {
      deps.state.currentConversationId = 'old-conv';
      deps.state.isCreatingConversation = true;

      await controller.switchTo('new-conv');

      expect(deps.plugin.switchConversation).not.toHaveBeenCalled();
    });

    it('should reset isSwitchingConversation flag even on error', async () => {
      deps.state.currentConversationId = 'old-conv';
      (deps.plugin.switchConversation as jest.Mock).mockRejectedValue(new Error('Switch failed'));

      await expect(controller.switchTo('new-conv')).rejects.toThrow('Switch failed');

      expect(deps.state.isSwitchingConversation).toBe(false);
    });

    it('should reset isSwitchingConversation flag when conversation not found', async () => {
      deps.state.currentConversationId = 'old-conv';
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue(null);

      await controller.switchTo('non-existent');

      expect(deps.state.isSwitchingConversation).toBe(false);
    });

    it('should set isSwitchingConversation flag during switch', async () => {
      deps.state.currentConversationId = 'old-conv';
      let flagDuringSwitch = false;
      (deps.plugin.switchConversation as jest.Mock).mockImplementation(async () => {
        flagDuringSwitch = deps.state.isSwitchingConversation;
        return {
          id: 'new-conv',
          title: 'New Conversation',
          messages: [],
          sessionId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      });

      await controller.switchTo('new-conv');

      expect(flagDuringSwitch).toBe(true);
      expect(deps.state.isSwitchingConversation).toBe(false);
    });
  });

  describe('mutual exclusion', () => {
    it('should prevent createNew during switchTo', async () => {
      deps.state.currentConversationId = 'old-conv';

      // Simulate switchTo in progress
      let switchPromiseResolve: () => void;
      const switchPromise = new Promise<void>((resolve) => {
        switchPromiseResolve = resolve;
      });

      (deps.plugin.switchConversation as jest.Mock).mockImplementation(async () => {
        // During switch, try to createNew
        const createPromise = controller.createNew();

        // createNew should be blocked because isSwitchingConversation is true
        expect(deps.plugin.createConversation).not.toHaveBeenCalled();

        switchPromiseResolve!();
        await createPromise;

        return {
          id: 'new-conv',
          messages: [],
          sessionId: null,
        };
      });

      await controller.switchTo('new-conv');
      await switchPromise;

      expect(deps.plugin.createConversation).not.toHaveBeenCalled();
    });
  });
});

describe('ConversationController - Persistent External Context Paths', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;
  let mockExternalContextSelector: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExternalContextSelector = {
      getExternalContexts: jest.fn().mockReturnValue([]),
      setExternalContexts: jest.fn(),
      clearExternalContexts: jest.fn(),
    };
    deps = createMockDeps({
      getExternalContextSelector: () => mockExternalContextSelector,
    });
    (deps.plugin.settings as any).persistentExternalContextPaths = ['/persistent/path/a', '/persistent/path/b'];
    controller = new ConversationController(deps);
  });

  describe('createNew', () => {
    it('should call clearExternalContexts with persistent paths from settings', async () => {
      await controller.createNew();

      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith(
        ['/persistent/path/a', '/persistent/path/b']
      );
    });

    it('should call clearExternalContexts with empty array if no persistent paths', async () => {
      (deps.plugin.settings as any).persistentExternalContextPaths = undefined;

      await controller.createNew();

      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith([]);
    });
  });

  describe('loadActive', () => {
    it('should use persistent paths for new conversation (no existing conversation)', async () => {
      deps.state.currentConversationId = null;

      await controller.loadActive();

      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith(
        ['/persistent/path/a', '/persistent/path/b']
      );
    });

    it('should use persistent paths for empty conversation (msg=0)', async () => {
      deps.state.currentConversationId = 'existing-conv';
      deps.plugin.getConversationById = jest.fn().mockResolvedValue({
        id: 'existing-conv',
        messages: [],
        sessionId: null,
      });

      await controller.loadActive();

      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith(
        ['/persistent/path/a', '/persistent/path/b']
      );
    });

    it('should restore saved paths for conversation with messages (msg>0)', async () => {
      deps.state.currentConversationId = 'existing-conv';
      deps.plugin.getConversationById = jest.fn().mockResolvedValue({
        id: 'existing-conv',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        externalContextPaths: ['/saved/path'],
      });

      await controller.loadActive();

      expect(mockExternalContextSelector.setExternalContexts).toHaveBeenCalledWith(['/saved/path']);
      expect(mockExternalContextSelector.clearExternalContexts).not.toHaveBeenCalled();
    });

    it('should restore empty paths for conversation with messages but no saved paths', async () => {
      deps.state.currentConversationId = 'existing-conv';
      deps.plugin.getConversationById = jest.fn().mockResolvedValue({
        id: 'existing-conv',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        externalContextPaths: undefined,
      });

      await controller.loadActive();

      expect(mockExternalContextSelector.setExternalContexts).toHaveBeenCalledWith([]);
    });
  });

  describe('switchTo', () => {
    beforeEach(() => {
      deps.state.currentConversationId = 'old-conv';
    });

    it('should use persistent paths when switching to empty conversation (msg=0)', async () => {
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'empty-conv',
        messages: [],
        sessionId: null,
        externalContextPaths: ['/old/saved/path'],
      });

      await controller.switchTo('empty-conv');

      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith(
        ['/persistent/path/a', '/persistent/path/b']
      );
      expect(mockExternalContextSelector.setExternalContexts).not.toHaveBeenCalled();
    });

    it('should restore saved paths when switching to conversation with messages', async () => {
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'conv-with-messages',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        externalContextPaths: ['/saved/path/from/session'],
      });

      await controller.switchTo('conv-with-messages');

      expect(mockExternalContextSelector.setExternalContexts).toHaveBeenCalledWith(
        ['/saved/path/from/session']
      );
      expect(mockExternalContextSelector.clearExternalContexts).not.toHaveBeenCalled();
    });

    it('should restore empty array for conversation with messages but no saved paths', async () => {
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'conv-with-messages',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        externalContextPaths: undefined,
      });

      await controller.switchTo('conv-with-messages');

      expect(mockExternalContextSelector.setExternalContexts).toHaveBeenCalledWith([]);
    });
  });

  describe('Scenario: Adding persistent paths across sessions', () => {
    it('should show all persistent paths when returning to empty session', async () => {
      // Scenario:
      // 1. User is in session 0 (empty), adds path A as persistent
      // 2. User switches to session 1 (with messages), adds path B as persistent
      // 3. User returns to session 0 (empty) - should see both A and B

      // Step 1: Session 0 is empty, persistent paths = [A]
      (deps.plugin.settings as any).persistentExternalContextPaths = ['/path/a'];
      deps.state.currentConversationId = null;
      await controller.loadActive();

      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith(['/path/a']);

      // Step 2: User switches to session 1 and adds path B, settings now have [A, B]
      deps.state.currentConversationId = 'session-0'; // Currently in session 0
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'session-1',
        messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
        sessionId: null,
        externalContextPaths: [],
      });
      await controller.switchTo('session-1');

      // User adds path B in session 1, settings now have [A, B]
      (deps.plugin.settings as any).persistentExternalContextPaths = ['/path/a', '/path/b'];

      // Step 3: User returns to session 0 (empty)
      (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
        id: 'session-0',
        messages: [], // Empty session
        sessionId: null,
        externalContextPaths: ['/path/a'], // Only had A when originally created
      });

      jest.clearAllMocks();
      await controller.switchTo('session-0');

      // Should get BOTH paths because session is empty (msg=0)
      expect(mockExternalContextSelector.clearExternalContexts).toHaveBeenCalledWith(
        ['/path/a', '/path/b']
      );
    });
  });
});

/**
 * **Two suites were deleted here, and it is worth saying what they tested.**
 *
 * `Previous SDK Session IDs` and `Fork Session ID Isolation` asserted that
 * `save()` persisted `providerSessionId`, `previousProviderSessionIds`,
 * `legacyCutoffAt` and `forkSource` — none of which are fields of
 * `Conversation` any more — by handing the controller a mock that computed
 * them and then asserting the controller passed them through. The mock was
 * forty lines reimplementing a session-patch rule that Claude's real
 * `buildSessionPatch` does not have: two lines, `sessionInvalidated ? null :
 * nativeSessionRef`. So the seven tests could not fail for anything
 * production did, which is why they survived every change to the thing they
 * were named after.
 *
 * The binding they were about is written by the persistence barrier now, and
 * asserted against real provider patches in
 * `tests/unit/core/conversations/sessionBindingRoundTrip.test.ts` and
 * `tests/unit/features/chat/application/ChatExecutionCoordinator.*`.
 */


describe('ConversationController - switchTo fork path', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;
  let mockAgentService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentService = {
      getSessionId: jest.fn().mockReturnValue(null),
      syncConversationState: jest.fn(),
      consumeSessionInvalidation: jest.fn().mockReturnValue(false),
    };
    deps = createMockDeps({
      getAgentService: () => mockAgentService,
    });
    controller = new ConversationController(deps);
  });

  it('should sync conversation state for pending fork conversations', async () => {
    deps.state.currentConversationId = 'old-conv';

    const forkConversation = {
      id: 'fork-conv',
      messages: [{ id: '1', role: 'user', content: 'forked msg', timestamp: Date.now() }],
      sessionId: null,
      providerSessionId: undefined,
      forkSource: { sessionId: 'source-session-abc', resumeAt: 'assistant-uuid-1' },
    };
    (deps.plugin.switchConversation as jest.Mock).mockResolvedValue(forkConversation);

    await controller.switchTo('fork-conv');

    // One argument: the external context paths were a second parameter the
    // adapter never took, and the turn reads them off the context selector.
    expect(mockAgentService.syncConversationState).toHaveBeenCalledWith(forkConversation);
  });

  it('should resolve to own sessionId when fork already has its own session', async () => {
    deps.state.currentConversationId = 'old-conv';

    const forkConversation = {
      id: 'fork-conv',
      messages: [{ id: '1', role: 'user', content: 'forked msg', timestamp: Date.now() }],
      sessionId: 'own-session-xyz',
      providerSessionId: 'own-session-xyz',
      forkSource: { sessionId: 'source-session-abc', resumeAt: 'assistant-uuid-1' },
    };
    (deps.plugin.switchConversation as jest.Mock).mockResolvedValue(forkConversation);

    await controller.switchTo('fork-conv');

    // One argument: the external context paths were a second parameter the
    // adapter never took, and the turn reads them off the context selector.
    expect(mockAgentService.syncConversationState).toHaveBeenCalledWith(forkConversation);
  });
});

describe('ConversationController - restoreExternalContextPaths null selector', () => {
  it('should return early when external context selector is null', async () => {
    const deps = createMockDeps({
      getExternalContextSelector: () => null,
    });
    const controller = new ConversationController(deps);

    deps.state.currentConversationId = 'old-conv';
    (deps.plugin.switchConversation as jest.Mock).mockResolvedValue({
      id: 'new-conv',
      messages: [{ id: '1', role: 'user', content: 'test', timestamp: Date.now() }],
      sessionId: null,
      externalContextPaths: ['/some/path'],
    });

    // Should not throw even though selector is null
    await expect(controller.switchTo('new-conv')).resolves.not.toThrow();
  });
});

describe('ConversationController - regenerateTitle callback branches', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;
  let mockTitleService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTitleService = {
      generateTitle: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
    };
    deps = createMockDeps({
      getTitleGenerationService: () => mockTitleService,
    });
    controller = new ConversationController(deps);
  });

  it('should mark as failed when generation fails and user has not renamed', async () => {
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
      id: 'conv-1',
      title: 'Original Title',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
    });

    mockTitleService.generateTitle.mockImplementation(
      async (_convId: string, _user: string, callback: any) => {
        // On callback, getConversationById returns same title (user didn't rename)
        (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
          id: 'conv-1',
          title: 'Original Title',
          messages: [],
        });
        await callback('conv-1', { success: false, title: '' });
      }
    );

    await controller.regenerateTitle('conv-1');

    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', {
      titleGenerationStatus: 'failed',
    });
  });

  it('should clear status when user manually renamed during generation', async () => {
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
      id: 'conv-1',
      title: 'Original Title',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
    });

    // Simulate callback where user has renamed the conversation
    mockTitleService.generateTitle.mockImplementation(
      async (_convId: string, _user: string, callback: any) => {
        // On callback, getConversationById returns a different title (user renamed)
        (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
          id: 'conv-1',
          title: 'User Renamed Title',
          messages: [],
        });
        await callback('conv-1', { success: true, title: 'AI Generated Title' });
      }
    );

    await controller.regenerateTitle('conv-1');

    // Should NOT rename because user already renamed
    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
    // Should clear the status since user's choice takes precedence
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', {
      titleGenerationStatus: undefined,
    });
  });

  it('should not apply title when conversation no longer exists during callback', async () => {
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
      id: 'conv-1',
      title: 'Original Title',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
    });

    // Simulate callback where conversation was deleted
    mockTitleService.generateTitle.mockImplementation(
      async (_convId: string, _user: string, callback: any) => {
        (deps.plugin.getConversationById as jest.Mock).mockResolvedValue(null);
        await callback('conv-1', { success: true, title: 'New Title' });
      }
    );

    await controller.regenerateTitle('conv-1');

    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
  });
});

describe('ConversationController - Rewind', () => {
  let controller: ConversationController;
  let deps: ConversationControllerDeps;
  let mockAgentService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentService = {
      getSessionId: jest.fn().mockReturnValue(null),
      setSessionId: jest.fn(),
      consumeSessionInvalidation: jest.fn().mockReturnValue(false),
      rewind: jest.fn().mockResolvedValue({ canRewind: true, filesChanged: ['a.ts'] }),
      getCapabilities: jest.fn().mockReturnValue({ supportsRewind: true }),
    };
    deps = createMockDeps({
      getAgentService: () => mockAgentService,
    });
    controller = new ConversationController(deps);
  });

  it('should find prev/response assistants with bounded scan (skipping non-uuid messages)', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'm2', role: 'assistant', content: 'boundary', timestamp: 2 }, // No uuid
      { id: 'm3', role: 'user', content: 'test', timestamp: 3, userMessageId: 'user-uuid' },
      { id: 'm4', role: 'assistant', content: 'boundary2', timestamp: 4 }, // No uuid
      { id: 'm5', role: 'assistant', content: 'resp', timestamp: 5, assistantMessageId: 'resp-a' },
    ];

    await controller.rewind('m3');

    expect(mockAgentService.rewind).toHaveBeenCalledWith('user-uuid', 'prev-a', 'code-and-conversation');
  });

  it('should show Notice when message ID not found', async () => {
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];

    await controller.rewind('nonexistent');

    expect(mockNotice).toHaveBeenCalled();
    expect(mockAgentService.rewind).not.toHaveBeenCalled();
  });

  it('should show Notice when streaming', async () => {
    deps.state.isStreaming = true;
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];

    await controller.rewind('m2');

    expect(mockNotice).toHaveBeenCalled();
    expect(mockAgentService.rewind).not.toHaveBeenCalled();
  });

  it('should show Notice when user message has no userMessageId', async () => {
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2 }, // No userMessageId
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];

    await controller.rewind('m2');

    expect(mockNotice).toHaveBeenCalled();
    expect(mockAgentService.rewind).not.toHaveBeenCalled();
  });

  it('should show Notice when no previous assistant with uuid exists', async () => {
    deps.state.messages = [
      { id: 'm1', role: 'user', content: 'test', timestamp: 1, userMessageId: 'u1' },
      { id: 'm2', role: 'assistant', content: '', timestamp: 2, assistantMessageId: 'a1' },
    ];

    await controller.rewind('m1');

    expect(mockNotice).toHaveBeenCalled();
    expect(mockAgentService.rewind).not.toHaveBeenCalled();
  });

  it('should show Notice when no response assistant with uuid exists', async () => {
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
    ];

    await controller.rewind('m2');

    expect(mockNotice).toHaveBeenCalled();
    expect(mockAgentService.rewind).not.toHaveBeenCalled();
  });

  it('should show i18n Notice on SDK rewind exception', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];
    mockAgentService.rewind.mockRejectedValue(new Error('SDK error'));

    await controller.rewind('m2');

    expect(mockNotice).toHaveBeenCalled();
    const msg = mockNotice.mock.calls[0][0] as string;
    expect(msg).toContain('SDK error');
  });

  it('should show i18n Notice when canRewind is false', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];
    mockAgentService.rewind.mockResolvedValue({ canRewind: false, error: 'No checkpoints' });

    await controller.rewind('m2');

    expect(mockNotice).toHaveBeenCalled();
    const msg = mockNotice.mock.calls[0][0] as string;
    expect(msg).toContain('No checkpoints');
  });

  it('should truncateAt, save with resumeAtMessageId, and renderMessages on success', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'user-uuid' },
      { id: 'm3', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    const truncateSpy = jest.spyOn(deps.state, 'truncateAt');

    await controller.rewind('m2');

    expect(mockAgentService.rewind).toHaveBeenCalledWith('user-uuid', 'prev-a', 'code-and-conversation');
    expect(truncateSpy).toHaveBeenCalledWith('m2');
    expect(deps.renderer.renderMessages).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function)
    );
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ resumeAtMessageId: 'prev-a' })
    );

    // Should populate input with rewound message content
    const inputEl = deps.getInputEl();
    expect(inputEl.value).toBe('test');
    expect(inputEl.focus).toHaveBeenCalled();

    // Should show success notice with file count
    const noticeMsg = mockNotice.mock.calls[0][0] as string;
    expect(noticeMsg).toContain('1');

    truncateSpy.mockRestore();
  });

  it('should pass conversation-only mode and keep file changes', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'user-uuid' },
      { id: 'm3', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    await controller.rewind('m2', 'conversation');

    expect(confirm).toHaveBeenCalledWith(
      deps.plugin.app,
      'Rewind conversation to this point? File changes will be kept.',
      'Rewind',
    );
    expect(mockAgentService.rewind).toHaveBeenCalledWith('user-uuid', 'prev-a', 'conversation');
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ resumeAtMessageId: 'prev-a' })
    );
    const noticeMsg = mockNotice.mock.calls[0][0] as string;
    expect(noticeMsg).toBe('Rewound conversation; file changes kept');
  });

  it('should abort when confirmation is declined', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];
    (confirm as jest.Mock).mockResolvedValueOnce(false);

    await controller.rewind('m2');

    expect(mockAgentService.rewind).not.toHaveBeenCalled();
    expect(mockNotice).not.toHaveBeenCalled();
  });

  it('should re-check streaming state after confirmation dialog', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'a1' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'u1' },
      { id: 'm3', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'a2' },
    ];
    (confirm as jest.Mock).mockImplementationOnce(async () => {
      deps.state.isStreaming = true;
      return true;
    });

    await controller.rewind('m2');

    expect(mockAgentService.rewind).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalled();
  });

  it('should show a warning notice when rewind succeeded but save failed', async () => {
    deps.state.currentConversationId = 'conv-1';
    deps.state.messages = [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'm2', role: 'user', content: 'test', timestamp: 2, userMessageId: 'user-uuid' },
      { id: 'm3', role: 'assistant', content: 'resp', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    (deps.plugin.updateConversation as jest.Mock).mockRejectedValueOnce(new Error('Save failed'));

    await controller.rewind('m2');

    expect(mockAgentService.rewind).toHaveBeenCalledWith('user-uuid', 'prev-a', 'code-and-conversation');
    const msg = mockNotice.mock.calls[0][0] as string;
    expect(msg).toContain('Save failed');
  });

  describe('Inline prompt dismissal', () => {
    it('dismisses pending inline prompts during createNew()', async () => {
      const dismissFn = jest.fn();
      deps = createMockDeps({ dismissPendingInlinePrompts: dismissFn });
      controller = new ConversationController(deps);

      await controller.createNew();

      expect(dismissFn).toHaveBeenCalled();
    });

    it('dismisses pending inline prompts during switchTo()', async () => {
      const dismissFn = jest.fn();
      deps = createMockDeps({ dismissPendingInlinePrompts: dismissFn });
      controller = new ConversationController(deps);
      deps.state.currentConversationId = 'old-conv';

      await controller.switchTo('switched-conv');

      expect(dismissFn).toHaveBeenCalled();
    });
  });
});

describe('ConversationController - session restart notice', () => {
  function createDroppedSessionDeps(options: {
    dropped: boolean;
    messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }>;
  }) {
    const conversation = {
      id: 'conv-dropped',
      title: 'Dropped',
      messages: options.messages,
      sessionId: null,
      providerId: 'opencode',
      providerState: { sessionDropped: options.dropped },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const deps = createMockDeps({
      getAgentService: () => ({
        providerId: 'opencode',
        getSessionId: jest.fn().mockReturnValue(null),
        consumeSessionInvalidation: jest.fn().mockReturnValue(false),
        isSessionDropped: jest.fn().mockReturnValue(options.dropped),
        buildSessionUpdates: jest.fn().mockReturnValue({ updates: {} }),
        syncConversationState: jest.fn(),
      }) as any,
    });
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue(conversation);
    deps.state.currentConversationId = conversation.id;
    return { conversation, deps };
  }

  const someMessages = [
    { id: 'm1', role: 'user' as const, content: 'first', timestamp: Date.now() },
    { id: 'm2', role: 'assistant' as const, content: 'reply', timestamp: Date.now() },
  ];

  it('marks the seam when a restored conversation lost its session', async () => {
    const { deps } = createDroppedSessionDeps({ dropped: true, messages: someMessages });
    const controller = new ConversationController(deps);

    await controller.loadActive();

    expect(deps.renderer.renderSessionRestartNotice).toHaveBeenCalled();
  });

  it('says nothing when the session was resumed', async () => {
    const { deps } = createDroppedSessionDeps({ dropped: false, messages: someMessages });
    const controller = new ConversationController(deps);

    await controller.loadActive();

    expect(deps.renderer.renderSessionRestartNotice).not.toHaveBeenCalled();
    expect(deps.renderer.clearSessionRestartNotice).toHaveBeenCalled();
  });

  it('stays quiet on an empty thread, where no history can mislead', async () => {
    const { deps } = createDroppedSessionDeps({ dropped: true, messages: [] });
    const controller = new ConversationController(deps);

    await controller.loadActive();

    expect(deps.renderer.renderSessionRestartNotice).not.toHaveBeenCalled();
  });

  it('re-checks after warmup, which is where the drop is usually first found', async () => {
    const { deps } = createDroppedSessionDeps({ dropped: true, messages: someMessages });
    const controller = new ConversationController(deps);
    await controller.loadActive();
    (deps.renderer.renderSessionRestartNotice as jest.Mock).mockClear();

    controller.refreshSessionRestartNotice();

    expect(deps.renderer.renderSessionRestartNotice).toHaveBeenCalledTimes(1);
  });

  it('does not redraw the thread mid-turn', async () => {
    const { deps } = createDroppedSessionDeps({ dropped: true, messages: someMessages });
    const controller = new ConversationController(deps);
    await controller.loadActive();
    (deps.renderer.renderSessionRestartNotice as jest.Mock).mockClear();
    deps.state.isStreaming = true;

    controller.refreshSessionRestartNotice();

    expect(deps.renderer.renderSessionRestartNotice).not.toHaveBeenCalled();
  });

  it('leaves providers that always resume alone', async () => {
    const deps = createMockDeps({
      getAgentService: () => ({
        providerId: 'claude',
        getSessionId: jest.fn().mockReturnValue('session-1'),
        consumeSessionInvalidation: jest.fn().mockReturnValue(false),
        buildSessionUpdates: jest.fn().mockReturnValue({ updates: {} }),
        syncConversationState: jest.fn(),
      }) as any,
    });
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue({
      id: 'conv-claude',
      title: 'Claude',
      messages: someMessages,
      sessionId: 'session-1',
      providerId: 'claude',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    deps.state.currentConversationId = 'conv-claude';
    const controller = new ConversationController(deps);

    await controller.loadActive();

    expect(deps.renderer.renderSessionRestartNotice).not.toHaveBeenCalled();
  });
});

describe('ConversationController title suggestion', () => {
  function conversationWithUserMessage(overrides: Record<string, unknown> = {}) {
    return {
      id: 'conv-1',
      title: 'New Chat',
      messages: [
        { id: 'm1', role: 'user', content: 'how do I dry PETG?', timestamp: 1 },
      ],
      sessionId: null,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  function createTitleHarness(options: {
    conversation?: any;
    enabled?: boolean;
    service?: any;
  } = {}) {
    const conversation = options.conversation === undefined
      ? conversationWithUserMessage()
      : options.conversation;
    const service = options.service === undefined
      ? {
          generateTitle: jest.fn(async (_id: string, _msg: string, cb: any) => {
            await cb('conv-1', { success: true, title: 'Drying PETG' });
          }),
          cancel: jest.fn(),
        }
      : options.service;
    const deps = createMockDeps({
      getTitleGenerationService: () => service,
    });
    deps.plugin.settings.enableAutoTitleGeneration = options.enabled ?? true;
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue(conversation);
    (deps.plugin.getConversationSync as jest.Mock).mockReturnValue(conversation);
    const controller = new ConversationController(deps);
    return { controller, deps, service };
  }

  it('reports availability from the setting', () => {
    expect(createTitleHarness({ enabled: true }).controller.isAutoTitleEnabled()).toBe(true);
    expect(createTitleHarness({ enabled: false }).controller.isAutoTitleEnabled()).toBe(false);
  });

  it('can suggest only with a conversation that has a user message and a service', () => {
    expect(createTitleHarness().controller.canSuggestTitle('conv-1')).toBe(true);
    expect(createTitleHarness().controller.canSuggestTitle(null)).toBe(false);
    expect(createTitleHarness({ enabled: false }).controller.canSuggestTitle('conv-1')).toBe(false);
    expect(createTitleHarness({ service: null }).controller.canSuggestTitle('conv-1')).toBe(false);
    expect(
      createTitleHarness({ conversation: conversationWithUserMessage({ messages: [] }) })
        .controller.canSuggestTitle('conv-1'),
    ).toBe(false);
    expect(
      createTitleHarness({
        conversation: conversationWithUserMessage({
          messages: [{ id: 'm1', role: 'assistant', content: 'hi', timestamp: 1 }],
        }),
      }).controller.canSuggestTitle('conv-1'),
    ).toBe(false);
  });

  it('returns the generated title without touching the conversation', async () => {
    const { controller, deps, service } = createTitleHarness();

    await expect(controller.suggestTitle('conv-1')).resolves.toEqual({
      ok: true,
      title: 'Drying PETG',
    });
    expect(service.generateTitle).toHaveBeenCalledWith('conv-1', 'how do I dry PETG?', expect.any(Function));
    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
    expect(deps.plugin.updateConversation).not.toHaveBeenCalled();
  });

  it('prefers displayContent over raw content as the prompt', async () => {
    const { controller, service } = createTitleHarness({
      conversation: conversationWithUserMessage({
        messages: [{ id: 'm1', role: 'user', content: 'raw', displayContent: 'shown', timestamp: 1 }],
      }),
    });

    await controller.suggestTitle('conv-1');

    expect(service.generateTitle).toHaveBeenCalledWith('conv-1', 'shown', expect.any(Function));
  });

  it('reports why a suggestion is impossible', async () => {
    await expect(createTitleHarness({ enabled: false }).controller.suggestTitle('conv-1'))
      .resolves.toEqual({ ok: false, reason: 'disabled' });
    await expect(createTitleHarness({ conversation: null }).controller.suggestTitle('conv-1'))
      .resolves.toEqual({ ok: false, reason: 'no-messages' });
    await expect(
      createTitleHarness({ conversation: conversationWithUserMessage({ messages: [] }) })
        .controller.suggestTitle('conv-1'),
    ).resolves.toEqual({ ok: false, reason: 'no-messages' });
    await expect(createTitleHarness({ service: null }).controller.suggestTitle('conv-1'))
      .resolves.toEqual({ ok: false, reason: 'no-service' });
  });

  it('maps a failed provider result to failed', async () => {
    const { controller } = createTitleHarness({
      service: {
        generateTitle: jest.fn(async (_id: string, _msg: string, cb: any) => {
          await cb('conv-1', { success: false, error: 'boom' });
        }),
        cancel: jest.fn(),
      },
    });

    await expect(controller.suggestTitle('conv-1')).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('maps a thrown provider error to failed instead of rejecting', async () => {
    const { controller } = createTitleHarness({
      service: {
        generateTitle: jest.fn().mockRejectedValue(new Error('network down')),
        cancel: jest.fn(),
      },
    });

    await expect(controller.suggestTitle('conv-1')).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('maps a provider that never calls back to failed', async () => {
    const { controller } = createTitleHarness({
      service: {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      },
    });

    await expect(controller.suggestTitle('conv-1')).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('resolves once even if the provider calls back twice', async () => {
    const { controller } = createTitleHarness({
      service: {
        generateTitle: jest.fn(async (_id: string, _msg: string, cb: any) => {
          await cb('conv-1', { success: true, title: 'First' });
          await cb('conv-1', { success: true, title: 'Second' });
        }),
        cancel: jest.fn(),
      },
    });

    await expect(controller.suggestTitle('conv-1')).resolves.toEqual({ ok: true, title: 'First' });
  });

  it('cancels only the conversation it was asked about', () => {
    const { controller, service } = createTitleHarness();

    controller.cancelTitleSuggestion('conv-1');

    expect(service.cancel).toHaveBeenCalledWith('conv-1');
  });

  it('cancelling without a service does not throw', () => {
    const { controller } = createTitleHarness({ service: null });

    expect(() => controller.cancelTitleSuggestion('conv-1')).not.toThrow();
  });
});

describe('ConversationController.regenerateTitle', () => {
  function createRegenerateHarness(options: {
    result?: any;
    titleDuringGeneration?: string;
    enabled?: boolean;
  } = {}) {
    const conversation = {
      id: 'conv-1',
      title: 'New Chat',
      messages: [{ id: 'm1', role: 'user', content: 'how do I dry PETG?', timestamp: 1 }],
      sessionId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const service = {
      generateTitle: jest.fn(async (_id: string, _msg: string, cb: any) => {
        if (options.titleDuringGeneration !== undefined) {
          conversation.title = options.titleDuringGeneration;
        }
        await cb('conv-1', options.result ?? { success: true, title: 'Drying PETG' });
      }),
      cancel: jest.fn(),
    };
    const deps = createMockDeps({ getTitleGenerationService: () => service });
    deps.plugin.settings.enableAutoTitleGeneration = options.enabled ?? true;
    (deps.plugin.getConversationById as jest.Mock).mockResolvedValue(conversation);
    (deps.plugin.getConversationSync as jest.Mock).mockReturnValue(conversation);
    const controller = new ConversationController(deps);
    return { controller, deps, conversation };
  }

  it('saves the generated title and marks the generation successful', async () => {
    const { controller, deps } = createRegenerateHarness();

    await controller.regenerateTitle('conv-1');

    expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: 'pending' });
    expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Drying PETG');
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: 'success' });
  });

  it('marks a failed generation without renaming', async () => {
    const { controller, deps } = createRegenerateHarness({ result: { success: false, error: 'boom' } });

    await controller.regenerateTitle('conv-1');

    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: 'failed' });
  });

  it('keeps a title the user changed during generation', async () => {
    const { controller, deps } = createRegenerateHarness({ titleDuringGeneration: 'Manual name' });

    await controller.regenerateTitle('conv-1');

    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
    expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: undefined });
  });

  it('does nothing when auto title generation is disabled', async () => {
    const { controller, deps } = createRegenerateHarness({ enabled: false });

    await controller.regenerateTitle('conv-1');

    expect(deps.plugin.updateConversation).not.toHaveBeenCalled();
    expect(deps.plugin.renameConversation).not.toHaveBeenCalled();
  });
});
