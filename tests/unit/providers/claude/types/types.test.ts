import type {
  ChatMessage,
  Conversation,
  ConversationMeta,
  EnvSnippet,
  StreamChunk,
  ToolCallInfo
} from '@/core/types';
import {
  VIEW_TYPE_GRIMOIRE
} from '@/core/types';
import type { GrimoireSettings } from '@/core/types/settings';
import { getClaudeProviderSettings } from '@/providers/claude/settings';
import {
  CONTEXT_WINDOW_1M,
  CONTEXT_WINDOW_STANDARD,
  getContextWindowSize,
  normalizeEffortLevel,
  resolveClaudeContextWindowSize,
  supportsXHighEffort,
} from '@/providers/claude/types/models';
import {
  createPermissionRule,
  DEFAULT_SETTINGS,
  parseCCPermissionRule,
} from '@/providers/claude/types/settings';

describe('types.ts', () => {
  describe('VIEW_TYPE_GRIMOIRE', () => {
    it('should be defined as the correct view type', () => {
      expect(VIEW_TYPE_GRIMOIRE).toBe('grimoire-view');
    });
  });

  describe('DEFAULT_SETTINGS', () => {
    it('should default to normal permission mode', () => {
      expect(DEFAULT_SETTINGS.permissionMode).toBe('normal');
    });

    it('should have sharedEnvironmentVariables as empty string by default', () => {
      expect(DEFAULT_SETTINGS.sharedEnvironmentVariables).toBe('');
    });

    it('should have envSnippets as empty array by default', () => {
      expect(DEFAULT_SETTINGS.envSnippets).toEqual([]);
    });

    it('should have custom model aliases as an empty map by default', () => {
      expect(DEFAULT_SETTINGS.customModelAliases).toEqual({});
    });

    it('should have lastClaudeModel set to haiku by default', () => {
      expect(getClaudeProviderSettings(DEFAULT_SETTINGS).lastModel).toBe('haiku');
    });

    it('should keep Claude opt-in by default', () => {
      expect(getClaudeProviderSettings(DEFAULT_SETTINGS).enabled).toBe(false);
    });

    it('should have empty custom Claude models by default', () => {
      expect(getClaudeProviderSettings(DEFAULT_SETTINGS).customModels).toBe('');
    });

    it('should respect Claude Code settings by default', () => {
      expect(getClaudeProviderSettings(DEFAULT_SETTINGS).respectProjectSettings).toBe(true);
    });

    it('should have lastCustomModel as empty string by default', () => {
      expect(DEFAULT_SETTINGS.lastCustomModel).toBe('');
    });
  });

  describe('GrimoireSettings type', () => {
    it('should be assignable with valid settings', () => {
      const settings: GrimoireSettings = {
        userName: '',
        model: 'haiku',
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        thinkingBudget: 'off',
        serviceTier: 'default',
        permissionMode: 'full_access',
        excludedTags: [],
        excludedFolders: [],
        mediaFolder: '',
        sharedEnvironmentVariables: '',
        envSnippets: [],
        customContextLimits: {},
        customModelAliases: {},
        systemPrompt: '',

        persistentExternalContextPaths: [],
        contextEngine: {
          vaultSearchEnabled: true,
          vaultSearchMaxResults: 8,
          vaultSearchMaxSnippetChars: 700,
          relevantNotesEnabled: true,
          relevantNotesMaxResults: 6,
          projectWorkspaces: [],
          activeProjectWorkspaceId: '',
        },
        keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
        requireCommandOrControlEnterToSend: false,
        advancedSectionsOpen: {},
        usageIndicatorsEnabled: true,
        debugLoggingEnabled: false,
        lastSeenChangelogVersion: '',
        locale: 'en',
        providerConfigs: {},
        claudeCliPath: '',
        claudeCliPathsByHost: {},
        maxTabs: 3,
        enableChrome: false,
        enableBangBash: false,
        tabBarPosition: 'header',
        enableAutoScroll: true,
        deferMathRenderingDuringStreaming: true,
        chatViewPlacement: 'right-sidebar',
        hiddenProviderCommands: {
          claude: [],
          codex: [],
        },
        effortLevel: 'high',
        settingsProvider: 'claude',
        codexEnabled: false,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      expect(settings.permissionMode).toBe('full_access');
      expect(settings.model).toBe('haiku');
    });

    it('should accept custom model strings', () => {
      const settings: GrimoireSettings = {
        userName: '',
        model: 'anthropic/custom-model-v1',
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        thinkingBudget: 'medium',
        serviceTier: 'default',
        permissionMode: 'normal',
        excludedTags: ['private'],
        excludedFolders: ['Archive'],
        mediaFolder: 'attachments',
        sharedEnvironmentVariables: 'API_KEY=test',
        envSnippets: [],
        customContextLimits: {},
        customModelAliases: {},
        systemPrompt: '',

        persistentExternalContextPaths: [],
        contextEngine: {
          vaultSearchEnabled: true,
          vaultSearchMaxResults: 8,
          vaultSearchMaxSnippetChars: 700,
          relevantNotesEnabled: true,
          relevantNotesMaxResults: 6,
          projectWorkspaces: [],
          activeProjectWorkspaceId: '',
        },
        keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
        requireCommandOrControlEnterToSend: false,
        advancedSectionsOpen: {},
        usageIndicatorsEnabled: true,
        debugLoggingEnabled: false,
        lastSeenChangelogVersion: '',
        locale: 'zh-CN',
        providerConfigs: {},
        claudeCliPath: '',
        claudeCliPathsByHost: {},
        maxTabs: 3,
        enableChrome: false,
        enableBangBash: false,
        tabBarPosition: 'header',
        enableAutoScroll: true,
        deferMathRenderingDuringStreaming: true,
        chatViewPlacement: 'right-sidebar',
        hiddenProviderCommands: {
          claude: [],
          codex: [],
        },
        effortLevel: 'high',
        settingsProvider: 'claude',
        codexEnabled: false,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      expect(settings.model).toBe('anthropic/custom-model-v1');
    });

    it('should accept optional lastClaudeModel and lastCustomModel', () => {
      const settings: GrimoireSettings = {
        userName: '',
        model: 'sonnet',
        enableAutoTitleGeneration: true,
        titleGenerationModel: '',
        lastClaudeModel: 'opus',
        lastCustomModel: 'custom/model',
        thinkingBudget: 'high',
        serviceTier: 'default',
        permissionMode: 'full_access',
        excludedTags: [],
        excludedFolders: [],
        mediaFolder: '',
        sharedEnvironmentVariables: '',
        envSnippets: [],
        customContextLimits: {},
        customModelAliases: {},
        systemPrompt: '',

        persistentExternalContextPaths: [],
        contextEngine: {
          vaultSearchEnabled: true,
          vaultSearchMaxResults: 8,
          vaultSearchMaxSnippetChars: 700,
          relevantNotesEnabled: true,
          relevantNotesMaxResults: 6,
          projectWorkspaces: [],
          activeProjectWorkspaceId: '',
        },
        keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
        requireCommandOrControlEnterToSend: true,
        advancedSectionsOpen: {},
        usageIndicatorsEnabled: true,
        debugLoggingEnabled: false,
        lastSeenChangelogVersion: '',
        locale: 'en',
        providerConfigs: {},
        claudeCliPath: '',
        claudeCliPathsByHost: {},
        maxTabs: 5,
        enableChrome: false,
        enableBangBash: false,
        tabBarPosition: 'header',
        enableAutoScroll: false,
        deferMathRenderingDuringStreaming: true,
        chatViewPlacement: 'right-sidebar',
        hiddenProviderCommands: {
          claude: [],
          codex: [],
        },
        effortLevel: 'high',
        settingsProvider: 'claude',
        codexEnabled: false,
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      expect(settings.lastClaudeModel).toBe('opus');
      expect(settings.lastCustomModel).toBe('custom/model');
    });
  });

  describe('EnvSnippet type', () => {
    it('should store all required fields', () => {
      const snippet: EnvSnippet = {
        id: 'snippet-123',
        name: 'Production Config',
        description: 'Production environment variables',
        envVars: 'API_KEY=prod-key\nDEBUG=false',
        modelAliases: {
          'custom-model': 'Production model',
        },
      };

      expect(snippet.id).toBe('snippet-123');
      expect(snippet.name).toBe('Production Config');
      expect(snippet.description).toBe('Production environment variables');
      expect(snippet.envVars).toContain('API_KEY=prod-key');
      expect(snippet.modelAliases?.['custom-model']).toBe('Production model');
    });

    it('should allow empty description', () => {
      const snippet: EnvSnippet = {
        id: 'snippet-789',
        name: 'Quick Config',
        description: '',
        envVars: 'KEY=value',
      };

      expect(snippet.description).toBe('');
    });
  });

  describe('ChatMessage type', () => {
    it('should accept user role', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      expect(msg.role).toBe('user');
    });

    it('should accept assistant role', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now(),
      };

      expect(msg.role).toBe('assistant');
    });

    it('should accept optional toolCalls array', () => {
      const toolCalls: ToolCallInfo[] = [
        {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: '/test.txt' },
          status: 'completed',
          result: 'file contents',
        },
      ];

      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Reading file...',
        timestamp: Date.now(),
        toolCalls,
      };

      expect(msg.toolCalls).toEqual(toolCalls);
    });
  });

  describe('ToolCallInfo type', () => {
    it('should store tool name, input, status, and result', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-123',
        name: 'Bash',
        input: { command: 'ls -la' },
        status: 'completed',
        result: 'file1.txt\nfile2.txt',
      };

      expect(toolCall.id).toBe('tool-123');
      expect(toolCall.name).toBe('Bash');
      expect(toolCall.input).toEqual({ command: 'ls -la' });
      expect(toolCall.status).toBe('completed');
      expect(toolCall.result).toBe('file1.txt\nfile2.txt');
    });

    it('should accept running status', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
        status: 'running',
      };

      expect(toolCall.status).toBe('running');
    });

    it('should accept error status', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
        status: 'error',
        result: 'File not found',
      };

      expect(toolCall.status).toBe('error');
    });
  });

  describe('StreamChunk type', () => {
    it('should accept text type', () => {
      const chunk: StreamChunk = {
        type: 'text',
        content: 'Hello world',
      };

      expect(chunk.type).toBe('text');
      // eslint-disable-next-line jest/no-conditional-expect
      if (chunk.type === 'text') expect(chunk.content).toBe('Hello world');
    });

    it('should accept tool_use type', () => {
      const chunk: StreamChunk = {
        type: 'tool_use',
        id: 'tool-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
      };

      expect(chunk.type).toBe('tool_use');
      if (chunk.type === 'tool_use') {
        // Type narrowing block - eslint-disable-next-line jest/no-conditional-expect
        expect(chunk.id).toBe('tool-123'); // eslint-disable-line jest/no-conditional-expect
        expect(chunk.name).toBe('Read'); // eslint-disable-line jest/no-conditional-expect
        expect(chunk.input).toEqual({ file_path: '/test.txt' }); // eslint-disable-line jest/no-conditional-expect
      }
    });

    it('should accept tool_result type', () => {
      const chunk: StreamChunk = {
        type: 'tool_result',
        id: 'tool-123',
        content: 'File contents here',
      };

      expect(chunk.type).toBe('tool_result');
      if (chunk.type === 'tool_result') {
        expect(chunk.id).toBe('tool-123'); // eslint-disable-line jest/no-conditional-expect
        expect(chunk.content).toBe('File contents here'); // eslint-disable-line jest/no-conditional-expect
      }
    });

    it('should accept error type', () => {
      const chunk: StreamChunk = {
        type: 'error',
        content: 'Something went wrong',
      };

      expect(chunk.type).toBe('error');
      // eslint-disable-next-line jest/no-conditional-expect
      if (chunk.type === 'error') expect(chunk.content).toBe('Something went wrong');
    });

    it('should accept warning notice type', () => {
      const chunk: StreamChunk = {
        type: 'notice',
        content: 'Command blocked: rm -rf',
        level: 'warning',
      };

      expect(chunk.type).toBe('notice');
      // eslint-disable-next-line jest/no-conditional-expect
      if (chunk.type === 'notice') expect(chunk.content).toBe('Command blocked: rm -rf');
    });

  });

  describe('Conversation type', () => {
    it('should store conversation with all required fields', () => {
      const conversation: Conversation = {
        id: 'conv-123',
        providerId: 'claude',
        title: 'Test Conversation',
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        sessionId: 'session-abc',
        messages: [],
      };

      expect(conversation.id).toBe('conv-123');
      expect(conversation.title).toBe('Test Conversation');
      expect(conversation.createdAt).toBe(1700000000000);
      expect(conversation.updatedAt).toBe(1700000001000);
      expect(conversation.sessionId).toBe('session-abc');
      expect(conversation.messages).toEqual([]);
    });

    it('should allow null sessionId for new conversations', () => {
      const conversation: Conversation = {
        id: 'conv-456',
        providerId: 'claude',
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: null,
        messages: [],
      };

      expect(conversation.sessionId).toBeNull();
    });

    it('should store messages array with ChatMessage objects', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      const conversation: Conversation = {
        id: 'conv-789',
        providerId: 'claude',
        title: 'Chat with Messages',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'session-xyz',
        messages,
      };

      expect(conversation.messages).toHaveLength(2);
      expect(conversation.messages[0].role).toBe('user');
      expect(conversation.messages[1].role).toBe('assistant');
    });
  });

  describe('ConversationMeta type', () => {
    it('should store conversation metadata without messages', () => {
      const meta: ConversationMeta = {
        id: 'conv-123',
        providerId: 'claude',
        title: 'Test Conversation',
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        messageCount: 5,
        preview: 'Hello, how can I...',
      };

      expect(meta.id).toBe('conv-123');
      expect(meta.title).toBe('Test Conversation');
      expect(meta.createdAt).toBe(1700000000000);
      expect(meta.updatedAt).toBe(1700000001000);
      expect(meta.messageCount).toBe(5);
      expect(meta.preview).toBe('Hello, how can I...');
    });

    it('should have preview for empty conversations', () => {
      const meta: ConversationMeta = {
        id: 'conv-empty',
        providerId: 'claude',
        title: 'Empty Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        preview: 'New conversation',
      };

      expect(meta.messageCount).toBe(0);
      expect(meta.preview).toBe('New conversation');
    });
  });

  describe('Permission Conversion Utilities', () => {
    describe('parseCCPermissionRule', () => {
      it('should parse rule with pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('Bash(git status)'));
        expect(result.tool).toBe('Bash');
        expect(result.pattern).toBe('git status');
      });

      it('should parse rule with complex pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('WebFetch(domain:github.com)'));
        expect(result.tool).toBe('WebFetch');
        expect(result.pattern).toBe('domain:github.com');
      });

      it('should parse rule without pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('Read'));
        expect(result.tool).toBe('Read');
        expect(result.pattern).toBeUndefined();
      });

      it('should handle nested parentheses in pattern', () => {
        const result = parseCCPermissionRule(createPermissionRule('Bash(echo "hello (world)")'));
        expect(result.tool).toBe('Bash');
        expect(result.pattern).toBe('echo "hello (world)"');
      });

      it('should handle path patterns', () => {
        const result = parseCCPermissionRule(createPermissionRule('Read(/Users/test/vault/notes)'));
        expect(result.tool).toBe('Read');
        expect(result.pattern).toBe('/Users/test/vault/notes');
      });

      it('should return rule as tool for malformed input', () => {
        const result = parseCCPermissionRule(createPermissionRule('not-valid-format'));
        expect(result.tool).toBe('not-valid-format');
        expect(result.pattern).toBeUndefined();
      });
    });
  });

  describe('getContextWindowSize', () => {
    it('should return standard context window by default', () => {
      expect(getContextWindowSize('sonnet')).toBe(CONTEXT_WINDOW_STANDARD);
      expect(getContextWindowSize('opus')).toBe(CONTEXT_WINDOW_STANDARD);
      expect(getContextWindowSize('haiku')).toBe(CONTEXT_WINDOW_STANDARD);
    });

    it('should use custom limits when provided', () => {
      const customLimits = { 'custom-model': 256000 };
      expect(getContextWindowSize('custom-model', customLimits)).toBe(256000);
    });

    it('should fall back to default when model not in custom limits', () => {
      const customLimits = { 'other-model': 256000 };
      expect(getContextWindowSize('sonnet', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
    });

    it('should handle empty custom limits object', () => {
      expect(getContextWindowSize('sonnet', {})).toBe(CONTEXT_WINDOW_STANDARD);
    });

    it('should handle undefined custom limits', () => {
      expect(getContextWindowSize('sonnet', undefined)).toBe(CONTEXT_WINDOW_STANDARD);
    });

    describe('defensive validation for invalid custom limit values', () => {
      it('should fall back to default for NaN custom limit', () => {
        const customLimits = { 'custom-model': NaN };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for negative custom limit', () => {
        const customLimits = { 'custom-model': -100000 };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for zero custom limit', () => {
        const customLimits = { 'custom-model': 0 };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for Infinity custom limit', () => {
        const customLimits = { 'custom-model': Infinity };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should fall back to default for -Infinity custom limit', () => {
        const customLimits = { 'custom-model': -Infinity };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(CONTEXT_WINDOW_STANDARD);
      });

      it('should accept valid positive custom limit', () => {
        const customLimits = { 'custom-model': 256000 };
        expect(getContextWindowSize('custom-model', customLimits)).toBe(256000);
      });
    });

    describe('[1m] suffix detection', () => {
      it('should return 1M context window for models with [1m] suffix', () => {
        expect(getContextWindowSize('opus[1m]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('sonnet[1m]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should treat [1M] and [1m] suffixes equivalently', () => {
        expect(getContextWindowSize('opus[1M]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-opus-4-6[1M]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-sonnet-4-6[1M]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should return 1M for full model IDs with [1m] suffix', () => {
        expect(getContextWindowSize('claude-opus-4-6[1m]')).toBe(CONTEXT_WINDOW_1M);
        expect(getContextWindowSize('claude-sonnet-4-6[1m]')).toBe(CONTEXT_WINDOW_1M);
      });

      it('should prefer custom limits over [1m] suffix', () => {
        const customLimits = { 'opus[1m]': 500000 };
        expect(getContextWindowSize('opus[1m]', customLimits)).toBe(500000);
      });

      it('should match custom limits case-insensitively for [1M] suffixes', () => {
        const customLimits = { 'claude-opus-4-6[1m]': 500000 };
        expect(getContextWindowSize('claude-opus-4-6[1M]', customLimits)).toBe(500000);
      });

      it('should return standard for models without [1m] suffix', () => {
        expect(getContextWindowSize('opus')).toBe(CONTEXT_WINDOW_STANDARD);
        expect(getContextWindowSize('sonnet')).toBe(CONTEXT_WINDOW_STANDARD);
      });
    });

    describe('dynamic discovery', () => {
      it('prioritizes selected and resolved custom limits over discovery', () => {
        const discoveredModels = [{
          id: 'sonnet',
          resolvedModel: 'claude-sonnet-5',
          maxInputTokens: 1_000_000,
        }];

        expect(resolveClaudeContextWindowSize(
          'sonnet',
          { sonnet: 750_000, 'claude-sonnet-5': 500_000 },
          discoveredModels,
        )).toBe(750_000);
        expect(resolveClaudeContextWindowSize(
          'sonnet',
          { 'claude-sonnet-5': 500_000 },
          discoveredModels,
        )).toBe(500_000);
      });

      it('uses discovered limits before the narrow Sonnet 5 capability fallback', () => {
        expect(resolveClaudeContextWindowSize('sonnet', undefined, [{
          id: 'sonnet',
          resolvedModel: 'claude-sonnet-5',
          maxInputTokens: 400_000,
        }])).toBe(400_000);
        expect(resolveClaudeContextWindowSize('custom-alias', undefined, [{
          id: 'custom-alias',
          resolvedModel: 'claude-sonnet-5',
        }])).toBe(CONTEXT_WINDOW_1M);
      });
    });

  });

  describe('supportsXHighEffort', () => {
    it('returns true for opus aliases and 4.7+ opus ids', () => {
      expect(supportsXHighEffort('opus')).toBe(true);
      expect(supportsXHighEffort('opus[1m]')).toBe(true);
      expect(supportsXHighEffort('opus[1M]')).toBe(true);
      expect(supportsXHighEffort('claude-opus-4-7')).toBe(true);
      expect(supportsXHighEffort('claude-opus-5')).toBe(true);
    });

    it('returns false for non-opus models and older opus ids', () => {
      expect(supportsXHighEffort('sonnet')).toBe(false);
      expect(supportsXHighEffort('claude-sonnet-4-5')).toBe(false);
      expect(supportsXHighEffort('claude-opus-4-6')).toBe(false);
    });
  });

  describe('normalizeEffortLevel', () => {
    it('preserves supported effort levels', () => {
      expect(normalizeEffortLevel('claude-opus-4-7', 'xhigh')).toBe('xhigh');
    });

    it('never permits max without explicit runtime metadata', () => {
      expect(normalizeEffortLevel('claude-sonnet-4-5', 'max')).toBe('high');
      expect(normalizeEffortLevel('haiku', 'max')).toBe('high');
      expect(normalizeEffortLevel('claude-opus-4-7', 'max')).toBe('high');
    });

    it('clamps unsupported xhigh values to the model default', () => {
      expect(normalizeEffortLevel('claude-sonnet-4-5', 'xhigh')).toBe('high');
      expect(normalizeEffortLevel('haiku', 'xhigh')).toBe('high');
    });

    it('falls back to high for unknown or missing effort values', () => {
      expect(normalizeEffortLevel('claude-sonnet-4-5', 'invalid')).toBe('high');
      expect(normalizeEffortLevel('claude-sonnet-4-5', undefined)).toBe('high');
    });

    it('prefers the model default when dynamic effort metadata supports it', () => {
      expect(normalizeEffortLevel(
        'default',
        'invalid',
        ['low', 'medium', 'high', 'xhigh', 'max'],
      )).toBe('high');
    });

    it('preserves max only when dynamic metadata explicitly supports it', () => {
      expect(normalizeEffortLevel(
        'claude-sonnet-5',
        'max',
        ['low', 'medium', 'high', 'xhigh', 'max'],
      )).toBe('max');
    });

    it('clamps max when dynamic metadata excludes it', () => {
      expect(normalizeEffortLevel(
        'claude-sonnet-5',
        'max',
        ['low', 'medium', 'high'],
      )).toBe('high');
    });
  });
});
