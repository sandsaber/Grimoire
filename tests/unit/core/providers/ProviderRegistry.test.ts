import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { CodexExecution } from '@/app/execution/codex/CodexExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from '@/core/providers/types';
import { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';

describe('ProviderRegistry', () => {
  beforeEach(() => {
    ProviderWorkspaceRegistry.clear();
    ProviderWorkspaceRegistry.setServices('claude', {
      mcpManager: {} as any,
      mcpServerManager: {} as any,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * A plugin that can answer for its Codex execution.
   *
   * The default provider's chat execution runs through the kernel since the
   * flip, and the registration asks the plugin for the one composition per load
   * that the backend and every tab share.
   */
  function pluginWithCodexExecution(): any {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const plugin: any = { settings: {} };
    plugin.getCodexExecution = () => new CodexExecution(plugin, host.registry);
    return plugin;
  }

  it('creates a runtime with the default provider id', () => {
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: pluginWithCodexExecution(),
    });

    expect(runtime.providerId).toBe('codex');
  });

  it('returns capabilities for the default provider', () => {
    const caps = ProviderRegistry.getCapabilities();
    expect(caps.providerId).toBe('codex');
    expect(caps).toHaveProperty('supportsPlanMode');
    expect(caps).toHaveProperty('supportsFork');
  });

  it('returns boundary services for the default provider', () => {
    const historyService = ProviderRegistry.getConversationHistoryService();
    expect(historyService).toHaveProperty('hydrateConversationHistory');

    const taskInterpreter = ProviderRegistry.getTaskResultInterpreter();
    expect(taskInterpreter).toHaveProperty('resolveTerminalStatus');
  });

  it('returns a settings reconciler for the default provider', () => {
    const reconciler = ProviderRegistry.getSettingsReconciler();
    expect(reconciler).toHaveProperty('reconcileModelWithEnvironment');
    expect(reconciler).toHaveProperty('normalizeModelVariantSettings');
  });

  it('returns a chat UI config for the default provider', () => {
    const uiConfig = ProviderRegistry.getChatUIConfig();
    expect(uiConfig).toHaveProperty('getModelOptions');
    expect(uiConfig).toHaveProperty('getCustomModelIds');
  });

  it('throws when an unknown provider is requested', () => {
    expect(() => ProviderRegistry.getCapabilities(
      'nonexistent' as any,
    )).toThrow('Provider "nonexistent" is not registered.');
  });

  it('creates a Codex runtime, over the execution kernel', () => {
    // The flip, at the only row it moves: a runtime that is not a client of the
    // kernel means Codex chat execution never left the legacy path, which no
    // other assertion in this file would notice.
    const runtime = ProviderRegistry.createChatRuntime({
      providerId: 'codex',
      plugin: pluginWithCodexExecution(),
    });

    expect(runtime).toBeInstanceOf(ExecutionChatRuntimeAdapter);
    expect(runtime.providerId).toBe('codex');
  });

  it('returns Codex capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('codex');
    expect(caps.providerId).toBe('codex');
    expect(caps.supportsPlanMode).toBe(true);
    expect(caps.supportsFork).toBe(true);
    expect(caps.supportsInstructionMode).toBe(true);
    expect(caps.supportsRewind).toBe(false);
    expect(caps.reasoningControl).toBe('effort');
  });

  it('returns OpenCode capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('opencode');
    expect(caps.providerId).toBe('opencode');
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsInstructionMode).toBe(true);
    expect(caps.supportsFork).toBe(false);
  });

  it('returns Qwen Code ACP capabilities without unsupported controls', () => {
    const caps = ProviderRegistry.getCapabilities('qwen');
    expect(caps.providerId).toBe('qwen');
    expect(caps.supportsPersistentRuntime).toBe(true);
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsPlanMode).toBe(true);
    expect(caps.supportsMcpTools).toBe(false);
    expect(caps.supportsFork).toBe(false);
    expect(caps.supportsRewind).toBe(false);
    expect(caps.reasoningControl).toBe('effort');
  });

  it('lists registered provider ids in settings tab order', () => {
    expect(ProviderRegistry.getRegisteredProviderIds()).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'mimocode',
      'kimicode',
      'antigravity',
      'gemini',
      'qwen',
    ]);
  });

  it('filters enabled provider ids using registration metadata', () => {
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: false },
        codex: { enabled: false },
      },
    })).toEqual([]);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: false },
      },
    })).toEqual(['claude']);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: true },
      },
    })).toEqual(['claude', 'codex']);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: true },
        opencode: { enabled: true },
        grok: { enabled: true },
        antigravity: { enabled: true },
        gemini: { enabled: true },
        qwen: { enabled: true },
      },
    })).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'antigravity',
      'gemini',
      'qwen',
    ]);
  });

  it('returns the display name from provider registration metadata', () => {
    expect(ProviderRegistry.getProviderDisplayName('claude')).toBe('Claude');
    expect(ProviderRegistry.getProviderDisplayName('codex')).toBe('Codex');
  });

  it('validates opaque provider ids and preserves unknown display labels', () => {
    expect(ProviderRegistry.isRegisteredProviderId('grok')).toBe(true);
    expect(ProviderRegistry.isRegisteredProviderId('unknown')).toBe(false);
    expect(ProviderRegistry.isRegisteredProviderId(null)).toBe(false);
    expect(ProviderRegistry.getProviderDisplayNameOrId('mimocode')).toBe('MiMoCode');
    expect(ProviderRegistry.getProviderDisplayNameOrId('future-provider')).toBe('future-provider');
  });

  it('routes enablement updates through every provider registration', () => {
    const settings: Record<string, unknown> = {};

    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      ProviderRegistry.setEnabled(providerId, settings, true);
      expect(ProviderRegistry.isEnabled(providerId, settings)).toBe(true);
      ProviderRegistry.setEnabled(providerId, settings, false);
      expect(ProviderRegistry.isEnabled(providerId, settings)).toBe(false);
    }
  });

  it('exposes provider-owned preloaded context files without feature hardcoding', () => {
    expect(ProviderRegistry.getPreloadedContextFiles('grok')).toEqual([
      '.grimoire/grok/system.md',
    ]);
    expect(ProviderRegistry.getPreloadedContextFiles('claude')).toEqual([]);
  });

  it('routes auto title generation to the active settings provider', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService({
      settings: {
        titleGenerationModel: '',
        settingsProvider: 'codex',
        providerConfigs: {
          codex: { enabled: true },
        },
      },
    } as any);
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual(['codex']);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'codex title',
    });
  });

  it('routes explicit title model selections to the owning provider', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService({
      settings: {
        titleGenerationModel: DEFAULT_CODEX_PRIMARY_MODEL,
        providerConfigs: {
          codex: { enabled: true },
        },
      },
    } as any);
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual(['codex']);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'codex title',
    });
  });

  it('suppresses stale callbacks when a newer title generation replaces the old one', async () => {
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    const claudeService = createDeferredTitleService();
    const codexService = createMockTitleService('codex');

    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        return providerId === 'claude' ? claudeService : codexService;
      });

    const plugin = {
      settings: {
        titleGenerationModel: 'sonnet',
        providerConfigs: {
          codex: { enabled: true },
        },
      },
    } as any;
    const service = ProviderRegistry.createTitleGenerationService(plugin);
    const callback = jest.fn();

    const first = service.generateTitle('conv-1', 'first', callback);
    plugin.settings.titleGenerationModel = DEFAULT_CODEX_PRIMARY_MODEL;
    await service.generateTitle('conv-1', 'second', callback);
    await claudeService.resolve({ success: true, title: 'stale title' });
    await first;

    expect(claudeService.cancel).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'codex title',
    });
  });
});

function createMockTitleService(providerId: ProviderId): TitleGenerationService {
  return {
    cancel: jest.fn(),
    generateTitle: jest.fn(async (conversationId, _userMessage, callback) => {
      await callback(conversationId, {
        success: true,
        title: `${providerId} title`,
      });
    }),
  };
}

function createDeferredTitleService(): TitleGenerationService & {
  resolve: (result: TitleGenerationResult) => Promise<void>;
} {
  let callback: TitleGenerationCallback | null = null;
  let conversationId = '';
  let resolvePromise: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    cancel: jest.fn(),
    generateTitle: jest.fn(async (nextConversationId, _userMessage, nextCallback) => {
      conversationId = nextConversationId;
      callback = nextCallback;
      await done;
    }),
    resolve: async (result) => {
      await callback?.(conversationId, result);
      resolvePromise?.();
    },
  };
}
