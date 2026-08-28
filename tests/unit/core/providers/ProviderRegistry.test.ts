import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { CodexExecution } from '@/app/execution/codex/CodexExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import {
  DEFAULT_CHAT_PROVIDER_ID,
} from '@/core/providers/types';
import { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';

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
    const caps = providerCatalog().capabilities(DEFAULT_CHAT_PROVIDER_ID);
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

  it('throws when an unknown provider is requested', () => {
    // Was asked of `getChatUIConfig` and then of `getSettingsReconciler`, both
    // of which their rows took with them. Any accessor proves the same thing —
    // that an unregistered id is refused rather than answered — so it follows
    // whichever one is still here.
    expect(() => ProviderRegistry.getConversationHistoryService(
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
    const caps = providerCatalog().capabilities('codex');
    expect(caps.providerId).toBe('codex');
    expect(caps.supportsPlanMode).toBe(true);
    expect(caps.supportsFork).toBe(true);
    expect(caps.supportsInstructionMode).toBe(true);
    expect(caps.supportsRewind).toBe(false);
    expect(caps.reasoningControl).toBe('effort');
  });

  it('returns OpenCode capabilities', () => {
    const caps = providerCatalog().capabilities('opencode');
    expect(caps.providerId).toBe('opencode');
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsInstructionMode).toBe(true);
    expect(caps.supportsFork).toBe(false);
  });

  it('returns Qwen Code ACP capabilities without unsupported controls', () => {
    const caps = providerCatalog().capabilities('qwen');
    expect(caps.providerId).toBe('qwen');
    expect(caps.supportsPersistentRuntime).toBe(true);
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsPlanMode).toBe(true);
    expect(caps.supportsMcpTools).toBe(false);
    expect(caps.supportsFork).toBe(false);
    expect(caps.supportsRewind).toBe(false);
    expect(caps.reasoningControl).toBe('effort');
  });

  it('filters enabled provider ids using registration metadata', () => {
    expect(providerCatalog().enabledIds({
      providerConfigs: {
        claude: { enabled: false },
        codex: { enabled: false },
      },
    })).toEqual([]);
    expect(providerCatalog().enabledIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: false },
      },
    })).toEqual(['claude']);
    expect(providerCatalog().enabledIds({
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: true },
      },
    })).toEqual(['claude', 'codex']);
    expect(providerCatalog().enabledIds({
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

  it('refuses a registration for a provider the catalog does not hold', () => {
    // The registry is no longer an inventory. A registration for an id the
    // catalog never heard of used to create a tenth provider that appeared in
    // nothing and answered for nothing.
    expect(() => ProviderRegistry.register('ghost', {} as never))
      .toThrow('Provider "ghost" is not in the catalog.');
  });

  it('routes enablement updates through every provider registration', () => {
    const settings: Record<string, unknown> = {};

    for (const providerId of providerCatalog().ids()) {
      providerCatalog().setEnabled(settings, providerId, true);
      expect(providerCatalog().isEnabled(settings, providerId)).toBe(true);
      providerCatalog().setEnabled(settings, providerId, false);
      expect(providerCatalog().isEnabled(settings, providerId)).toBe(false);
    }
  });
});
