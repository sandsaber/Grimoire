import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { NO_TASK_RESULT_INTERPRETATION } from '@/core/providers/noTaskResultInterpretation';
import { providerCatalog } from '@/core/providers/ProviderCatalog';
import {
  DEFAULT_CHAT_PROVIDER_ID,
} from '@/core/providers/types';
import { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { CodexExecution } from '@/providers/codex/execution/CodexExecutionComposition';

describe('reading a provider\'s contributions through the catalog', () => {
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

  it('returns capabilities for the default provider', () => {
    const caps = providerCatalog().capabilities(DEFAULT_CHAT_PROVIDER_ID);
    expect(caps.providerId).toBe('codex');
    expect(caps).toHaveProperty('supportsPlanMode');
    expect(caps).toHaveProperty('supportsFork');
  });

  it('returns boundary services for the default provider', () => {
    // The default provider is Codex, which declares no async task interpreter,
    // so what this has always exercised is the absence being read as
    // `NO_TASK_RESULT_INTERPRETATION` — the registry accessor applied that
    // fallback itself, and the call site does now.
    const taskInterpreter = providerCatalog()
      .declarations(DEFAULT_CHAT_PROVIDER_ID).asyncTaskResults
      ?? NO_TASK_RESULT_INTERPRETATION;
    expect(taskInterpreter).toHaveProperty('resolveTerminalStatus');
  });

  it('throws when an unknown provider is requested', () => {
    // Asked of `getChatUIConfig`, then `getSettingsReconciler`, then
    // `getConversationHistoryService`, then the registry's last accessor,
    // each of which its row took with it. The registry is deleted, so it is
    // the catalog that refuses now — which is the same guarantee, asked of
    // the one inventory that is left.
    expect(() => providerCatalog().declarations(
      'nonexistent',
    )).toThrow('nonexistent');
  });

  it('creates a Codex runtime, over the execution kernel', () => {
    // The flip, asked of the composition: a runtime that is not a client of the
    // kernel means Codex chat execution never left the legacy path, which no
    // other assertion in this file would notice. It was asked of the registry
    // until the factory row left it — the registration carried a
    // `createRuntime` that reached this same composition through a plugin.
    const runtime = pluginWithCodexExecution().getCodexExecution().createRuntime();

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
