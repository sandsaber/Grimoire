import '@/providers';

import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { Conversation } from '@/core/types';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from '@/providers/claude/settings';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';

describe('ProviderSettingsCoordinator', () => {
  describe('normalizeProviderSelection', () => {
    it('keeps the current registered provider when every provider is disabled', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        providerConfigs: {
          codex: { enabled: false },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(false);
      expect(settings.settingsProvider).toBe('codex');
    });

    it('falls back to the first enabled provider when the current provider is disabled', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        providerConfigs: {
          claude: { enabled: true },
          codex: { enabled: false },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(true);
      expect(settings.settingsProvider).toBe('claude');
    });

    it('falls back to the first enabled provider for unknown providers', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'mystery-provider',
        providerConfigs: {
          codex: { enabled: true },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(true);
      expect(settings.settingsProvider).toBe('codex');
    });

    it('returns false when already normalized (no-op)', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        providerConfigs: {
          codex: { enabled: true },
        },
      };
      expect(ProviderSettingsCoordinator.normalizeProviderSelection(settings)).toBe(false);
    });
  });

  describe('reconcileAllProviders', () => {
    it('delegates to each registered provider reconciler with its own conversations', () => {
      const settings: Record<string, unknown> = {
        model: 'haiku',
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
        },
      };
      const claudeConv = { providerId: 'claude', messages: [] } as unknown as Conversation;
      const conversations = [claudeConv];

      const result = ProviderSettingsCoordinator.reconcileAllProviders(settings, conversations);

      expect(result).toHaveProperty('changed');
      expect(result).toHaveProperty('invalidatedConversations');
      expect(Array.isArray(result.invalidatedConversations)).toBe(true);
    });

    // The reconciler no longer sees conversations at all: it answers whether
    // this provider's sessions survived, and the host applies that to its own
    // list. So what "per provider" means is which conversations get cleared,
    // which is what this asserts now rather than which list was passed in.
    it('clears only the conversations of the provider whose environment changed', () => {
      const claudeConv = {
        providerId: 'claude',
        messages: [],
        sessionId: 'claude-session',
      } as unknown as Conversation;
      const otherConv = {
        providerId: 'codex',
        messages: [],
        sessionId: 'codex-thread',
      } as unknown as Conversation;
      const settings: Record<string, unknown> = {
        model: 'haiku',
        settingsProvider: 'claude',
        sharedEnvironmentVariables: 'ANTHROPIC_BASE_URL=https://example.invalid\n',
        providerConfigs: {
          claude: { enabled: true },
        },
      };

      const { invalidatedConversations } = ProviderSettingsCoordinator
        .reconcileAllProviders(settings, [claudeConv, otherConv]);

      expect(invalidatedConversations).toEqual([claudeConv]);
      expect(claudeConv.sessionId).toBeNull();
      expect(otherConv.sessionId).toBe('codex-thread');
    });

    it('leaves a conversation that has no session binding out of the invalidated list', () => {
      // The caller writes one metadata file per entry, so a conversation with
      // nothing to clear must not appear: it would be a write per conversation
      // of the provider on every environment change.
      const bound = {
        providerId: 'claude',
        messages: [],
        sessionId: 'claude-session',
      } as unknown as Conversation;
      const unbound = { providerId: 'claude', messages: [] } as unknown as Conversation;
      const settings: Record<string, unknown> = {
        model: 'haiku',
        settingsProvider: 'claude',
        sharedEnvironmentVariables: 'ANTHROPIC_BASE_URL=https://example.invalid\n',
        providerConfigs: { claude: { enabled: true } },
      };

      const { invalidatedConversations } = ProviderSettingsCoordinator
        .reconcileAllProviders(settings, [bound, unbound]);

      expect(invalidatedConversations).toEqual([bound]);
    });
  });

  describe('normalizeAllModelVariants', () => {
    it('delegates to registered providers', () => {
      const settings: Record<string, unknown> = {
        model: 'haiku',
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
        },
      };
      const result = ProviderSettingsCoordinator.normalizeAllModelVariants(settings);
      expect(typeof result).toBe('boolean');
    });

    it('migrates the active Codex primary model when an older built-in value is persisted', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        model: 'gpt-5.2',
        providerConfigs: {
          codex: { enabled: true },
        },
        savedProviderModel: { codex: 'gpt-5.2' },
      };

      expect(ProviderSettingsCoordinator.normalizeAllModelVariants(settings)).toBe(true);
      expect(settings.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(settings.savedProviderModel).toEqual({ codex: DEFAULT_CODEX_PRIMARY_MODEL });
    });
  });

  describe('reconcileTitleGenerationModelSelection', () => {
    it('keeps custom title models while they are still available', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'claude-opus-4-6',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            customModels: 'claude-opus-4-6',
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(false);
      expect(settings.titleGenerationModel).toBe('claude-opus-4-6');
    });

    it('clears titleGenerationModel when no provider exposes the saved model', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'claude-opus-4-6',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            customModels: '',
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(true);
      expect(settings.titleGenerationModel).toBe('');
    });

    it('keeps Codex custom title models while they are still available', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'my-custom-model',
        providerConfigs: {
          codex: {
            enabled: true,
            customModels: 'my-custom-model',
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(false);
      expect(settings.titleGenerationModel).toBe('my-custom-model');
    });
  });

  describe('projectActiveProviderState', () => {
    it('projects saved model and effort for the settings provider', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        providerConfigs: {
          codex: { enabled: true },
        },
        permissionMode: 'full_access',
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: { codex: DEFAULT_CODEX_PRIMARY_MODEL, claude: 'haiku' },
        savedProviderEffort: { codex: 'medium', claude: 'high' },
        savedProviderServiceTier: { codex: 'fast', claude: 'default' },
        savedProviderThinkingBudget: { codex: '1024', claude: 'off' },
        savedProviderPermissionMode: { codex: 'normal', claude: 'full_access' },
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(settings.effortLevel).toBe('medium');
      expect(settings.serviceTier).toBe('fast');
      expect(settings.thinkingBudget).toBe('off');
      expect(settings.permissionMode).toBe('normal');
    });

    it('migrates a saved legacy Codex model before projecting provider state', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
          codex: { enabled: true },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: { claude: 'haiku', codex: 'gpt-5.2' },
        savedProviderEffort: { claude: 'high', codex: 'medium' },
        savedProviderServiceTier: { claude: 'default', codex: 'fast' },
        savedProviderThinkingBudget: { claude: 'off', codex: 'off' },
      };

      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, 'codex');

      expect(snapshot.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(snapshot.serviceTier).toBe('fast');
    });

    it('defaults to the first enabled provider when settingsProvider is not set', () => {
      const settings: Record<string, unknown> = {
        model: 'old-model',
        effortLevel: 'low',
        serviceTier: 'default',
        thinkingBudget: '500',
        providerConfigs: {
          codex: { enabled: true },
        },
        savedProviderModel: { codex: DEFAULT_CODEX_PRIMARY_MODEL },
        savedProviderEffort: { codex: 'medium' },
        savedProviderServiceTier: { codex: 'fast' },
        savedProviderThinkingBudget: { codex: 'off' },
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(settings.effortLevel).toBe('medium');
      expect(settings.serviceTier).toBe('fast');
      expect(settings.thinkingBudget).toBe('500');
    });

    it('does not overwrite when no saved values exist', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('haiku');
      expect(settings.effortLevel).toBe('high');
      expect(settings.thinkingBudget).toBe('off');
    });

    it('handles missing saved maps gracefully', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
      };

      // Should not throw
      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('haiku');
    });

    it('normalizes saved effort values that the projected Claude model no longer supports', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: true },
        },
        model: 'claude-sonnet-4-5',
        effortLevel: 'xhigh',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: { claude: 'claude-sonnet-4-5' },
        savedProviderEffort: { claude: 'xhigh' },
        savedProviderServiceTier: { claude: 'default' },
        savedProviderThinkingBudget: { claude: 'off' },
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('claude-sonnet-4-5');
      expect(settings.effortLevel).toBe('high');
    });
  });

  describe('persistProjectedProviderState', () => {
    it('stores the current top-level projection for the settings provider', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        providerConfigs: {
          codex: { enabled: true },
        },
        permissionMode: 'normal',
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        effortLevel: 'low',
        serviceTier: 'fast',
        thinkingBudget: 'off',
        savedProviderModel: { claude: 'haiku' },
        savedProviderEffort: { claude: 'high' },
        savedProviderServiceTier: { claude: 'default' },
        savedProviderThinkingBudget: { claude: 'off' },
        savedProviderPermissionMode: { claude: 'full_access' },
      };

      ProviderSettingsCoordinator.persistProjectedProviderState(settings);

      expect(settings.savedProviderModel).toEqual({
        claude: 'haiku',
        codex: DEFAULT_CODEX_PRIMARY_MODEL,
      });
      expect(settings.savedProviderEffort).toEqual({
        claude: 'high',
        codex: 'low',
      });
      expect(settings.savedProviderServiceTier).toEqual({
        claude: 'default',
        codex: 'fast',
      });
      expect(settings.savedProviderPermissionMode).toEqual({
        claude: 'full_access',
        codex: 'normal',
      });
    });

    // Gemini and Antigravity declare `reasoningControl: { kind: 'none' }` and
    // contribute no reasoning group. Their chat-UI configs still answer the
    // row's reasoning methods, and answer them differently from each other —
    // Gemini says a model is not adaptive, Antigravity says it is — so before
    // the coordinator read the contribution, Gemini kept a thinking budget and
    // Antigravity kept none, from the same declaration.
    it.each(['gemini', 'antigravity'])(
      'keeps no thinking budget for %s, which contributes no reasoning group',
      (providerId) => {
        const settings: Record<string, unknown> = {
          settingsProvider: providerId,
          providerConfigs: { [providerId]: { enabled: true } },
          model: '',
          thinkingBudget: 'off',
          savedProviderThinkingBudget: { [providerId]: 'off', claude: 'off' },
        };

        ProviderSettingsCoordinator.projectProviderState(settings, providerId);
        ProviderSettingsCoordinator.persistProjectedProviderState(settings, providerId);

        expect(settings.savedProviderThinkingBudget).toEqual({ claude: 'off' });
      },
    );
  });

  describe('projectProviderState', () => {
    it('seeds a provider projection from provider defaults when no saved values exist', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: {
            enabled: true,
          },
          codex: {
            enabled: true,
            environmentVariables: '',
          },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
      };

      ProviderSettingsCoordinator.projectProviderState(settings, 'codex');

      expect(settings.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(settings.effortLevel).toBe('medium');
      expect(settings.serviceTier).toBe('default');
    });

    it('preserves saved service tier when the projected model hides the toggle', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'codex',
        providerConfigs: {
          codex: {
            enabled: true,
            environmentVariables: '',
          },
        },
        model: 'gpt-5.4-mini',
        effortLevel: 'medium',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: { codex: 'gpt-5.4-mini' },
        savedProviderEffort: { codex: 'medium' },
        savedProviderServiceTier: { codex: 'fast' },
        savedProviderThinkingBudget: { codex: 'off' },
      };

      ProviderSettingsCoordinator.projectProviderState(settings, 'codex');

      expect(settings.model).toBe('gpt-5.4-mini');
      expect(settings.serviceTier).toBe('fast');
    });

    it('derives OpenCode permission mode from the managed selected mode when no provider snapshot exists yet', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        permissionMode: 'full_access',
        providerConfigs: {
          claude: {
            enabled: true,
          },
          opencode: {
            enabled: true,
            selectedMode: 'grimoire-safe',
          },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      ProviderSettingsCoordinator.projectProviderState(settings, 'opencode');

      expect(settings.permissionMode).toBe('normal');
    });

    it('prefers the active OpenCode selected mode over a stale top-level permission projection', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'opencode',
        permissionMode: 'normal',
        providerConfigs: {
          opencode: {
            enabled: true,
            selectedMode: 'build',
          },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
        savedProviderPermissionMode: {},
      };

      ProviderSettingsCoordinator.projectProviderState(settings, 'opencode');

      expect(settings.permissionMode).toBe('full_access');
    });
  });

  describe('provider-scoped reconciliation', () => {
    it('updates the inactive provider snapshot without clobbering the active projection', () => {
      const codexConv = {
        providerId: 'codex',
        sessionId: 'thread-1',
        messages: [],
      } as unknown as Conversation;

      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: {
            enabled: true,
          },
          codex: {
            enabled: true,
            environmentVariables: `OPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
          },
        },
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: { claude: 'haiku', codex: DEFAULT_CODEX_PRIMARY_MODEL },
        savedProviderEffort: { claude: 'high', codex: 'medium' },
        savedProviderServiceTier: { claude: 'default', codex: 'fast' },
        savedProviderThinkingBudget: { claude: 'off', codex: 'off' },
      };

      const result = ProviderSettingsCoordinator.reconcileAllProviders(settings, [codexConv]);

      expect(result.changed).toBe(true);
      expect(codexConv.sessionId).toBeNull();
      expect(codexConv.providerState).toBeUndefined();
      expect(settings.model).toBe('haiku');
      expect(settings.savedProviderModel).toEqual({
        claude: 'haiku',
        codex: DEFAULT_CODEX_PRIMARY_MODEL,
      });
      expect(settings.savedProviderServiceTier).toEqual({
        claude: 'default',
        codex: 'fast',
      });
    });
  });
});
