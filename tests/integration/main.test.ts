import { addIcon, setTooltip } from 'obsidian';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { TOOL_SUBAGENT } from '@/core/tools/toolNames';
import { VIEW_TYPE_GRIMOIRE } from '@/core/types';
import { setLocale } from '@/i18n/i18n';
import * as sdkSession from '@/providers/claude/history/ClaudeHistoryStore';
import { DEFAULT_SETTINGS } from '@/providers/claude/types/settings';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';
import { showWhatsNewModal } from '@/shared/modals/WhatsNewModal';

// Mock fs for ClaudeChatRuntime
jest.mock('fs');
jest.mock('@/shared/modals/WhatsNewModal', () => ({
  showWhatsNewModal: jest.fn().mockResolvedValue(undefined),
}));

// Now import the plugin after mocking
import GrimoirePlugin from '@/main';
import { builtInWorkspaceInitializers } from '@/providers';

describe('GrimoirePlugin', () => {
  let plugin: GrimoirePlugin;
  let mockApp: any;
  let mockManifest: any;

  function getRegisteredCommand(commandId: string) {
    const call = (plugin.addCommand as jest.Mock).mock.calls.find(
      ([config]) => config.id === commandId,
    );

    if (!call) {
      throw new Error(`Command ${commandId} was not registered`);
    }

    return call[0];
  }

  function getMockSdkSessionPath(sessionId: string): string {
    return `/mock/claude/${sessionId}.jsonl`;
  }

  function mockLocatedSdkSessions() {
    return jest.spyOn(sdkSession, 'locateSDKSessions').mockImplementation(async (_vaultPath, sessionIds) => (
      new Map(sessionIds.map(sessionId => [
        sessionId,
        {
          availability: 'available' as const,
          sessionPath: getMockSdkSessionPath(sessionId),
        },
      ]))
    ));
  }

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockApp = {
      vault: {
        adapter: {
          basePath: '/test/vault',
          exists: jest.fn().mockResolvedValue(false),
          read: jest.fn().mockResolvedValue(''),
          write: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
          mkdir: jest.fn().mockResolvedValue(undefined),
          list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
          stat: jest.fn().mockResolvedValue(null),
          rename: jest.fn().mockResolvedValue(undefined),
        },
      },
      workspace: {
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
      },
    };

    mockManifest = {
      id: 'grimoire',
      name: 'Grimoire',
      version: '0.1.0',
    };

    // Create plugin instance with mocked app
    plugin = new GrimoirePlugin(mockApp, mockManifest);
    (plugin.loadData as jest.Mock).mockResolvedValue({});
  });

  describe('onload', () => {
    it('should initialize settings with defaults', async () => {
      await plugin.onload();

      expect(plugin.settings).toBeDefined();
      expect(plugin.settings.permissionMode).toBe(DEFAULT_SETTINGS.permissionMode);
      expect(plugin.settings.hiddenProviderCommands).toEqual(DEFAULT_SETTINGS.hiddenProviderCommands);
    });

    it("queues what's new once when installed version has not been seen", async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => (
        path === '.grimoire/grimoire-settings.json'
      ));
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({ lastSeenChangelogVersion: '0.0.9' });
        }
        if (path === '.obsidian/plugins/grimoire/CHANGELOG.md') {
          return [
            '# Changelog',
            '',
            '## 0.1.0 - 2026-06-21',
            '### Added',
            '- Automatic release notes on plugin load',
          ].join('\n');
        }
        return '';
      });

      await plugin.onload();

      expect(showWhatsNewModal).not.toHaveBeenCalled();
      expect(plugin.getPendingWhatsNewRelease()).toEqual(expect.objectContaining({
        version: '0.1.0',
      }));

      await plugin.acknowledgePendingWhatsNew();

      expect(plugin.settings.lastSeenChangelogVersion).toBe('0.1.0');
      const writeCall = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.grimoire/grimoire-settings.json',
      );
      expect(writeCall).toBeDefined();
      const content = JSON.parse(writeCall[1]);
      expect(content.lastSeenChangelogVersion).toBe('0.1.0');

      plugin.settings.lastSeenChangelogVersion = '0.0.9';
      mockApp.vault.adapter.write.mockClear();

      await plugin.acknowledgePendingWhatsNew();

      expect(plugin.settings.lastSeenChangelogVersion).toBe('0.0.9');
      expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
    });

    it("does not show what's new when current version has already been seen", async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => (
        path === '.grimoire/grimoire-settings.json'
      ));
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({ lastSeenChangelogVersion: '0.1.0' });
        }
        if (path === '.obsidian/plugins/grimoire/CHANGELOG.md') {
          return [
            '# Changelog',
            '',
            '## 0.1.0 - 2026-06-21',
            '### Added',
            '- Automatic release notes on plugin load',
          ].join('\n');
        }
        return '';
      });

      await plugin.onload();

      expect(showWhatsNewModal).not.toHaveBeenCalled();
      expect(plugin.getPendingWhatsNewRelease()).toBeNull();
    });

    it('skips automatic card when current release is missing from changelog', async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => (
        path === '.grimoire/grimoire-settings.json'
      ));
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({ lastSeenChangelogVersion: '0.0.9' });
        }
        if (path === '.obsidian/plugins/grimoire/CHANGELOG.md') {
          return [
            '# Changelog',
            '',
            '## 0.0.9 - 2026-06-20',
            '### Added',
            '- Previous release notes',
          ].join('\n');
        }
        return '';
      });

      await plugin.onload();

      expect(showWhatsNewModal).not.toHaveBeenCalled();
      expect(plugin.getPendingWhatsNewRelease()).toBeNull();
    });

    // Note: With multi-tab, agentService is per-tab via TabManager, not on plugin

    it('should register the view', async () => {
      await plugin.onload();

      expect((plugin.registerView as jest.Mock)).toHaveBeenCalledWith(
        VIEW_TYPE_GRIMOIRE,
        expect.any(Function)
      );
    });

    it('should add ribbon icon', async () => {
      await plugin.onload();

      expect(addIcon).toHaveBeenCalledWith(
        'grimoire',
        expect.stringContaining('<svg'),
      );
      expect((plugin.addRibbonIcon as jest.Mock)).toHaveBeenCalledWith(
        'grimoire',
        'Open Grimoire',
        expect.any(Function)
      );
    });

    it('should add command to open view', async () => {
      await plugin.onload();

      expect((plugin.addCommand as jest.Mock)).toHaveBeenCalledWith({
        id: 'open-view',
        name: 'Open chat view',
        callback: expect.any(Function),
      });
    });

    it('refreshes registered command and ribbon labels after a locale change', async () => {
      const ribbonEl = {} as HTMLElement;
      (plugin.addRibbonIcon as jest.Mock).mockReturnValue(ribbonEl);
      await plugin.onload();

      setLocale('ru');
      plugin.refreshShellTranslations();

      expect(setTooltip).toHaveBeenCalledWith(ribbonEl, 'Открыть Grimoire');
      expect(getRegisteredCommand('open-view').name).toBe('Открыть чат');
      expect(getRegisteredCommand('inline-edit').name).toBe('Редактировать в строке');
      expect(getRegisteredCommand('switch-to-tab-3').name).toBe('Перейти на вкладку 3');
    });

  });

  describe('creating a conversation', () => {
    /**
     * A vault that remembers what was written to it.
     *
     * The shared mock adapter answers `exists: false` and `read: ''`, which is
     * fine for tests that only watch calls but makes every stored conversation
     * invisible — and a collision with a conversation the vault holds is
     * exactly what this group is about.
     */
    function useRememberingVault(): Map<string, string> {
      const files = new Map<string, string>();
      // Folders exist when something is stored under them, which is what the
      // recursive listing checks before it descends.
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => (
        files.has(path) || [...files.keys()].some(stored => stored.startsWith(`${path}/`))
      ));
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        const stored = files.get(path);
        if (stored === undefined) {
          throw new Error(`File not found: ${path}`);
        }
        return stored;
      });
      mockApp.vault.adapter.write.mockImplementation(async (path: string, content: string) => {
        files.set(path, content);
      });
      mockApp.vault.adapter.remove.mockImplementation(async (path: string) => {
        files.delete(path);
      });
      mockApp.vault.adapter.list.mockImplementation(async (folder: string) => ({
        files: [...files.keys()].filter(path => path.startsWith(`${folder}/`)),
        folders: [],
      }));
      mockApp.vault.adapter.rename.mockImplementation(async (from: string, to: string) => {
        const stored = files.get(from);
        if (stored !== undefined) {
          files.set(to, stored);
          files.delete(from);
        }
      });
      return files;
    }

    it('comes back from the vault after a reload, with what was written to it', async () => {
      // The assertion nothing had: a conversation read back through the file
      // listing. Since M4 the file holds a versioned envelope, and a reader
      // that parses it directly gets `{ schemaVersion, recordId, revision,
      // updatedAt, payload }` — which passed the shape guard, so every
      // conversation came back with no id, no title and no messages.
      useRememberingVault();
      await plugin.onload();
      const created = await plugin.createConversation({ providerId: 'claude' });
      await plugin.renameConversation(created.id, 'Tomatoes');

      const reloaded = new GrimoirePlugin(mockApp, mockManifest);
      await reloaded.onload();

      const conversation = await reloaded.getConversationById(created.id);
      expect(conversation).toMatchObject({
        id: created.id,
        providerId: 'claude',
        title: 'Tomatoes',
      });
      reloaded.onunload();
    });

    it('reports a conversation the vault holds and this build cannot read', async () => {
      // The alternative was silence: a damaged record was skipped by the
      // listing, so the file stayed on disk and the chat simply vanished —
      // indistinguishable from one the user deleted.
      const files = useRememberingVault();
      files.set('.grimoire/sessions/conv-broken.meta.json', '{"schemaVersion":1,');
      files.set(
        '.grimoire/sessions/conv-future.meta.json',
        JSON.stringify({
          schemaVersion: 99,
          recordId: 'conv-future',
          revision: 1,
          updatedAt: 1,
          payload: { id: 'conv-future', title: 'Later', createdAt: 1, updatedAt: 1 },
        }),
      );

      await plugin.onload();

      expect([...plugin.getUnreadableConversations()].sort(
        (left, right) => left.id.localeCompare(right.id),
      )).toEqual([
        { id: 'conv-broken', reason: 'corrupt' },
        { id: 'conv-future', reason: 'future' },
      ]);
      // And neither becomes a placeholder row in the conversation list.
      expect(plugin.getConversationList()).toEqual([]);
    });

    it('does not create over a conversation the vault already holds', async () => {
      useRememberingVault();
      // A conversation is keyed by the provider session id it was created
      // from. When that id already names a chat, the new one used to be
      // written straight over it: empty message list, default title, fresh
      // timestamps.
      await plugin.onload();
      const existing = await plugin.createConversation({ sessionId: 'session-1' });
      await plugin.updateConversation(existing.id, { title: 'Tomatoes' });

      const created = await plugin.createConversation({ sessionId: 'session-1' });

      expect(created.id).not.toBe(existing.id);
      // The session is still recorded, so resuming the provider still works.
      expect(created.sessionId).toBe('session-1');
      expect((await plugin.getConversationById(existing.id))?.title).toBe('Tomatoes');
    });
  });

  describe('provider workspaces', () => {
    it('loads every other provider when one workspace initializer throws', async () => {
      // Startup used to await each provider's initializer in one loop with no
      // `try`, so a single throw cost every provider after it in the iteration
      // order its command catalog, model list, CLI resolution and settings tab
      // — and which ones those were depended on object key order.
      // Failed through the providers' own initializer table, which is where the
      // builder is looked up now — the registration this used to spy on held
      // nothing else and is deleted.
      const real = builtInWorkspaceInitializers.claude;
      const restore = () => {
        (builtInWorkspaceInitializers as Record<string, unknown>).claude = real;
      };
      (builtInWorkspaceInitializers as Record<string, unknown>).claude = () => (
        Promise.reject(new Error('no Claude CLI on this machine'))
      );
      try {

        await plugin.onload();
      } finally {
        restore();
      }

      const withoutServices = providerCatalog().ids()
        .filter(providerId => (
          plugin.getApplicationRuntimeOrNull()?.workspaceServicesFor(providerId) ?? null
        ) === null);

      expect(withoutServices).toEqual(['claude']);
    });

    it('withdraws every workspace at unload', async () => {
      // The services map is static and used to outlive the plugin instance that
      // filled it, so the next load read the previous load's services until its
      // own initializer overwrote them.
      await plugin.onload();
      expect(plugin.getApplicationRuntimeOrNull()?.workspaceServicesFor('codex') ?? null).not.toBeNull();

      plugin.onunload();
      await Promise.resolve();
      await Promise.resolve();

      const stillPublished = providerCatalog().ids()
        .filter(providerId => (
          plugin.getApplicationRuntimeOrNull()?.workspaceServicesFor(providerId) ?? null
        ) !== null);

      expect(stillPublished).toEqual([]);
    });
  });

  describe('onunload', () => {
    // Note: With multi-tab, cleanup is handled per-tab via GrimoireView.onClose()
    it('should complete without error', async () => {
      await plugin.onload();

      expect(() => plugin.onunload()).not.toThrow();
    });
  });

  describe('activateView', () => {
    it('should reveal existing leaf if view already exists', async () => {
      const mockLeaf = { id: 'existing-leaf' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });

    it('should create new leaf in right sidebar by default if view does not exist', async () => {
      const mockRightLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getRightLeaf.mockReturnValue(mockRightLeaf);

      await plugin.onload();
      await plugin.activateView();

      expect(mockApp.workspace.getRightLeaf).toHaveBeenCalledWith(false);
      expect(mockRightLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_GRIMOIRE,
        active: true,
      });
    });

    it('should create new leaf in left sidebar when chatViewPlacement is left-sidebar', async () => {
      const mockLeftLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeftLeaf.mockReturnValue(mockLeftLeaf);

      await plugin.onload();
      plugin.settings.chatViewPlacement = 'left-sidebar';
      await plugin.activateView();

      expect(mockApp.workspace.getLeftLeaf).toHaveBeenCalledWith(false);
      expect(mockApp.workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.getLeaf).not.toHaveBeenCalled();
      expect(mockLeftLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_GRIMOIRE,
        active: true,
      });
    });

    it('should handle null right leaf gracefully', async () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getRightLeaf.mockReturnValue(null);

      await plugin.onload();

      // Should not throw
      await expect(plugin.activateView()).resolves.not.toThrow();
    });

    it('should create new leaf in main editor area when chatViewPlacement is main-tab', async () => {
      const mockMainLeaf = {
        setViewState: jest.fn().mockResolvedValue(undefined),
      };
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(mockMainLeaf);

      await plugin.onload();
      plugin.settings.chatViewPlacement = 'main-tab';
      await plugin.activateView();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(mockApp.workspace.getRightLeaf).not.toHaveBeenCalled();
      expect(mockApp.workspace.getLeftLeaf).not.toHaveBeenCalled();
      expect(mockMainLeaf.setViewState).toHaveBeenCalledWith({
        type: VIEW_TYPE_GRIMOIRE,
        active: true,
      });
    });

    it('should handle null main leaf gracefully when chatViewPlacement is main-tab', async () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);
      mockApp.workspace.getLeaf.mockReturnValue(null);

      await plugin.onload();
      plugin.settings.chatViewPlacement = 'main-tab';

      await expect(plugin.activateView()).resolves.not.toThrow();
    });
  });

  describe('loadSettings', () => {
    it('should merge saved data with defaults', async () => {
      // Mock grimoire-settings.json exists with custom values (Grimoire-specific settings)
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({
            userName: 'TestUser',
          });
        }
        return '';
      });

      await plugin.loadSettings();

      expect(plugin.settings.userName).toBe('TestUser');
      expect(plugin.settings.hiddenProviderCommands).toEqual(DEFAULT_SETTINGS.hiddenProviderCommands);
    });

    it('should strip legacy blocklist fields when loading old settings', async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({
            enableBlocklist: false,
            blockedCommands: { unix: ['rm -rf', '  '] },
          });
        }
        return '';
      });

      await plugin.loadSettings();

      expect('enableBlocklist' in plugin.settings).toBe(false);
      expect('blockedCommands' in plugin.settings).toBe(false);
      expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
        '.grimoire/grimoire-settings.json',
        expect.any(String),
      );
      const writeCall = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.grimoire/grimoire-settings.json',
      );
      expect(writeCall).toBeDefined();
      const content = JSON.parse(writeCall[1]);
      expect(content).not.toHaveProperty('enableBlocklist');
      expect(content).not.toHaveProperty('blockedCommands');
    });

    it('should use defaults when no saved data', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      (plugin.loadData as jest.Mock).mockResolvedValue(null);

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should use defaults when loadData returns empty object', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should migrate legacy openInMainTab true to main-tab placement', async () => {
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({ openInMainTab: true });
        }
        return '';
      });

      await plugin.loadSettings();

      expect(plugin.settings.chatViewPlacement).toBe('main-tab');
      const writeCall = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.grimoire/grimoire-settings.json',
      );
      expect(writeCall).toBeDefined();
      const content = JSON.parse(writeCall[1]);
      expect(content.chatViewPlacement).toBe('main-tab');
      expect(content).not.toHaveProperty('openInMainTab');
    });

    it('should reconcile Claude model from environment into provider state', async () => {
      // Mock grimoire-settings.json with environment variables
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({
            environmentVariables: 'ANTHROPIC_MODEL=custom-model',
            lastEnvHash: '',
          });
        }
        return '';
      });

      const saveSpy = jest.spyOn(plugin, 'saveSettings');
      await plugin.loadSettings();

      expect(plugin.settings.settingsProvider).toBe('codex');
      expect(plugin.settings.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(plugin.settings.savedProviderModel?.claude).toBe('custom-model');
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('saveSettings', () => {
    it('should save settings to file', async () => {
      await plugin.onload();

      await plugin.saveSettings();

      // Grimoire-specific settings should be written to .grimoire/grimoire-settings.json
      expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
        '.grimoire/grimoire-settings.json',
        expect.any(String)
      );

      // The written content should include state fields
      const writeCall = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.grimoire/grimoire-settings.json'
      );
      expect(writeCall).toBeDefined();
      const content = JSON.parse(writeCall[1]);
      expect(content).not.toHaveProperty('activeConversationId');
      expect(content).toHaveProperty('providerConfigs.claude.environmentHash');
      expect(content).toHaveProperty('providerConfigs.claude.lastModel');
      expect(content).toHaveProperty('lastCustomModel');
      expect(content).not.toHaveProperty('enableBlocklist');
      expect(content).not.toHaveProperty('blockedCommands');
      // Permissions are now in .claude/settings.json (CC format), not grimoire-settings.json
      expect(content).not.toHaveProperty('permissions');
    });
  });

  describe('applyEnvironmentVariables', () => {
    it('updates runtime env vars when changed', async () => {
      await plugin.onload();

      await plugin.applyEnvironmentVariables('shared', 'A=2');
      expect(plugin.getEnvironmentVariablesForScope('shared')).toBe('A=2');

      await plugin.applyEnvironmentVariables('shared', 'A=3');
      expect(plugin.getEnvironmentVariablesForScope('shared')).toBe('A=3');

      // No change - should not update
      const currentEnv = plugin.getEnvironmentVariablesForScope('shared');
      await plugin.applyEnvironmentVariables('shared', 'A=3');
      expect(plugin.getEnvironmentVariablesForScope('shared')).toBe(currentEnv);
    });

    it('invalidates sessions when env hash changes', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({
        providerId: 'claude',
        sessionId: 'session-123',
      });
      const updateSpy = jest.spyOn(plugin.storage.sessions, 'updateMetadata');
      updateSpy.mockClear();

      await plugin.applyEnvironmentVariables('provider:claude', 'ANTHROPIC_MODEL=claude-sonnet-4-5');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.sessionId).toBeNull();
      // Only what the invalidation cleared. Writing the whole conversation here
      // would take a message appended in another window with it.
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: conv.id }),
        ['sessionId', 'providerState'],
      );
    });

    it('broadcasts ensureReady with force when env changes without model change', async () => {
      await plugin.onload();

      // Mock getView to return a view with tabManager
      const mockSyncConversationState = jest.fn();
      const mockEnsureReady = jest.fn().mockResolvedValue(true);
      const mockTabManager = {
        getAllTabs: jest.fn().mockReturnValue([{
          providerId: 'claude',
          conversationId: null,
          state: { isStreaming: false },
          serviceInitialized: true,
          service: {
            ensureReady: mockEnsureReady,
            syncConversationState: mockSyncConversationState,
          },
          ui: { externalContextSelector: { getExternalContexts: jest.fn().mockReturnValue([]) } },
        }]),
      };
      const mockView = {
        getTabManager: jest.fn().mockReturnValue(mockTabManager),
        invalidateProviderCommandCaches: jest.fn(),
        refreshModelSelector: jest.fn(),
      };
      jest.spyOn(plugin, 'getView').mockReturnValue(mockView as any);

      // Change env but not in a way that affects model
      await plugin.applyEnvironmentVariables('shared', 'SOME_VAR=value');

      expect(mockSyncConversationState).toHaveBeenCalledWith(null);
      // `force` is read now: the adapter took no options at all, so a method
      // with fewer parameters satisfied one with more and this option was
      // dropped for every flipped provider. It re-establishes the session,
      // which is what an environment change means for a tab that already has
      // one opened against the old environment.
      expect(mockEnsureReady).toHaveBeenCalledWith({ force: true });
    });

    it('syncs live external contexts before restarting invalidated Claude runtimes', async () => {
      await plugin.onload();

      const conversation = await plugin.createConversation({
        providerId: 'claude',
        sessionId: 'session-123',
      });
      await plugin.updateConversation(conversation.id, {
        externalContextPaths: ['/saved/context'],
        messages: [{
          content: 'hi',
          id: 'msg-1',
          role: 'user',
          timestamp: Date.now(),
          userMessageId: 'msg-1',
        }],
      });

      const mockSyncConversationState = jest.fn();
      const mockResetSession = jest.fn();
      const mockEnsureReady = jest.fn().mockResolvedValue(true);
      const mockTabManager = {
        getAllTabs: jest.fn().mockReturnValue([{
          conversationId: conversation.id,
          providerId: 'claude',
          state: { isStreaming: false },
          serviceInitialized: true,
          service: {
            ensureReady: mockEnsureReady,
            resetSession: mockResetSession,
            syncConversationState: mockSyncConversationState,
          },
          ui: { externalContextSelector: { getExternalContexts: jest.fn().mockReturnValue(['/live/context']) } },
        }]),
      };
      const mockView = {
        getTabManager: jest.fn().mockReturnValue(mockTabManager),
        invalidateProviderCommandCaches: jest.fn(),
        refreshModelSelector: jest.fn(),
      };
      jest.spyOn(plugin, 'getView').mockReturnValue(mockView as any);

      await plugin.applyEnvironmentVariables('provider:claude', 'ANTHROPIC_MODEL=claude-sonnet-4-5');

      // The live paths are no longer passed here and were never received: the
      // adapter's `syncConversationState` takes only the conversation. They
      // reach the turn from the same selector this used to read — the input
      // controller asks it when a turn is built — so what moved is where the
      // question is asked, not whether it is.
      expect(mockSyncConversationState).toHaveBeenCalledWith(
        expect.objectContaining({ id: conversation.id }),
      );
      expect(mockResetSession).toHaveBeenCalledTimes(1);
      expect(mockEnsureReady).toHaveBeenCalledWith();
    });
  });

  describe('ribbon icon callback', () => {
    it('reveals existing view when ribbon icon is clicked', async () => {
      await plugin.onload();
      const mockLeaf = { id: 'existing' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const ribbonCallback = (plugin.addRibbonIcon as jest.Mock).mock.calls[0][2];
      await ribbonCallback();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });
  });

  describe('command callback', () => {
    it('reveals existing view when command is executed', async () => {
      await plugin.onload();
      const mockLeaf = { id: 'existing' };
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockLeaf]);

      const commandConfig = (plugin.addCommand as jest.Mock).mock.calls[0][0];
      await commandConfig.callback();

      expect(mockApp.workspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
    });
  });

  describe('switch-to-tab-N commands', () => {
    function leafWithTabs(tabs: Array<{ id: string }>) {
      const switchToTab = jest.fn().mockResolvedValue(undefined);
      const tabManager = {
        getAllTabs: jest.fn().mockReturnValue(tabs),
        switchToTab,
      };
      const mockView = { getTabManager: () => tabManager };
      mockApp.workspace.getLeavesOfType.mockReturnValue([{ view: mockView }]);
      return { tabManager, switchToTab };
    }

    it('registers commands for tabs 1 through 9', async () => {
      await plugin.onload();

      for (let i = 1; i <= 9; i++) {
        const command = getRegisteredCommand(`switch-to-tab-${i}`);
        expect(command.name).toBe(`Switch to tab ${i}`);
      }
    });

    it('switches to the requested tab when it exists', async () => {
      await plugin.onload();
      const { switchToTab } = leafWithTabs([{ id: 'tab-a' }, { id: 'tab-b' }]);

      const command = getRegisteredCommand('switch-to-tab-2');

      expect(command.checkCallback(true)).toBe(true);
      expect(command.checkCallback(false)).toBe(true);
      expect(switchToTab).toHaveBeenCalledTimes(1);
      expect(switchToTab).toHaveBeenCalledWith('tab-b');
    });

    it('is unavailable when the requested tab slot does not exist', async () => {
      await plugin.onload();
      const { switchToTab } = leafWithTabs([{ id: 'tab-a' }, { id: 'tab-b' }]);

      const command = getRegisteredCommand('switch-to-tab-3');

      expect(command.checkCallback(true)).toBe(false);
      expect(switchToTab).not.toHaveBeenCalled();
    });

    it('is unavailable when no Grimoire leaf is open', async () => {
      await plugin.onload();
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);

      const command = getRegisteredCommand('switch-to-tab-1');

      expect(command.checkCallback(true)).toBe(false);
    });

    it('is unavailable when the leaf has no tab manager yet', async () => {
      await plugin.onload();
      mockApp.workspace.getLeavesOfType.mockReturnValue([
        { view: { getTabManager: () => null } },
      ]);

      const command = getRegisteredCommand('switch-to-tab-1');

      expect(command.checkCallback(true)).toBe(false);
    });
  });

  describe('new-tab command', () => {
    it('opens the view without creating a duplicate tab when no tab layout is persisted', async () => {
      await plugin.onload();

      const createNewTab = jest.fn().mockResolvedValue(undefined);
      const mockView = {
        createNewTab,
      };

      let viewOpened = false;
      jest.spyOn(plugin, 'activateView').mockImplementation(async () => {
        viewOpened = true;
      });
      jest.spyOn(plugin, 'getView').mockImplementation(() => (
        viewOpened ? mockView as any : null
      ));

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(true);
      expect(command.checkCallback(false)).toBe(true);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(plugin.activateView).toHaveBeenCalledTimes(1);
      expect(createNewTab).not.toHaveBeenCalled();
    });

    it('creates a new tab after reopening a persisted tab layout', async () => {
      (plugin.loadData as jest.Mock).mockResolvedValue({
        tabManagerState: {
          openTabs: [
            { tabId: 'tab-1', conversationId: null },
          ],
          activeTabId: 'tab-1',
        },
      });

      await plugin.onload();

      const createNewTab = jest.fn().mockResolvedValue(undefined);
      const mockView = {
        createNewTab,
      };

      let viewOpened = false;
      jest.spyOn(plugin, 'activateView').mockImplementation(async () => {
        viewOpened = true;
      });
      jest.spyOn(plugin, 'getView').mockImplementation(() => (
        viewOpened ? mockView as any : null
      ));

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(true);
      expect(command.checkCallback(false)).toBe(true);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(plugin.activateView).toHaveBeenCalledTimes(1);
      expect(createNewTab).toHaveBeenCalledTimes(1);
    });

    it('stays unavailable when the open view is already at the tab limit', async () => {
      await plugin.onload();

      const mockView = {
        getTabManager: jest.fn().mockReturnValue({
          canCreateTab: jest.fn().mockReturnValue(false),
        }),
      };

      jest.spyOn(plugin, 'getView').mockReturnValue(mockView as any);

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(false);
    });

    it('keeps tab commands unavailable while a Grimoire leaf view is not initialized', async () => {
      await plugin.onload();

      mockApp.workspace.getLeavesOfType.mockReturnValue([{ view: {} }]);

      for (const commandId of ['new-tab', 'new-session', 'close-current-tab']) {
        const command = getRegisteredCommand(commandId);

        expect(() => command.checkCallback(true)).not.toThrow();
        expect(command.checkCallback(true)).toBe(false);
      }
    });

    it('stays unavailable when reopening the persisted layout would already hit the tab limit', async () => {
      (plugin.loadData as jest.Mock).mockResolvedValue({
        tabManagerState: {
          openTabs: Array.from({ length: DEFAULT_SETTINGS.maxTabs }, (_, index) => ({
            tabId: `tab-${index + 1}`,
            conversationId: null,
          })),
          activeTabId: `tab-${DEFAULT_SETTINGS.maxTabs}`,
        },
      });

      await plugin.onload();

      jest.spyOn(plugin, 'getView').mockReturnValue(null);

      const command = getRegisteredCommand('new-tab');

      expect(command.checkCallback(true)).toBe(false);
    });
  });

  describe('what a conversation write actually writes', () => {
    /**
     * The seam neither half proves alone.
     *
     * `SessionStorage` composes two writers correctly and has its own tests for
     * it; the plugin decides **what to tell it changed**. Reverting the plugin's
     * half leaves both of those suites green — the whole conversation would go
     * back to being written on every save, and only an assertion here would
     * notice.
     */
    it('renames a conversation by writing the title and nothing else', async () => {
      await plugin.onload();
      const conv = await plugin.createConversation({ providerId: 'claude' });
      const update = jest.spyOn(plugin.storage.sessions, 'updateMetadata');
      const save = jest.spyOn(plugin.storage.sessions, 'saveMetadata');

      await plugin.renameConversation(conv.id, 'About tomatoes');

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: conv.id, title: 'About tomatoes' }),
        ['title'],
      );
      // A rename that wrote the whole conversation put back whatever this
      // window was holding — which mid-stream is the messages from before it.
      expect(save).not.toHaveBeenCalled();
    });

    it('updates a conversation by writing only the fields the caller set', async () => {
      await plugin.onload();
      const conv = await plugin.createConversation({ providerId: 'claude' });
      const update = jest.spyOn(plugin.storage.sessions, 'updateMetadata');
      const save = jest.spyOn(plugin.storage.sessions, 'saveMetadata');

      await plugin.updateConversation(conv.id, { titleGenerationStatus: 'success' });

      // The callers already speak in deltas — a status, a model, the stream's
      // message list — and this is where that used to be thrown away.
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: conv.id }),
        ['titleGenerationStatus'],
      );
      expect(save).not.toHaveBeenCalled();
    });

    it('carries every field an update did set, and nothing it did not', async () => {
      await plugin.onload();
      const conv = await plugin.createConversation({ providerId: 'claude' });
      const update = jest.spyOn(plugin.storage.sessions, 'updateMetadata');

      await plugin.updateConversation(conv.id, {
        messages: [],
        model: 'claude-sonnet-4-5',
        // Immutable, and stripped before the write reaches storage.
        providerId: 'codex',
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: conv.id }),
        ['model', 'messages'],
      );
    });

    it('creates a conversation as a conversation the vault does not have', async () => {
      await plugin.onload();
      const create = jest.spyOn(plugin.storage.sessions, 'createMetadata');

      const conv = await plugin.createConversation({ providerId: 'claude' });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: conv.id }));
    });
  });

  describe('what happened when a conversation was opened', () => {
    it('reports what the provider said about its history', async () => {
      await plugin.onload();
      const conv = await plugin.createConversation({ providerId: 'claude' });
      // Spied on the workspace port the plugin now asks, which is the seam
      // that carries the outcome to the surface.
      const transcripts = (
        await plugin.getApplicationRuntimeOrNull()?.workspaceFor('claude')
      )?.transcripts;
      const hydrate = jest.spyOn(transcripts!, 'hydrate')
        .mockResolvedValue({ outcome: 'stale', reason: 'sessionsNotFound' });

      await plugin.getConversationById(conv.id);

      // The surface reads this to say why a transcript is short. Before it, the
      // provider knew and nobody carried it, so an unloadable conversation
      // looked exactly like an empty one.
      expect(plugin.getHistoryHydration(conv.id)).toEqual({
        outcome: 'stale',
        reason: 'sessionsNotFound',
      });
      hydrate.mockRestore();
    });

    it('forgets what it found when the conversation is deleted', async () => {
      await plugin.onload();
      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.getConversationById(conv.id);

      await plugin.deleteConversation(conv.id);

      expect(plugin.getHistoryHydration(conv.id)).toBeUndefined();
    });
  });

  describe('createConversation', () => {
    it('should create a new conversation with unique ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      expect(conv.id).toMatch(/^conv-\d+-[a-z0-9]+$/);
      expect(conv.messages).toEqual([]);
      expect(conv.sessionId).toBeNull();
    });

    it('should allow retrieving created conversation by ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const fetched = await plugin.getConversationById(conv.id);

      expect(fetched?.id).toBe(conv.id);
    });

    it('should generate default title with timestamp', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      // Title should contain month and time
      expect(conv.title).toBeTruthy();
      expect(conv.title.length).toBeGreaterThan(0);
    });

    // Note: Session management is now per-tab via TabManager
  });

  describe('switchConversation', () => {
    it('should switch to existing conversation', async () => {
      await plugin.onload();

      const conv1 = await plugin.createConversation();
      await plugin.createConversation(); // Create second conversation to switch from

      const result = await plugin.switchConversation(conv1.id);

      expect(result?.id).toBe(conv1.id);
    });

    // Note: Session ID restoration is now handled per-tab via TabManager

    it('should return null for non-existent conversation', async () => {
      await plugin.onload();

      const result = await plugin.switchConversation('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation by ID', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const convId = conv.id;

      // Create another so we have at least one left
      await plugin.createConversation();

      await plugin.deleteConversation(convId);

      const list = plugin.getConversationList();
      expect(list.find(c => c.id === convId)).toBeUndefined();
    });

    it('should allow deleting last conversation without recreating', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.deleteConversation(conv.id);

      const list = plugin.getConversationList();
      expect(list.find(c => c.id === conv.id)).toBeUndefined();
    });
  });

  describe('renameConversation', () => {
    it('should rename conversation', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.renameConversation(conv.id, 'New Title');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.title).toBe('New Title');
    });

    it('should use default title if empty string provided', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.renameConversation(conv.id, '   ');

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.title).toBeTruthy();
    });
  });

  describe('updateConversation', () => {
    it('should update conversation messages', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      ];

      await plugin.updateConversation(conv.id, { messages });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.messages).toEqual(messages);
    });

    it('keeps vault search source metadata on the in-memory conversation', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          userMessageId: 'provider-user-1',
          content: '@vault roadmap',
          timestamp: Date.now(),
          vaultSearchContext: {
            query: 'roadmap',
            snippets: [
              {
                source: {
                  id: 'Roadmap.md',
                  path: 'Roadmap.md',
                  title: 'Roadmap',
                  kind: 'vault-note' as const,
                },
                text: 'Roadmap context',
                score: 10,
                matchedTerms: ['roadmap'],
              },
            ],
          },
        },
      ];

      await plugin.updateConversation(conv.id, { messages });

      const updated = plugin.getConversationSync(conv.id);
      expect(updated?.vaultSearchContexts).toEqual([
        {
          userMessageIndex: 0,
          userMessageId: 'provider-user-1',
          context: {
            query: 'roadmap',
            snippets: [
              expect.objectContaining({
                text: 'Roadmap context',
              }),
            ],
          },
        },
      ]);
    });

    it('should update conversation sessionId', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();

      await plugin.updateConversation(conv.id, { sessionId: 'new-session-id' });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.sessionId).toBe('new-session-id');
    });

    it('should update updatedAt timestamp', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      const originalUpdatedAt = conv.updatedAt;

      // Small delay to ensure timestamp differs
      await new Promise(resolve => window.setTimeout(resolve, 10));

      await plugin.updateConversation(conv.id, { title: 'Changed' });

      const updated = await plugin.getConversationById(conv.id);
      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('getConversationList', () => {
    it('should return conversation metadata', async () => {
      await plugin.onload();

      await plugin.createConversation();

      const list = plugin.getConversationList();

      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('title');
      expect(list[0]).toHaveProperty('messageCount');
      expect(list[0]).toHaveProperty('preview');
    });

    it('should return preview from first user message', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello Claude', timestamp: Date.now() },
        ],
      });

      const list = plugin.getConversationList();
      const meta = list.find(c => c.id === conv.id);

      expect(meta?.preview).toContain('Hello Claude');
    });
  });

  describe('loadSettings with conversations', () => {
    it('should load saved conversations from metadata files', async () => {
      const timestamp = Date.now();
      const sessionMeta = JSON.stringify({
        id: 'conv-saved-1',
        title: 'Saved Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionId: 'saved-session',
      });

      // Mock files exist
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        // Session files
        if (path === '.grimoire/sessions' || path === '.grimoire/sessions/conv-saved-1.meta.json') {
          return true;
        }
        // grimoire-settings.json exists
        if (path === '.grimoire/grimoire-settings.json') {
          return true;
        }
        return false;
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions') {
          return { files: ['.grimoire/sessions/conv-saved-1.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions/conv-saved-1.meta.json') {
          return sessionMeta;
        }
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      // data.json is minimal (no state - already migrated)
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-saved-1');
      expect(loaded?.id).toBe('conv-saved-1');
      expect(loaded?.title).toBe('Saved Chat');
    });

    it('should restore persisted messages when native provider history is unavailable', async () => {
      const timestamp = Date.now();
      const messages = [
        { id: 'user-1', role: 'user', content: 'Apply @instructions to the current note', timestamp },
        { id: 'assistant-1', role: 'assistant', content: 'Done.', timestamp: timestamp + 1 },
      ];
      const sessionMeta = JSON.stringify({
        id: 'conv-antigravity-1',
        providerId: 'antigravity',
        title: 'Antigravity Chat',
        createdAt: timestamp,
        updatedAt: timestamp + 1,
        sessionId: 'agy-session',
        messages,
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json' ||
          path === '.grimoire/sessions' ||
          path === '.grimoire/sessions/conv-antigravity-1.meta.json';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions') {
          return { files: ['.grimoire/sessions/conv-antigravity-1.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions/conv-antigravity-1.meta.json') {
          return sessionMeta;
        }
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      await plugin.loadSettings();

      const listEntry = plugin.getConversationList().find(meta => meta.id === 'conv-antigravity-1');
      expect(listEntry?.messageCount).toBe(2);
      expect(listEntry?.preview).toContain('Apply @instructions');

      const loaded = await plugin.getConversationById('conv-antigravity-1');
      expect(loaded?.messages).toEqual(messages);
    });

    it('should clear session IDs when provider base URL changes', async () => {
      const timestamp = Date.now();
      const sessionMeta = JSON.stringify({
        id: 'conv-saved-1',
        providerId: 'claude',
        title: 'Saved Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionId: 'saved-session',
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json' ||
          path === '.grimoire/sessions' ||
          path === '.grimoire/sessions/conv-saved-1.meta.json';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions') {
          return { files: ['.grimoire/sessions/conv-saved-1.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/grimoire-settings.json') {
          // All these fields are now in grimoire-settings.json
          return JSON.stringify({
            lastEnvHash: 'old-hash',
            environmentVariables: 'ANTHROPIC_BASE_URL=https://api.example.com',
          });
        }
        if (path === '.grimoire/sessions/conv-saved-1.meta.json') {
          return sessionMeta;
        }
        return '';
      });

      // data.json is minimal (already migrated)
      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-saved-1');
      expect(loaded?.sessionId).toBeNull();

      // Session metadata is replaced rather than overwritten: the content goes
      // to a file beside the destination, which is then renamed over it, so a
      // write torn by a crash leaves the previous transcript intact.
      const sessionWrite = (mockApp.vault.adapter.write as jest.Mock).mock.calls.find(
        ([path]) => path === '.grimoire/sessions/conv-saved-1.meta.json.pending'
      );
      expect(sessionWrite).toBeDefined();
      expect(mockApp.vault.adapter.rename).toHaveBeenCalledWith(
        '.grimoire/sessions/conv-saved-1.meta.json.pending',
        '.grimoire/sessions/conv-saved-1.meta.json',
      );
      // The conversation travels inside a record envelope now, in the same file.
      const meta = JSON.parse(sessionWrite?.[1] as string).payload;
      expect(meta.sessionId).toBeNull();
    });

    it('should ignore legacy activeConversationId when no sessions exist', async () => {
      // No sessions exist
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      mockApp.vault.adapter.list.mockResolvedValue({ files: [], folders: [] });

      (plugin.loadData as jest.Mock).mockResolvedValue({
        activeConversationId: 'non-existent',
        migrationVersion: 2,
      });

      await plugin.loadSettings();

      expect(plugin.getConversationList()).toHaveLength(0);
    });
  });

  describe('Multi-session message loading', () => {
    it('should load messages from previousProviderSessionIds when present', async () => {
      const timestamp = Date.now();

      // Setup conversation with previousProviderSessionIds
      const sessionMeta = JSON.stringify({
        type: 'meta',
        id: 'conv-multi-session',
        title: 'Multi Session Chat',
        createdAt: timestamp,
        updatedAt: timestamp,
        providerState: {
          providerSessionId: 'session-B',
          previousProviderSessionIds: ['session-A'],
        },
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.grimoire/grimoire-settings.json' ||
          path === '.grimoire/sessions' ||
          path === '.grimoire/sessions/conv-multi-session.meta.json';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions') {
          return { files: ['.grimoire/sessions/conv-multi-session.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.grimoire/sessions/conv-multi-session.meta.json') {
          return sessionMeta;
        }
        if (path === '.grimoire/grimoire-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      (plugin.loadData as jest.Mock).mockResolvedValue({});

      await plugin.loadSettings();

      const loaded = await plugin.getConversationById('conv-multi-session');
      expect((loaded?.providerState as any)?.previousProviderSessionIds).toEqual(['session-A']);
      expect((loaded?.providerState as any)?.providerSessionId).toBe('session-B');
    });

    it('should preserve previousProviderSessionIds through conversation updates', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-B',
          previousProviderSessionIds: ['session-A'],
        },
      });

      const updated = await plugin.getConversationById(conv.id);
      expect((updated?.providerState as any)?.previousProviderSessionIds).toEqual(['session-A']);
      expect((updated?.providerState as any)?.providerSessionId).toBe('session-B');

      // Further update should preserve previousProviderSessionIds
      await plugin.updateConversation(conv.id, {
        title: 'Updated Title',
      });

      const afterTitleUpdate = await plugin.getConversationById(conv.id);
      expect((afterTitleUpdate?.providerState as any)?.previousProviderSessionIds).toEqual(['session-A']);
    });

    it('should handle empty previousProviderSessionIds array', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation();
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-A',
          previousProviderSessionIds: [],
        },
      });

      const updated = await plugin.getConversationById(conv.id);
      expect((updated?.providerState as any)?.previousProviderSessionIds).toEqual([]);
    });
  });

  describe('loadSdkMessagesForConversation - fork branch', () => {
    it('should load from forkSource.sessionId and truncate at forkSource.resumeAt for pending fork', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          forkSource: { sessionId: 'source-session-abc', resumeAt: 'asst-uuid-cutoff' },
          // No providerSessionId → isPendingFork returns true
          providerSessionId: undefined,
        },
        sessionId: null,
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          { id: 'sdk-msg-1', role: 'user', content: 'Hello', timestamp: 1000 },
          { id: 'sdk-msg-2', role: 'assistant', content: 'Hi', timestamp: 1001 },
        ],
        skippedLines: 0,
      });

      // Trigger loadSdkMessagesForConversation via public API
      const loaded = await plugin.getConversationById(conv.id);

      // Should resolve the source session, not the conversation's own session.
      expect(locationsSpy).toHaveBeenCalledWith(
        expect.any(String),
        ['source-session-abc'],
        expect.any(Object)
      );

      // Should load from forkSource.sessionId with forkSource.resumeAt as truncation point
      expect(loadSpy).toHaveBeenCalledWith(
        expect.any(String),
        'source-session-abc',
        'asst-uuid-cutoff',
        getMockSdkSessionPath('source-session-abc')
      );

      // Messages should be loaded
      expect(loaded?.messages).toBeDefined();

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('should NOT use fork path when conversation has its own providerSessionId', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          forkSource: { sessionId: 'source-session', resumeAt: 'asst-uuid' },
          providerSessionId: 'own-session-id',
        },
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      await plugin.getConversationById(conv.id);

      // Should resolve the conversation's own session, not the fork source.
      expect(locationsSpy).toHaveBeenCalledWith(
        expect.any(String),
        ['own-session-id'],
        expect.any(Object)
      );

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });
  });

  describe('loadSdkMessagesForConversation - subagent recovery', () => {
    it('restores subagent data when Task tool exists but subagent content block is missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-subagent-recovery',
          subagentData: {
            'task-1': {
              id: 'task-1',
              description: 'Recovered subagent',
              status: 'completed',
              result: 'Recovered result',
              toolCalls: [
                {
                  id: 'sub-tool-1',
                  name: 'Read',
                  input: { file_path: 'README.md' },
                  status: 'completed',
                  result: 'content',
                } as any,
              ],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-1',
                name: 'Task',
                input: { description: 'Do sub task' },
                status: 'completed',
                result: 'Task completed',
              } as any,
            ],
            // Simulate partial persisted blocks that lost the task tool block.
            contentBlocks: [{ type: 'text', content: 'Done' }] as any,
          } as any,
        ],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      expect(loadSpy).toHaveBeenCalledWith(
        expect.any(String),
        'session-subagent-recovery',
        undefined,
        getMockSdkSessionPath('session-subagent-recovery')
      );
      expect(loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-1')).toEqual(
        expect.objectContaining({
          subagent: expect.objectContaining({
            id: 'task-1',
            description: 'Recovered subagent',
            result: 'Recovered result',
          }),
        })
      );
      expect(loaded?.messages[0].contentBlocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'subagent', subagentId: 'task-1' }),
        ])
      );

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('prefers richer SDK task result over stale cached subagent result', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-subagent-merge',
          subagentData: {
            'task-merge-1': {
              id: 'task-merge-1',
              description: 'Recovered subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Short stale result',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-merge',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-merge-1',
                name: 'Task',
                input: { description: 'Do sub task', run_in_background: true },
                status: 'completed',
                result: 'Full SDK result from queue-operation',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-merge-1', mode: 'async' }] as any,
          } as any,
        ],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-merge-1');

      expect(loadSpy).toHaveBeenCalledWith(
        expect.any(String),
        'session-subagent-merge',
        undefined,
        getMockSdkSessionPath('session-subagent-merge')
      );
      expect(taskTool?.result).toBe('Full SDK result from queue-operation');
      expect(taskTool?.subagent?.result).toBe('Full SDK result from queue-operation');

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('keeps the richer cached async result when both SDK and cache are terminal', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-subagent-cache-richer',
          subagentData: {
            'task-merge-2': {
              id: 'task-merge-2',
              description: 'Recovered subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered final result with full details',
              toolCalls: [],
              isExpanded: false,
              agentId: 'agent-cache-richer',
            } as any,
          },
        },
        messages: [],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          {
            id: 'assistant-cache-richer',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-merge-2',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'completed',
                result: 'Short SDK result',
                subagent: {
                  id: 'task-merge-2',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'completed',
                  status: 'completed',
                  result: 'Short SDK result',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-cache-richer',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-merge-2', mode: 'async' }] as any,
          } as any,
        ],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-merge-2');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Recovered final result with full details');
      expect(taskTool?.subagent?.result).toBe('Recovered final result with full details');

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('drops stale asyncStatus from cached sync subagents during recovery', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-sync-subagent-cleanup',
          subagentData: {
            'task-sync-1': {
              id: 'task-sync-1',
              description: 'Recovered sync subagent',
              mode: 'sync',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered sync result',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-sync',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-sync-1',
                name: 'Task',
                input: { description: 'Do sync task' },
                status: 'completed',
                result: 'Sync result',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-sync-1', mode: 'sync' }] as any,
          } as any,
        ],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-sync-1');

      expect(taskTool?.subagent?.mode).toBe('sync');
      expect(taskTool?.subagent?.asyncStatus).toBeUndefined();

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('prefers terminal SDK async status over stale cached running state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-async-sdk-terminal',
          subagentData: {
            'task-async-sdk-terminal': {
              id: 'task-async-sdk-terminal',
              description: 'Cached async subagent',
              mode: 'async',
              asyncStatus: 'running',
              status: 'running',
              result: 'Still running',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          {
            id: 'assistant-sdk-terminal',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-sdk-terminal',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'completed',
                result: 'Full SDK final result',
                subagent: {
                  id: 'task-async-sdk-terminal',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'completed',
                  status: 'completed',
                  result: 'Full SDK final result',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-sdk-terminal',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-sdk-terminal', mode: 'async' }] as any,
          } as any,
        ],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-sdk-terminal');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Full SDK final result');
      expect(taskTool?.subagent?.status).toBe('completed');
      expect(taskTool?.subagent?.asyncStatus).toBe('completed');
      expect(taskTool?.subagent?.result).toBe('Full SDK final result');

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('prefers cached terminal async status over SDK launch-only running state', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-async-cache-terminal',
          subagentData: {
            'task-async-cache-terminal': {
              id: 'task-async-cache-terminal',
              description: 'Cached async subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered final result',
              toolCalls: [],
              isExpanded: false,
              agentId: 'agent-cache-terminal',
            } as any,
          },
        },
        messages: [],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [
          {
            id: 'assistant-sdk-running',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-cache-terminal',
                name: 'Task',
                input: { description: 'SDK async subagent', run_in_background: true },
                status: 'running',
                result: 'Task launched in background.',
                subagent: {
                  id: 'task-async-cache-terminal',
                  description: 'SDK async subagent',
                  mode: 'async',
                  asyncStatus: 'running',
                  status: 'running',
                  result: 'Task launched in background.',
                  toolCalls: [],
                  isExpanded: false,
                  agentId: 'agent-cache-terminal',
                },
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-cache-terminal', mode: 'async' }] as any,
          } as any,
        ],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-cache-terminal');

      expect(taskTool?.status).toBe('completed');
      expect(taskTool?.result).toBe('Recovered final result');
      expect(taskTool?.subagent?.status).toBe('completed');
      expect(taskTool?.subagent?.asyncStatus).toBe('completed');
      expect(taskTool?.subagent?.result).toBe('Recovered final result');

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('restores async subagent data and mode when Task tool exists but async block is missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-async-subagent-recovery',
          subagentData: {
            'task-async-1': {
              id: 'task-async-1',
              description: 'Recovered async subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered async result',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-1',
                name: 'Task',
                input: { description: 'Do background task', run_in_background: true },
                status: 'completed',
                result: 'Task started',
              } as any,
            ],
            contentBlocks: [{ type: 'text', content: 'Started' }] as any,
          } as any,
        ],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const block = loaded?.messages[0].contentBlocks?.find(
        (b: any) => b.type === 'subagent' && b.subagentId === 'task-async-1'
      ) as any;

      expect(loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-1')).toEqual(
        expect.objectContaining({
          id: 'task-async-1',
          subagent: expect.objectContaining({
            id: 'task-async-1',
            mode: 'async',
            asyncStatus: 'completed',
          }),
        })
      );
      expect(block).toEqual(
        expect.objectContaining({ type: 'subagent', subagentId: 'task-async-1', mode: 'async' })
      );

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('hydrates async subagent tool calls from SDK subagent files on reload', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-async-subagent-tools',
          subagentData: {
            'task-async-tools': {
              id: 'task-async-tools',
              description: 'Recovered async subagent',
              mode: 'async',
              asyncStatus: 'completed',
              status: 'completed',
              result: 'Recovered async result',
              agentId: 'agent-a123',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 1000,
            toolCalls: [
              {
                id: 'task-async-tools',
                name: 'Task',
                input: { description: 'Do background task', run_in_background: true },
                status: 'completed',
                result: 'Task started',
              } as any,
            ],
            contentBlocks: [{ type: 'subagent', subagentId: 'task-async-tools', mode: 'async' }] as any,
          } as any,
        ],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });
      const loadSubagentToolsSpy = jest.spyOn(sdkSession, 'loadSubagentToolCalls').mockResolvedValue([
        {
          id: 'sub-tool-1',
          name: 'Bash',
          input: { command: 'ls' },
          status: 'completed',
          result: 'ok',
          isExpanded: false,
        } as any,
      ]);

      const loaded = await plugin.getConversationById(conv.id);
      const taskTool = loaded?.messages[0].toolCalls?.find(tc => tc.id === 'task-async-tools');

      expect(loadSubagentToolsSpy).toHaveBeenCalledWith(
        expect.any(String),
        'session-async-subagent-tools',
        'agent-a123',
        getMockSdkSessionPath('session-async-subagent-tools')
      );
      expect(taskTool?.subagent?.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'sub-tool-1',
            name: 'Bash',
            result: 'ok',
          }),
        ])
      );

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
      loadSubagentToolsSpy.mockRestore();
    });

    it('keeps async subagent renderer visible when task block and task tool call are both missing', async () => {
      await plugin.onload();

      const conv = await plugin.createConversation({ providerId: 'claude' });
      await plugin.updateConversation(conv.id, {
        providerState: {
          providerSessionId: 'session-async-subagent-fallback',
          subagentData: {
            'task-async-orphan': {
              id: 'task-async-orphan',
              description: 'Recovered async orphan subagent',
              mode: 'async',
              asyncStatus: 'running',
              status: 'running',
              result: 'Running in background',
              toolCalls: [],
              isExpanded: false,
            } as any,
          },
        },
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Background work started',
            timestamp: 1000,
            contentBlocks: [{ type: 'text', content: 'Background work started' }] as any,
          } as any,
        ],
      });

      const locationsSpy = mockLocatedSdkSessions();
      const loadSpy = jest.spyOn(sdkSession, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        skippedLines: 0,
      });

      const loaded = await plugin.getConversationById(conv.id);
      const assistant = loaded?.messages.find(m => m.id === 'assistant-1');
      const block = assistant?.contentBlocks?.find(
        (b: any) => b.type === 'subagent' && b.subagentId === 'task-async-orphan'
      ) as any;

      expect(assistant?.toolCalls?.find((tc: any) => tc.id === 'task-async-orphan')).toEqual(
        expect.objectContaining({
          id: 'task-async-orphan',
          name: TOOL_SUBAGENT,
          subagent: expect.objectContaining({
            id: 'task-async-orphan',
            mode: 'async',
            asyncStatus: 'running',
          }),
        })
      );
      expect(block).toEqual(
        expect.objectContaining({
          type: 'subagent',
          subagentId: 'task-async-orphan',
          mode: 'async',
        })
      );

      locationsSpy.mockRestore();
      loadSpy.mockRestore();
    });
  });

});
