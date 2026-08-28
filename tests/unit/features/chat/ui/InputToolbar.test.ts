import { createMockEl } from '@test/helpers/mockElement';
import { readFileSync } from 'fs';
import { setIcon, setTooltip } from 'obsidian';

import type {
  ProviderChatUiContribution,
} from '@/core/providers/ProviderModule';
import type { UsageInfo } from '@/core/types';
import {
  ContextUsageMeter,
  createInputToolbar,
  McpServerSelector,
  ModelSelector,
  ModeSelector,
  OrchestratorToggle,
  PermissionToggle,
  PlanUsageBadge,
  ProjectWorkspaceSelector,
  ServiceTierToggle,
  ThinkingBudgetSelector,
} from '@/features/chat/ui/InputToolbar';
import { setLocale } from '@/i18n/i18n';
import {
  DEFAULT_CODEX_PRIMARY_MODEL,
  DEFAULT_CODEX_PRIMARY_MODEL_LABEL,
} from '@/providers/codex/types/models';
import { chatUiContributionFor } from '@/providers/shared/chatUiContribution';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn(),
  setTooltip: jest.fn(),
}));

function makeUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 200000,
    contextTokens: 0,
    percentage: 0,
    ...overrides,
  };
}

function findByTag(element: any, tagName: string): any {
  if (element.tagName === tagName.toUpperCase()) {
    return element;
  }
  for (const child of element.children ?? []) {
    const found = findByTag(child, tagName);
    if (found) {
      return found;
    }
  }
  return null;
}

function getModelOptionLabel(option: any): string | undefined {
  return option.querySelector('.grimoire-model-option-label')?.textContent;
}

const DEFAULT_MODELS = [
  { value: 'opus', label: 'Opus 4.8', description: 'Most capable' },
  { value: 'opus[1m]', label: 'Opus 4.8 · 1M', description: 'Most capable (1M context window)' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7', description: 'Deep reasoning profile' },
  { value: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced performance' },
  { value: 'sonnet[1m]', label: 'Sonnet 4.6 · 1M', description: 'Balanced performance (1M context window)' },
  { value: 'haiku', label: 'Haiku 4.5', description: 'Fast and efficient' },
];

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const BUDGET_OPTIONS = [
  { value: 'off', label: 'Off', tokens: 0 },
  { value: 'low', label: 'Low', tokens: 4000 },
  { value: 'medium', label: 'Med', tokens: 8000 },
  { value: 'high', label: 'High', tokens: 16000 },
  { value: 'xhigh', label: 'Ultra', tokens: 32000 },
];

const DEFAULT_MODEL_VALUES = new Set(DEFAULT_MODELS.map(m => m.value));

function filterVisibleModels(
  models: typeof DEFAULT_MODELS,
  enableOpus1M: boolean,
  enableSonnet1M: boolean,
) {
  return models.filter((model) => {
    if (model.value === 'opus' || model.value === 'opus[1m]') {
      return enableOpus1M ? model.value === 'opus[1m]' : model.value === 'opus';
    }
    if (model.value === 'sonnet' || model.value === 'sonnet[1m]') {
      return enableSonnet1M ? model.value === 'sonnet[1m]' : model.value === 'sonnet';
    }
    return true;
  });
}

function createMockUIConfig() {
  return {
    getModelOptions: jest.fn().mockImplementation((settings: {
      enableOpus1M?: boolean;
      enableSonnet1M?: boolean;
      environmentVariables?: string;
    }) => {
      // Mimic real behavior: env-based custom models bypass 1M filtering
      if (settings.environmentVariables) {
        const match = settings.environmentVariables.match(/ANTHROPIC_MODEL=(\S+)/);
        if (match) {
          const value = match[1];
          const label = value.includes('/')
            ? value.split('/').pop() || value
            : value.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
          return [{ value, label }];
        }
      }
      return filterVisibleModels(
        DEFAULT_MODELS,
        settings.enableOpus1M ?? false,
        settings.enableSonnet1M ?? false,
      );
    }),
    isAdaptiveReasoningModel: jest.fn().mockImplementation((model: string) => {
      if (DEFAULT_MODEL_VALUES.has(model)) return true;
      return /claude-(haiku|sonnet|opus)-/.test(model);
    }),
    getReasoningOptions: jest.fn().mockImplementation((model: string) => {
      if (DEFAULT_MODEL_VALUES.has(model) || /claude-(haiku|sonnet|opus)-/.test(model)) {
        return EFFORT_OPTIONS;
      }
      return BUDGET_OPTIONS;
    }),
    getDefaultReasoningValue: jest.fn().mockReturnValue('high'),
    getContextWindowSize: jest.fn().mockReturnValue(200000),
    isDefaultModel: jest.fn().mockImplementation((model: string) =>
      DEFAULT_MODELS.some(m => m.value === model)
    ),
    applyModelDefaults: jest.fn(),
    normalizeModelVariant: jest.fn((model: string) => model),
    ownsModel: jest.fn().mockReturnValue(true),
    getCustomModelIds: jest.fn().mockReturnValue(new Set<string>()),
    getPermissionModeToggle: jest.fn().mockReturnValue({
      inactiveValue: 'normal',
      inactiveLabel: 'Safe',
      activeValue: 'full_access',
      activeLabel: 'Auto-approve',
      planValue: 'plan',
      planLabel: 'Plan',
    }),
    getServiceTierToggle: jest.fn().mockImplementation((settings: Record<string, unknown>) =>
      settings.model === DEFAULT_CODEX_PRIMARY_MODEL
        ? {
          inactiveValue: 'default',
          inactiveLabel: 'Standard',
          activeValue: 'fast',
          activeLabel: 'Fast',
          description: '1.5x speed, 2x credits',
        }
        : null
    ),
    getModeSelector: jest.fn().mockImplementation((settings: Record<string, unknown>) => ({
      activeValue: 'build',
      label: 'Mode',
      options: [
        { value: 'build', label: 'Build', description: 'Default editing agent' },
        { value: 'plan', label: 'Plan', description: 'Planning-first agent' },
      ],
      value: typeof settings.selectedMode === 'string' && settings.selectedMode
        ? settings.selectedMode
        : 'build',
    })),
  };
}

/**
 * The mock config as the chat-UI contribution the toolbar now takes.
 *
 * Built by the production delegation rather than hand-written, so what these
 * tests drive is what a provider's module actually produces — and a mock that
 * drifts from the row it stands for fails here rather than passing quietly.
 *
 * One group is added on top. `chatUiContributionFor` declares no
 * `modeSelector`, because no provider has one: all four `getModeSelector`
 * implementations return `null`. The toolbar's control and the contract's slot
 * both still exist, so the mock fills the slot the way a provider that had a
 * mode selector would.
 */
function createMockChatUI(
  config: ReturnType<typeof createMockUIConfig> = createMockUIConfig(),
): ProviderChatUiContribution {
  return {
    ...chatUiContributionFor(
      config,
      { kind: 'effort', tiers: ['low', 'medium', 'high'] },
    ),
    modeSelector: {
      selector: settings => config.getModeSelector(settings),
      apply: jest.fn(),
    },
  };
}

function createMockCallbacks(overrides: Record<string, any> = {}) {
  return {
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn().mockResolvedValue(undefined),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
    onOrchestratorModeChange: jest.fn().mockResolvedValue(undefined),
    refreshModelOptions: jest.fn().mockResolvedValue(undefined),
    getOrchestratorMode: jest.fn().mockReturnValue(false),
    getProjectWorkspaces: jest.fn().mockReturnValue([]),
    getActiveProjectWorkspaceId: jest.fn().mockReturnValue(''),
    onProjectWorkspaceChange: jest.fn().mockResolvedValue(undefined),
    getSettings: jest.fn().mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
      selectedMode: 'build',
      enableOpus1M: false,
      enableSonnet1M: false,
    }),
    getEnvironmentVariables: jest.fn().mockReturnValue(''),
    getProviderId: jest.fn().mockReturnValue('claude'),
    getProviderUsage: jest.fn().mockReturnValue(null),
    refreshProviderUsage: jest.fn().mockResolvedValue(null),
    resolveProviderForModel: jest.fn().mockReturnValue('claude'),
    getChatUI: jest.fn().mockReturnValue(createMockChatUI()),
    getCapabilities: jest.fn().mockReturnValue({
      providerId: 'claude',
      supportsPersistentRuntime: true,
      supportsNativeHistory: true,
      supportsPlanMode: true,
      supportsRewind: true,
      supportsFork: true,
      supportsProviderCommands: true,
      reasoningControl: 'effort',
    }),
    ...overrides,
  };
}

describe('ModelSelector', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let selector: ModelSelector;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    callbacks = createMockCallbacks();
    selector = new ModelSelector(parentEl, callbacks);
  });

  it('should create a container with model-selector class', () => {
    const container = parentEl.querySelector('.grimoire-model-selector');
    expect(container).not.toBeNull();
  });

  it('should display current model label', () => {
    // Default model is 'sonnet' which maps to 'Sonnet 4.6'
    const btn = parentEl.querySelector('.grimoire-model-btn');
    expect(btn).not.toBeNull();
    const label = btn?.querySelector('.grimoire-model-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Sonnet 4.6');
  });

  it('should mark the selected model icon with its provider for brand coloring', () => {
    const uiConfig = {
      ...createMockUIConfig(),
      getProviderIcon: jest.fn().mockReturnValue({
        viewBox: '0 0 1 1',
        path: 'M0 0h1v1H0z',
      }),
    };
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    const iconParent = createMockEl();
    new ModelSelector(iconParent, callbacks);
    const icon = iconParent.querySelector('.grimoire-model-button-provider-icon');

    expect(icon?.getAttribute('data-provider')).toBe('claude');
  });

  it('should expose the full selected model in its tooltip and accessible label', () => {
    const button = parentEl.querySelector('.grimoire-model-btn');
    expect(button?.getAttribute('title')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Select model: Sonnet 4.6');
    expect(setTooltip).toHaveBeenCalledWith(button, 'Sonnet 4.6', { placement: 'top' });

    jest.clearAllMocks();
    setLocale('zh-CN');
    const parentEl2 = createMockEl();
    new ModelSelector(parentEl2, callbacks);
    const localizedButton = parentEl2.querySelector('.grimoire-model-btn');
    expect(localizedButton?.getAttribute('aria-label')).toBe('选择模型: Sonnet 4.6');
    expect(setTooltip).toHaveBeenCalledWith(localizedButton, 'Sonnet 4.6', { placement: 'top' });
    setLocale('en');
  });

  it('should display only the model segment after slash on the model button', () => {
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue([
      {
        value: 'opencode:minimax-token-plan/minimax-m2.7-highspeed',
        label: 'MiniMax Token Plan (minimax.io)/MiniMax-M2.7-highspeed',
      },
    ]);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getSettings.mockReturnValue({
      model: 'opencode:minimax-token-plan/minimax-m2.7-highspeed',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    });

    selector.updateDisplay();

    const label = parentEl.querySelector('.grimoire-model-label');
    expect(label?.textContent).toBe('MiniMax-M2.7-highspeed');
  });

  it('should use a compact button label while preserving the full model tooltip', () => {
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue([
      {
        buttonLabel: 'qwen3.8-max',
        label: '[Token Plan Personal] qwen3.8-max',
        value: 'qwen:qwen3.8-max(openai)',
      },
    ]);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getSettings.mockReturnValue({
      model: 'qwen:qwen3.8-max(openai)',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    });

    selector.updateDisplay();

    const button = parentEl.querySelector('.grimoire-model-btn');
    const label = parentEl.querySelector('.grimoire-model-label');
    expect(label?.textContent).toBe('qwen3.8-max');
    expect(button?.getAttribute('aria-label')).toBe('Select model: [Token Plan Personal] qwen3.8-max');
    expect(setTooltip).toHaveBeenCalledWith(
      button,
      '[Token Plan Personal] qwen3.8-max',
      { placement: 'top' },
    );
  });

  it('should display the saved model value when current model is not in available options', () => {
    callbacks.getSettings.mockReturnValue({
      model: 'nonexistent',
      thinkingBudget: 'low',
      serviceTier: 'default',
      permissionMode: 'normal',
      enableOpus1M: false,
      enableSonnet1M: false,
    });
    selector.updateDisplay();
    const label = parentEl.querySelector('.grimoire-model-label');
    expect(label?.textContent).toBe('Nonexistent');
  });

  it('should render model options in configured order', () => {
    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    expect(dropdown).not.toBeNull();
    const options = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-option') ?? []);
    expect(options.length).toBe(4);
    expect(getModelOptionLabel(options[0])).toBe('Opus 4.8');
    expect(getModelOptionLabel(options[1])).toBe('Opus 4.7');
    expect(getModelOptionLabel(options[2])).toBe('Sonnet 4.6');
    expect(getModelOptionLabel(options[3])).toBe('Haiku 4.5');
  });

  it('should mark current model as selected', () => {
    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const options = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-option') ?? []);
    const sonnetOption = options.find((o: any) => getModelOptionLabel(o) === 'Sonnet 4.6');
    expect(sonnetOption?.hasClass('selected')).toBe(true);
  });

  it('should call onModelChange when option clicked', async () => {
    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const options = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-option') ?? []);
    const opusOption = options.find((o: any) => getModelOptionLabel(o) === 'Opus 4.8');

    expect(opusOption).toBeDefined();
    opusOption?.click();
    await Promise.resolve();
    expect(callbacks.onModelChange).toHaveBeenCalledWith('opus');
  });

  it('should show the selected model immediately and close while model change is pending', () => {
    let resolveChange!: () => void;
    callbacks.onModelChange.mockImplementation(() => new Promise<void>((resolve) => {
      resolveChange = resolve;
    }));

    const container = parentEl.querySelector('.grimoire-model-selector');
    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const options = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-option') ?? []);
    const opusOption = options.find((o: any) => getModelOptionLabel(o) === 'Opus 4.8');
    container?.addClass('open');

    expect(opusOption).toBeDefined();
    opusOption?.click();

    expect(container?.hasClass('open')).toBe(false);
    expect(parentEl.querySelector('.grimoire-model-loading')).toBeNull();
    expect(parentEl.querySelector('.grimoire-model-label')?.textContent).toBe('Opus 4.8');
    expect(resolveChange).toBeDefined();
  });

  it('should toggle the model dropdown on button click', async () => {
    const button = parentEl.querySelector('.grimoire-model-btn');
    const container = parentEl.querySelector('.grimoire-model-selector');

    await button?.dispatchEvent('click', { stopPropagation: () => {} });

    expect(container?.hasClass('open')).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    await button?.dispatchEvent('click', { stopPropagation: () => {} });

    expect(container?.hasClass('open')).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });

  it('warms model options as soon as the selector is created', () => {
    expect(callbacks.refreshModelOptions).toHaveBeenCalled();
  });

  it('refreshes model options when opened while keeping fallback options visible', async () => {
    await Promise.resolve();
    await Promise.resolve();

    let resolveRefresh!: () => void;
    let models = [
      { value: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced performance', group: 'Claude' },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockImplementation(() => models);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.refreshModelOptions.mockReset();
    callbacks.refreshModelOptions.mockImplementation(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    selector.renderOptions();

    const button = parentEl.querySelector('.grimoire-model-btn');
    await button?.dispatchEvent('click', { stopPropagation: () => {} });

    expect(callbacks.refreshModelOptions).toHaveBeenCalled();
    expect(parentEl.querySelector('.grimoire-model-catalog-loading')?.textContent).toBe('Loading models…');
    expect(parentEl.querySelector('.grimoire-model-option-label')?.textContent).toBe('Sonnet 4.6');

    models = [
      { value: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced performance', group: 'Claude' },
      { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Latest', group: 'Codex' },
    ];
    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();

    const labels = (Array.from<any>(parentEl.querySelectorAll('.grimoire-model-option-label')))
      .map(el => el.textContent);
    expect(parentEl.querySelector('.grimoire-model-catalog-loading')).toBeNull();
    expect(labels).toEqual(['Sonnet 4.6', 'GPT-5.5']);
  });

  it('keeps a collapsed model group collapsed after catalog refresh finishes', async () => {
    await Promise.resolve();
    await Promise.resolve();

    let resolveRefresh!: () => void;
    let models = [
      { value: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced performance', group: 'Claude Code' },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockImplementation(() => models);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.refreshModelOptions.mockReset();
    callbacks.refreshModelOptions.mockImplementation(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    selector.renderOptions();

    const button = parentEl.querySelector('.grimoire-model-btn');
    await button?.dispatchEvent('click', { stopPropagation: () => {} });

    const initialGroup = parentEl.querySelector('.grimoire-model-group-section--claude-code');
    const initialHeader = initialGroup?.querySelector('.grimoire-model-group');
    expect(initialGroup?.hasClass('is-open')).toBe(true);

    await initialHeader?.dispatchEvent('click', { stopPropagation: () => {} });
    expect(initialGroup?.hasClass('is-open')).toBe(false);

    models = [
      { value: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced performance', group: 'Claude Code' },
      { value: 'opus', label: 'Opus 4.8', description: 'Most capable', group: 'Claude Code' },
    ];
    resolveRefresh();
    await Promise.resolve();
    await Promise.resolve();

    const refreshedGroup = parentEl.querySelector('.grimoire-model-group-section--claude-code');
    const refreshedHeader = refreshedGroup?.querySelector('.grimoire-model-group');
    expect(parentEl.querySelector('.grimoire-model-catalog-loading')).toBeNull();
    expect(refreshedGroup?.hasClass('is-open')).toBe(false);
    expect(refreshedHeader?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a model catalog refresh failure without hiding fallback options', async () => {
    await Promise.resolve();
    await Promise.resolve();

    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue([
      { value: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced performance', group: 'Claude' },
    ]);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.refreshModelOptions.mockReset();
    callbacks.refreshModelOptions.mockRejectedValue(new Error('model/list failed'));
    selector.renderOptions();

    const button = parentEl.querySelector('.grimoire-model-btn');
    await button?.dispatchEvent('click', { stopPropagation: () => {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(parentEl.querySelector('.grimoire-model-catalog-loading')).toBeNull();
    expect(parentEl.querySelector('.grimoire-model-catalog-error')?.textContent).toBe('Couldn’t load models');
    expect(parentEl.querySelector('.grimoire-model-option-label')?.textContent).toBe('Sonnet 4.6');
  });

  it('should open the model menu without viewport positioning variables', async () => {
    const button = parentEl.querySelector('.grimoire-model-btn');
    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');

    await button?.dispatchEvent('click', { stopPropagation: () => {} });

    expect(parentEl.querySelector('.grimoire-model-selector')?.hasClass('open')).toBe(true);
    expect(dropdown?.style['--grimoire-model-dropdown-bottom']).toBeUndefined();
    expect(dropdown?.style['--grimoire-model-dropdown-left']).toBeUndefined();
    expect(dropdown?.style['--grimoire-model-dropdown-width']).toBeUndefined();
    expect(dropdown?.style['--grimoire-model-dropdown-max-height']).toBeUndefined();
  });

  it('should close the model dropdown after selecting an option', async () => {
    const container = parentEl.querySelector('.grimoire-model-selector');
    container?.addClass('open');
    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const options = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-option') ?? []);
    const opusOption = options.find((o: any) => getModelOptionLabel(o) === 'Opus 4.8');

    expect(opusOption).toBeDefined();
    opusOption?.click();
    await Promise.resolve();

    expect(container?.hasClass('open')).toBe(false);
  });

  it('should always show brand color on model button', () => {
    const btn = parentEl.querySelector('.grimoire-model-btn');
    expect(btn).toBeTruthy();
    expect(btn?.hasClass('ready')).toBe(false);
  });

  it('should use custom models from environment variables', () => {
    callbacks.getEnvironmentVariables.mockReturnValue(
      'CLAUDE_CODE_USE_BEDROCK=1\nANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0'
    );
    callbacks.getSettings.mockReturnValue({
      model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      thinkingBudget: 'low',
      permissionMode: 'normal',
      enableOpus1M: false,
      enableSonnet1M: false,
    });
    selector.renderOptions();
    selector.updateDisplay();
    // Custom models should be available in dropdown
    const label = parentEl.querySelector('.grimoire-model-label');
    expect(label?.textContent).toBeDefined();
  });

  it('should not filter custom env models when 1M toggles are enabled', () => {
    callbacks.getEnvironmentVariables.mockReturnValue(
      'ANTHROPIC_MODEL=opus'
    );
    callbacks.getSettings.mockReturnValue({
      model: 'opus',
      thinkingBudget: 'low',
      permissionMode: 'normal',
      enableOpus1M: true,
      enableSonnet1M: true,
    });

    selector.renderOptions();
    selector.updateDisplay();

    const label = parentEl.querySelector('.grimoire-model-label');
    expect(label?.textContent).toBe('Opus');
  });

  it('should render group separators when models have group field', () => {
    const groupedModels = [
      { value: 'opus', label: 'Opus 4.8', group: 'Claude' },
      { value: 'sonnet', label: 'Sonnet 4.6', group: 'Claude' },
      { value: DEFAULT_CODEX_PRIMARY_MODEL, label: DEFAULT_CODEX_PRIMARY_MODEL_LABEL, group: 'Codex' },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getSettings.mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    });

    selector.renderOptions();

    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const groups = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-group') ?? []);
    expect(groups.length).toBe(2);
    expect(groups[0]?.querySelector('.grimoire-model-group-label')?.textContent).toBe('Claude');
    expect(groups[0]?.querySelector('.grimoire-model-group-count')?.textContent).toBe('2');
    expect(groups[1]?.querySelector('.grimoire-model-group-label')?.textContent).toBe('Codex');
    expect(groups[1]?.querySelector('.grimoire-model-group-count')?.textContent).toBe('1');
  });

  it('marks model group dots with provider ids instead of deriving colors from labels', () => {
    const groupedModels = [
      { value: 'mimocode:fast', label: 'Fast', group: 'MiMo Code', providerId: 'mimocode' },
      { value: 'grok:code', label: 'Code', group: 'Grok Build', providerId: 'grok' },
    ];
    const uiConfig = {
      ...createMockUIConfig(),
      getModelOptions: jest.fn().mockReturnValue(groupedModels),
      getProviderIcon: jest.fn().mockReturnValue({
        viewBox: '0 0 1 1',
        path: 'M0 0h1v1H0z',
      }),
    };
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));

    selector.renderOptions();

    const groups = Array.from<any>(parentEl.querySelectorAll('.grimoire-model-group-section'));
    const providers = groups.map(group =>
      group.querySelector('.grimoire-model-group-provider-icon')?.getAttribute('data-provider')
    );
    expect(providers).toEqual(['grok', 'mimocode']);
  });

  it('sorts provider model groups alphabetically by label', () => {
    const groupedModels = [
      { value: 'antigravity', label: 'Antigravity', group: 'Antigravity' },
      { value: 'opencode:openai/gpt-5', label: 'GPT-5', group: 'OpenCode' },
      { value: DEFAULT_CODEX_PRIMARY_MODEL, label: DEFAULT_CODEX_PRIMARY_MODEL_LABEL, group: 'Codex' },
      { value: 'gemini:gemini', label: 'Gemini CLI (Legacy)', group: 'Gemini CLI (Legacy)' },
      { value: 'sonnet', label: 'Sonnet 4.6', group: 'Claude Code' },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getSettings.mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    });

    selector.renderOptions();

    const labels = (Array.from<any>(parentEl.querySelectorAll('.grimoire-model-group-label')))
      .map(el => el.textContent);
    expect(labels).toEqual(['Antigravity', 'Claude Code', 'Codex', 'Gemini CLI (Legacy)', 'OpenCode']);
  });

  it('filters models from the menu search field', () => {
    const input = parentEl.querySelector('.grimoire-model-search-input');
    expect(input).not.toBeNull();

    input!.value = 'opus';
    input!.dispatchEvent('input');

    const labels = (Array.from<any>(parentEl.querySelectorAll('.grimoire-model-option-label')))
      .map(el => el.textContent);
    expect(labels).toEqual(['Opus 4.8', 'Opus 4.7']);
  });

  it('matches model search words across label and provider group', () => {
    const groupedModels = [
      { value: 'sonnet', label: 'Sonnet 5', description: 'Daily coding', group: 'Claude Code' },
      {
        value: 'antigravity:Claude Sonnet 4.6 (Thinking)',
        label: 'Claude Sonnet 4.6 (Thinking)',
        group: 'Antigravity',
      },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    selector.renderOptions();

    const input = parentEl.querySelector('.grimoire-model-search-input');
    input!.value = 'claude sonnet';
    input!.dispatchEvent('input');

    const labels = (Array.from<any>(parentEl.querySelectorAll('.grimoire-model-option-label')))
      .map(el => el.textContent);
    expect(labels).toEqual(['Claude Sonnet 4.6 (Thinking)', 'Sonnet 5']);
  });

  it('finds a native Claude model by provider group and versioned description', () => {
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue([{
      value: 'opus[1m]',
      label: 'Opus (1M context)',
      description: 'Opus 5 with 1M context',
      group: 'Claude Code',
    }]);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    selector.renderOptions();

    const input = parentEl.querySelector('.grimoire-model-search-input');
    input!.value = 'claude opus 5';
    input!.dispatchEvent('input');

    const labels = (Array.from<any>(parentEl.querySelectorAll('.grimoire-model-option-label')))
      .map(el => el.textContent);
    expect(labels).toEqual(['Opus (1M context)']);
  });

  it('should prioritize the distinguishing model segment for long names', () => {
    const uiConfig = createMockUIConfig();
    const longModel = 'minimax-token-plan/minimax-m2.7-highspeed';
    uiConfig.getModelOptions.mockReturnValue([
      {
        value: longModel,
        label: 'MiniMax Token Plan (minimax.io)/MiniMax-M2.7-highspeed',
        description: 'ACP runtime',
        group: 'OpenCode',
      },
    ]);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getSettings.mockReturnValue({
      model: longModel,
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
    });

    selector.renderOptions();

    const option = parentEl.querySelector('.grimoire-model-option');
    const copy = option?.querySelector('.grimoire-model-option-copy');

    expect(copy).not.toBeNull();
    expect(copy?.querySelector('.grimoire-model-option-label')?.textContent).toBe(
      'MiniMax-M2.7-highspeed',
    );
    expect(copy?.querySelector('.grimoire-model-option-detail')?.textContent).toBe(
      'MiniMax Token Plan (minimax.io)',
    );
    expect(option?.getAttribute('title')).toBe(
      'MiniMax Token Plan (minimax.io)/MiniMax-M2.7-highspeed\nACP runtime',
    );
  });

  it('should not render group separators when models have no group field', () => {
    selector.renderOptions();

    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const groups = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-group') ?? []);
    expect(groups.length).toBe(0);
  });

  it('should show 1M variants instead of standard variants when enabled', () => {
    callbacks.getSettings.mockReturnValue({
      model: 'opus[1m]',
      thinkingBudget: 'medium',
      serviceTier: 'default',
      permissionMode: 'normal',
      enableOpus1M: true,
      enableSonnet1M: true,
    });

    selector.renderOptions();
    selector.updateDisplay();

    const dropdown = parentEl.querySelector('.grimoire-model-dropdown');
    const options = Array.from<any>(dropdown?.querySelectorAll('.grimoire-model-option') ?? []);
    expect(options.find((o: any) => getModelOptionLabel(o) === 'Opus 4.8 · 1M')).toBeDefined();
    expect(options.find((o: any) => getModelOptionLabel(o) === 'Opus 4.7')).toBeDefined();
    expect(options.find((o: any) => getModelOptionLabel(o) === 'Sonnet 4.6 · 1M')).toBeDefined();
    expect(options.find((o: any) => getModelOptionLabel(o) === 'Opus 4.8')).toBeUndefined();
    expect(options.find((o: any) => getModelOptionLabel(o) === 'Sonnet 4.6')).toBeUndefined();
    expect(parentEl.querySelector('.grimoire-model-label')?.textContent).toBe('Opus 4.8 · 1M');
  });

  it('renders quota usage at the top of a grouped provider menu', () => {
    const groupedModels = [
      { value: 'opus', label: 'Opus 4.8', group: 'Claude Code', providerId: 'claude' as const },
      { value: 'sonnet', label: 'Sonnet 4.6', group: 'Claude Code', providerId: 'claude' as const },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getProviderUsage.mockImplementation((providerId: string) => (
      providerId === 'claude'
        ? {
          plan: 'Max 20x',
          windows: [
            { label: '5-hr', pct: 47, reset: '3:20p' },
            { label: 'Weekly', pct: 71, reset: 'Mon' },
          ],
        }
        : null
    ));

    selector.renderOptions();

    const readout = parentEl.querySelector('.grimoire-plan-usage-readout');
    const rows = Array.from<any>(parentEl.querySelectorAll('.grimoire-plan-usage-readout-row'));

    expect(readout?.querySelector('.grimoire-plan-usage-readout-plan')?.textContent).toBe('Max 20x');
    expect(readout?.querySelector('.grimoire-plan-usage-readout-caption')?.textContent).toBe('plan usage');
    expect(rows.map(row => row.querySelector('.grimoire-plan-usage-readout-label')?.textContent)).toEqual(['5-HR', 'WEEKLY']);
    expect(rows[0]?.querySelector('.grimoire-plan-usage-readout-value')?.textContent).toBe('47%');
    expect(rows[0]?.querySelector('.grimoire-plan-usage-readout-reset')?.textContent).toBe('3:20p');
  });

  it('renders pay-as-you-go usage without meter rows in a grouped provider menu', () => {
    const groupedModels = [
      { value: 'opencode:anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', group: 'OpenCode', providerId: 'opencode' as const },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getProviderUsage.mockImplementation((providerId: string) => (
      providerId === 'opencode'
        ? { plan: 'API keys', spend: '$4.20 this month', note: 'Pay per token across vendors · no cap set.' }
        : null
    ));

    selector.renderOptions();

    const readout = parentEl.querySelector('.grimoire-plan-usage-readout');

    expect(readout?.hasClass('grimoire-plan-usage-readout--spend')).toBe(true);
    expect(readout?.querySelector('.grimoire-plan-usage-readout-plan')?.textContent).toBe('API keys');
    expect(readout?.querySelector('.grimoire-plan-usage-readout-spend')?.textContent).toBe('$4.20 this month');
    expect(readout?.querySelector('.grimoire-plan-usage-readout-note')?.textContent).toBe('Pay per token across vendors · no cap set.');
    expect(parentEl.querySelector('.grimoire-plan-usage-readout-row')).toBeNull();
  });

  it('renders quota and spend readouts together when a provider reports both', () => {
    const groupedModels = [
      { value: 'sonnet', label: 'Sonnet 4.6', group: 'Claude Code', providerId: 'claude' as const },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getProviderUsage.mockImplementation((providerId: string) => (
      providerId === 'claude'
        ? {
          plan: 'Claude Code',
          spend: '$0.09 this month',
          note: 'SDK token cost reported for completed turns.',
          windows: [
            { label: '5-hr', pct: 11, reset: '5:50 PM' },
          ],
        }
        : null
    ));

    selector.renderOptions();

    const readouts = Array.from<any>(parentEl.querySelectorAll('.grimoire-plan-usage-readout'));

    expect(readouts).toHaveLength(2);
    expect(readouts[0]?.querySelector('.grimoire-plan-usage-readout-caption')?.textContent).toBe('plan usage');
    expect(readouts[0]?.querySelector('.grimoire-plan-usage-readout-value')?.textContent).toBe('11%');
    expect(readouts[1]?.hasClass('grimoire-plan-usage-readout--spend')).toBe(true);
    expect(readouts[1]?.querySelector('.grimoire-plan-usage-readout-spend')?.textContent).toBe('$0.09 this month');
  });

  it('does not render reset-only quota readouts when the provider withholds usage percent', () => {
    const groupedModels = [
      { value: 'sonnet', label: 'Sonnet 4.6', group: 'Claude Code', providerId: 'claude' as const },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getProviderUsage.mockImplementation((providerId: string) => (
      providerId === 'claude'
        ? {
          plan: 'Claude Code',
          spend: '$0.09 this month',
          note: 'SDK token cost reported for completed turns.',
          windows: [
            { label: '5-hr', pct: 0, pctKnown: false, reset: '7:00 PM' },
          ],
        }
        : null
    ));

    selector.renderOptions();

    const readouts = Array.from<any>(parentEl.querySelectorAll('.grimoire-plan-usage-readout'));

    expect(readouts).toHaveLength(1);
    expect(readouts[0]?.hasClass('grimoire-plan-usage-readout--spend')).toBe(true);
    expect(parentEl.querySelector('.grimoire-plan-usage-readout-row')).toBeNull();
  });

  it('does not render usage readouts when usage indicators are disabled globally', () => {
    const groupedModels = [
      { value: 'sonnet', label: 'Sonnet 4.6', group: 'Claude Code', providerId: 'claude' as const },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getSettings.mockReturnValue({
      ...callbacks.getSettings(),
      usageIndicatorsEnabled: false,
    });
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'Claude Code',
      spend: '$0.09 this month',
      windows: [{ label: '5-hr', pct: 11, reset: '5:50 PM' }],
    });

    selector.renderOptions();

    expect(parentEl.querySelector('.grimoire-plan-usage-readout')).toBeNull();
  });

  it('does not render usage when a grouped provider has no usage data', () => {
    const groupedModels = [
      { value: DEFAULT_CODEX_PRIMARY_MODEL, label: DEFAULT_CODEX_PRIMARY_MODEL_LABEL, group: 'Codex', providerId: 'codex' as const },
    ];
    const uiConfig = createMockUIConfig();
    uiConfig.getModelOptions.mockReturnValue(groupedModels);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));
    callbacks.getProviderUsage.mockReturnValue(null);

    selector.renderOptions();

    expect(parentEl.querySelector('.grimoire-plan-usage-readout')).toBeNull();
  });
});

describe('PlanUsageBadge', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let badge: PlanUsageBadge;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    callbacks = createMockCallbacks();
    badge = new PlanUsageBadge(parentEl, callbacks);
  });

  it('is hidden when the active provider has no usage data', () => {
    badge.updateDisplay();

    const container = parentEl.querySelector('.grimoire-plan-usage-badge');
    expect(container?.hasClass('grimoire-hidden')).toBe(true);
  });

  it('renders the active provider 5-hour usage window', () => {
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'Max 20x',
      updatedAt: new Date(2026, 6, 11, 19, 55).getTime(),
      windows: [
        { label: '5-hr', pct: 47, reset: '3:20p' },
        { label: 'Weekly', pct: 71, reset: 'Mon' },
      ],
    });

    badge.updateDisplay();

    const container = parentEl.querySelector('.grimoire-plan-usage-badge');
    expect(container?.hasClass('grimoire-hidden')).toBe(false);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-label')?.textContent).toBe('5H');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-fill')?.style.width).toBe('47%');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-value')?.textContent).toBe('47%');
    expect(container?.getAttribute('aria-label')).toBe('Max 20x 5-hour limit: 47% used, resets 3:20p');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-tip')).toBeNull();
  });

  it('renders non-5-hour quota windows inline next to the model selector', () => {
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'SuperGrok',
      note: 'Free credits · resets Jul 1',
      windows: [
        { label: 'Credits', pct: 6, reset: 'Jul 1' },
      ],
    });

    badge.updateDisplay();

    const container = parentEl.querySelector('.grimoire-plan-usage-badge');
    expect(container?.hasClass('grimoire-hidden')).toBe(false);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-label')?.textContent).toBe('Credits');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-fill')?.style.width).toBe('6%');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-value')?.textContent).toBe('6%');
    expect(container?.getAttribute('aria-label')).toBe('SuperGrok Credits limit: 6% used, resets Jul 1');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-tip')).toBeNull();
  });

  it('falls back to spend instead of rendering reset-only quota windows', () => {
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'Claude Code',
      spend: '$0.09 this month',
      windows: [
        { label: '5-hr', pct: 0, pctKnown: false, reset: '5:50 PM' },
      ],
    });

    badge.updateDisplay();

    const container = parentEl.querySelector('.grimoire-plan-usage-badge');
    expect(container?.hasClass('grimoire-hidden')).toBe(false);
    expect(container?.hasClass('grimoire-plan-usage-badge--spend')).toBe(true);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-label')?.textContent).toBe('API');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-meter')?.hasClass('grimoire-hidden')).toBe(true);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-value')?.textContent).toBe('$0.09');
    expect(container?.getAttribute('aria-label')).toBe('Claude Code: $0.09 this month');
  });

  it('marks the active provider 5-hour window hot at 80 percent', () => {
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'ChatGPT Pro',
      windows: [
        { label: '5-hr', pct: 80, reset: '4:05p' },
      ],
    });

    badge.updateDisplay();

    expect(parentEl.querySelector('.grimoire-plan-usage-badge')?.hasClass('is-hot')).toBe(true);
  });

  it('renders pay-as-you-go spend without the meter', () => {
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'API keys',
      spend: '$4.20 this month',
      note: 'Pay per token across vendors · no cap set.',
    });

    badge.updateDisplay();

    const container = parentEl.querySelector('.grimoire-plan-usage-badge');
    expect(container?.hasClass('grimoire-plan-usage-badge--spend')).toBe(true);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-label')?.textContent).toBe('API');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-meter')?.hasClass('grimoire-hidden')).toBe(true);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-value')?.textContent).toBe('$4.20');
    expect(container?.getAttribute('aria-label')).toBe('API keys: $4.20 this month');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-tip')).toBeNull();
  });

  it('prefers quota in the mini badge when quota and spend are both available', () => {
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'Claude Code',
      spend: '$0.09 this month',
      note: 'SDK token cost reported for completed turns.',
      windows: [
        { label: '5-hr', pct: 11, reset: '5:50 PM' },
      ],
    });

    badge.updateDisplay();

    const container = parentEl.querySelector('.grimoire-plan-usage-badge');
    expect(container?.hasClass('grimoire-plan-usage-badge--spend')).toBe(false);
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-label')?.textContent).toBe('5H');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-value')?.textContent).toBe('11%');
    expect(container?.getAttribute('aria-label')).toBe('Claude Code 5-hour limit: 11% used, resets 5:50 PM');
    expect(parentEl.querySelector('.grimoire-plan-usage-badge-tip')).toBeNull();
  });

  it('hides the mini badge when usage indicators are disabled globally', () => {
    callbacks.getSettings.mockReturnValue({
      ...callbacks.getSettings(),
      usageIndicatorsEnabled: false,
    });
    callbacks.getProviderUsage.mockReturnValue({
      plan: 'Claude Code',
      spend: '$0.09 this month',
      windows: [{ label: '5-hr', pct: 11, reset: '5:50 PM' }],
    });

    badge.updateDisplay();

    expect(parentEl.querySelector('.grimoire-plan-usage-badge')?.hasClass('grimoire-hidden')).toBe(true);
  });
});

describe('ModeSelector', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let selector: ModeSelector;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    callbacks = createMockCallbacks();
    selector = new ModeSelector(parentEl, callbacks);
  });

  it('should create a container with mode-selector class', () => {
    const container = parentEl.querySelector('.grimoire-mode-selector');
    expect(container).not.toBeNull();
  });

  it('should display the current mode label', () => {
    const label = parentEl.querySelector('.grimoire-mode-label');
    expect(label?.textContent).toBe('Build');
  });

  it('should call onModeChange when the toggle is clicked', async () => {
    const toggle = parentEl.querySelector('.grimoire-toggle-switch');
    await toggle?.dispatchEvent('click');

    expect(callbacks.onModeChange).toHaveBeenCalledWith('plan');
  });

  it('should call onModeChange when the label is clicked', async () => {
    const label = parentEl.querySelector('.grimoire-mode-label');
    await label?.dispatchEvent('click');

    expect(callbacks.onModeChange).toHaveBeenCalledWith('plan');
  });

  it('should show the active style when the configured active mode is selected', () => {
    callbacks.getSettings.mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
      selectedMode: 'build',
      enableOpus1M: false,
      enableSonnet1M: false,
    });

    const parentEl2 = createMockEl();
    new ModeSelector(parentEl2, callbacks);

    const label = parentEl2.querySelector('.grimoire-mode-label');
    const toggle = parentEl2.querySelector('.grimoire-toggle-switch');
    expect(label?.textContent).toBe('Build');
    expect(label?.hasClass('active')).toBe(true);
    expect(toggle?.hasClass('active')).toBe(true);
  });

  it('should show the inactive style when the configured inactive mode is selected', () => {
    callbacks.getSettings.mockReturnValue({
      model: 'sonnet',
      thinkingBudget: 'low',
      effortLevel: 'high',
      serviceTier: 'default',
      permissionMode: 'normal',
      selectedMode: 'plan',
      enableOpus1M: false,
      enableSonnet1M: false,
    });

    const parentEl2 = createMockEl();
    new ModeSelector(parentEl2, callbacks);

    const label = parentEl2.querySelector('.grimoire-mode-label');
    const toggle = parentEl2.querySelector('.grimoire-toggle-switch');
    expect(label?.textContent).toBe('Plan');
    expect(label?.hasClass('active')).toBe(false);
    expect(toggle?.hasClass('active')).toBe(false);
  });

  it('should hide when the provider exposes no mode selector', () => {
    const uiConfig = createMockUIConfig();
    uiConfig.getModeSelector.mockReturnValue(null);
    callbacks.getChatUI.mockReturnValue(createMockChatUI(uiConfig));

    selector.updateDisplay();

    const container = parentEl.querySelector('.grimoire-mode-selector');
    expect(container?.style?.display).toBe('none');
  });
});

describe('ThinkingBudgetSelector', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;
  let selector: ThinkingBudgetSelector;

  describe('adaptive mode (Claude models)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      parentEl = createMockEl();
      callbacks = createMockCallbacks();
      selector = new ThinkingBudgetSelector(parentEl, callbacks);
    });

    it('should create a container with thinking-selector class', () => {
      const container = parentEl.querySelector('.grimoire-thinking-selector');
      expect(container).not.toBeNull();
    });

    it('should show effort selector for Claude models', () => {
      const effort = parentEl.querySelector('.grimoire-thinking-effort');
      expect(effort).not.toBeNull();
      expect(effort?.style?.display).not.toBe('none');
    });

    it('should hide budget selector for Claude models', () => {
      const budget = parentEl.querySelector('.grimoire-thinking-budget');
      expect(budget?.style?.display).toBe('none');
    });

    it('should display current effort level for Claude models', () => {
      const current = parentEl.querySelector('.grimoire-thinking-current');
      expect(current?.textContent).toBe('High');
    });

    it('should localize all reasoning levels in Simplified Chinese', () => {
      setLocale('zh-CN');
      const parentEl2 = createMockEl();
      new ThinkingBudgetSelector(parentEl2, callbacks);

      const options = parentEl2.querySelector('.grimoire-thinking-options')?.children ?? [];
      expect(options.map((option: any) => option.textContent)).toEqual(['最高', '高', '中', '轻度']);
      setLocale('en');
    });

    it('should toggle effort options on current value click', async () => {
      const current = parentEl.querySelector('.grimoire-thinking-current');
      const gears = parentEl.querySelector('.grimoire-thinking-gears');

      await current?.dispatchEvent('click', { stopPropagation: () => {} });

      expect(gears?.hasClass('open')).toBe(true);
      expect(current?.getAttribute('aria-expanded')).toBe('true');

      await current?.dispatchEvent('click', { stopPropagation: () => {} });

      expect(gears?.hasClass('open')).toBe(false);
      expect(current?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should expose the effort menu and options to the keyboard', async () => {
      const current = parentEl.querySelector('.grimoire-thinking-current');
      const gears = parentEl.querySelector('.grimoire-thinking-gears');
      const mediumGear = parentEl.querySelector('.grimoire-thinking-options')?.children
        .find((gear: any) => gear.textContent === 'Medium');

      expect(current?.getAttribute('tabindex')).toBe('0');
      expect(mediumGear?.getAttribute('tabindex')).toBe('0');
      await current?.dispatchEvent('keydown', {
        key: 'Enter',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      expect(gears?.hasClass('open')).toBe(true);

      await mediumGear?.dispatchEvent('keydown', {
        key: ' ',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      expect(callbacks.onEffortLevelChange).toHaveBeenCalledWith('medium');
    });

    it('should close effort options after clicking outside the selector', async () => {
      const current = parentEl.querySelector('.grimoire-thinking-current');
      const gears = parentEl.querySelector('.grimoire-thinking-gears');
      const container = parentEl.querySelector('.grimoire-thinking-selector');

      await current?.dispatchEvent('click', { stopPropagation: () => {} });
      expect(gears?.hasClass('open')).toBe(true);

      container?.ownerDocument.dispatchEvent({ type: 'click', target: createMockEl() });

      expect(gears?.hasClass('open')).toBe(false);
      expect(current?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should not expose effort options on hover', () => {
      const stylesheet = readFileSync('src/style/toolbar/thinking-selector.css', 'utf8');
      expect(stylesheet).not.toContain('.grimoire-thinking-gears:hover .grimoire-thinking-options');
    });

    it('should close effort options after selecting an effort item', async () => {
      const current = parentEl.querySelector('.grimoire-thinking-current');
      const gears = parentEl.querySelector('.grimoire-thinking-gears');
      const options = parentEl.querySelector('.grimoire-thinking-options');
      const mediumGear = options?.children.find((gear: any) => gear.textContent === 'Medium');

      await current?.dispatchEvent('click', { stopPropagation: () => {} });
      expect(gears?.hasClass('open')).toBe(true);

      await mediumGear?.dispatchEvent('click', { stopPropagation: () => {} });

      expect(callbacks.onEffortLevelChange).toHaveBeenCalledWith('medium');
      expect(gears?.hasClass('open')).toBe(false);
    });
  });

  describe('legacy mode (custom models)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      parentEl = createMockEl();
      callbacks = createMockCallbacks({
        getSettings: jest.fn().mockReturnValue({
          model: 'custom-model',
          thinkingBudget: 'low',
          effortLevel: 'high',
          serviceTier: 'default',
          permissionMode: 'normal',
          enableOpus1M: false,
          enableSonnet1M: false,
        }),
      });
      selector = new ThinkingBudgetSelector(parentEl, callbacks);
    });

    it('should hide effort selector for custom models', () => {
      const effort = parentEl.querySelector('.grimoire-thinking-effort');
      expect(effort?.style?.display).toBe('none');
    });

    it('should show budget selector for custom models', () => {
      const budget = parentEl.querySelector('.grimoire-thinking-budget');
      expect(budget?.style?.display).not.toBe('none');
    });

    it('should display current budget label', () => {
      const current = parentEl.querySelector('.grimoire-thinking-current');
      expect(current?.textContent).toBe('Low');
    });

    it('should display Off when budget is off', () => {
      callbacks.getSettings.mockReturnValue({
        model: 'custom-model',
        thinkingBudget: 'off',
        serviceTier: 'default',
        permissionMode: 'normal',
        enableOpus1M: false,
        enableSonnet1M: false,
      });
      selector.updateDisplay();
      const current = parentEl.querySelector('.grimoire-thinking-current');
      expect(current?.textContent).toBe('Off');
    });

    it('should render budget options in reverse order', () => {
      const options = parentEl.querySelector('.grimoire-thinking-options');
      expect(options).not.toBeNull();
      // THINKING_BUDGETS reversed: [xhigh, high, medium, low, off]
      const gears = options?.children || [];
      expect(gears.length).toBe(5);
      expect(gears[0]?.textContent).toBe('Extra high');
      expect(gears[4]?.textContent).toBe('Off');
    });

    it('should mark current budget as selected', () => {
      const options = parentEl.querySelector('.grimoire-thinking-options');
      const gears = options?.children || [];
      const lowGear = gears.find((g: any) => g.textContent === 'Low');
      expect(lowGear?.hasClass('selected')).toBe(true);
    });

    it('should call onThinkingBudgetChange when gear clicked', async () => {
      const options = parentEl.querySelector('.grimoire-thinking-options');
      const gears = options?.children || [];
      const highGear = gears.find((g: any) => g.textContent === 'High');

      await highGear?.dispatchEvent('click', { stopPropagation: () => {} });
      expect(callbacks.onThinkingBudgetChange).toHaveBeenCalledWith('high');
    });

    it('should set title with token count for non-off budgets', () => {
      const options = parentEl.querySelector('.grimoire-thinking-options');
      const gears = options?.children || [];
      const highGear = gears.find((g: any) => g.textContent === 'High');
      expect(highGear?.getAttribute('title')).toContain('16,000 tokens');
    });

    it('should set title as Disabled for off budget', () => {
      const options = parentEl.querySelector('.grimoire-thinking-options');
      const gears = options?.children || [];
      const offGear = gears.find((g: any) => g.textContent === 'Off');
      expect(offGear?.getAttribute('title')).toBe('Disabled');
    });
  });
});

describe('PermissionToggle', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    jest.clearAllMocks();
    setLocale('en');
    parentEl = createMockEl();
    callbacks = createMockCallbacks();
    new PermissionToggle(parentEl, callbacks);
  });

  const findOption = (root: any, label: string) => {
    const options = root.querySelector('.grimoire-permission-options');
    return options?.children.find((option: any) => option.textContent === label);
  };

  it('should create a container with permission-toggle class', () => {
    expect(parentEl.querySelector('.grimoire-permission-toggle')).not.toBeNull();
  });

  it('should display the localized current mode', () => {
    expect(parentEl.querySelector('.grimoire-permission-label')?.textContent).toBe('Safe');

    callbacks.getSettings.mockReturnValue({
      ...callbacks.getSettings(),
      permissionMode: 'full_access',
    });
    const parentEl2 = createMockEl();
    new PermissionToggle(parentEl2, callbacks);
    expect(parentEl2.querySelector('.grimoire-permission-label')?.textContent).toBe('Auto');

    callbacks.getSettings.mockReturnValue({
      ...callbacks.getSettings(),
      permissionMode: 'plan',
    });
    const parentEl3 = createMockEl();
    new PermissionToggle(parentEl3, callbacks);
    expect(parentEl3.querySelector('.grimoire-permission-label')?.textContent).toBe('Plan');
  });

  it('should open the mode options without changing mode immediately', async () => {
    const label = parentEl.querySelector('.grimoire-permission-label');
    const gears = parentEl.querySelector('.grimoire-permission-gears');

    await label?.dispatchEvent('click', { stopPropagation: jest.fn() });

    expect(gears?.hasClass('open')).toBe(true);
    expect(label?.getAttribute('aria-expanded')).toBe('true');
    expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();
  });

  it('should expose the mode menu and options to the keyboard', async () => {
    const label = parentEl.querySelector('.grimoire-permission-label');
    const autoOption = findOption(parentEl, 'Auto');

    expect(label?.getAttribute('tabindex')).toBe('0');
    expect(autoOption?.getAttribute('tabindex')).toBe('0');
    await label?.dispatchEvent('keydown', {
      key: ' ',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });
    expect(parentEl.querySelector('.grimoire-permission-gears')?.hasClass('open')).toBe(true);

    await autoOption?.dispatchEvent('keydown', {
      key: 'Enter',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });
    expect(callbacks.onPermissionModeChange).toHaveBeenCalledWith('full_access');
  });

  it('should close the mode options after clicking outside the selector', async () => {
    const label = parentEl.querySelector('.grimoire-permission-label');
    const gears = parentEl.querySelector('.grimoire-permission-gears');
    const container = parentEl.querySelector('.grimoire-permission-toggle');

    await label?.dispatchEvent('click', { stopPropagation: jest.fn() });
    expect(gears?.hasClass('open')).toBe(true);

    container?.ownerDocument.dispatchEvent({ type: 'click', target: createMockEl() });

    expect(gears?.hasClass('open')).toBe(false);
    expect(label?.getAttribute('aria-expanded')).toBe('false');
  });

  it('should select Auto, Plan, and Safe from the option list', async () => {
    await findOption(parentEl, 'Auto')?.dispatchEvent('click', { stopPropagation: jest.fn() });
    expect(callbacks.onPermissionModeChange).toHaveBeenLastCalledWith('full_access');

    await findOption(parentEl, 'Plan')?.dispatchEvent('click', { stopPropagation: jest.fn() });
    expect(callbacks.onPermissionModeChange).toHaveBeenLastCalledWith('plan');

    await findOption(parentEl, 'Safe')?.dispatchEvent('click', { stopPropagation: jest.fn() });
    expect(callbacks.onPermissionModeChange).toHaveBeenLastCalledWith('normal');
  });

  it('should omit Plan when the provider does not support plan mode', () => {
    callbacks.getCapabilities.mockReturnValue({
      ...callbacks.getCapabilities(),
      supportsPlanMode: false,
    });
    const parentEl2 = createMockEl();
    new PermissionToggle(parentEl2, callbacks);

    const options = parentEl2.querySelector('.grimoire-permission-options')?.children ?? [];
    expect(options.map((option: any) => option.textContent)).toEqual(['Auto', 'Safe']);
  });

  it('should use an Obsidian localized mode tooltip', () => {
    const label = parentEl.querySelector('.grimoire-permission-label');
    expect(label?.getAttribute('title')).toBeNull();
    expect(setTooltip).toHaveBeenCalledWith(label, 'Work mode', { placement: 'top' });

    jest.clearAllMocks();
    setLocale('zh-CN');
    const parentEl2 = createMockEl();
    new PermissionToggle(parentEl2, callbacks);

    const localizedLabel = parentEl2.querySelector('.grimoire-permission-label');
    expect(localizedLabel?.textContent).toBe('安全');
    expect(setTooltip).toHaveBeenCalledWith(localizedLabel, '工作模式', { placement: 'top' });
  });

  it('should localize all Chinese mode options', () => {
    setLocale('zh-CN');
    const parentEl2 = createMockEl();
    new PermissionToggle(parentEl2, callbacks);

    const options = parentEl2.querySelector('.grimoire-permission-options')?.children ?? [];
    expect(options.map((option: any) => option.textContent)).toEqual(['计划', '自动', '安全']);
  });

  it('should hide the control when provider exposes no permission toggle UI', () => {
    callbacks.getChatUI.mockReturnValue(createMockChatUI({
      ...createMockUIConfig(),
      getPermissionModeToggle: jest.fn().mockReturnValue(null),
    }));
    const parentEl2 = createMockEl();
    new PermissionToggle(parentEl2, callbacks);

    const container = parentEl2.querySelector('.grimoire-permission-toggle');
    expect(container?.style.display).toBe('none');
  });

  it('should hide the control when visibility is disabled explicitly', () => {
    const parentEl2 = createMockEl();
    const toggle = new PermissionToggle(parentEl2, callbacks);

    toggle.setVisible(false);

    const container = parentEl2.querySelector('.grimoire-permission-toggle');
    expect(container?.style.display).toBe('none');
  });
});

describe('ServiceTierToggle', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    const uiConfig = createMockUIConfig();
    uiConfig.getServiceTierToggle.mockReturnValue({
      inactiveValue: 'default',
      inactiveLabel: 'Standard',
      activeValue: 'fast',
      activeLabel: 'Fast',
      description: '1.5x speed, 2x credits',
    });
    callbacks = createMockCallbacks({
      getChatUI: jest.fn().mockReturnValue(createMockChatUI(uiConfig)),
      getSettings: jest.fn().mockReturnValue({
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        thinkingBudget: 'off',
        effortLevel: 'medium',
        serviceTier: 'default',
        permissionMode: 'normal',
      }),
    });
    new ServiceTierToggle(parentEl, callbacks);
  });

  it('shows the control when the provider exposes service tier options', () => {
    const container = parentEl.querySelector('.grimoire-service-tier-toggle');
    expect(container).not.toBeNull();
    expect(container?.hasClass('grimoire-hidden')).toBe(false);
  });

  it('renders the icon button in the inactive state when fast mode is off', () => {
    const button = parentEl.querySelector('.grimoire-service-tier-button');
    const icon = parentEl.querySelector('.grimoire-service-tier-icon');
    const container = parentEl.querySelector('.grimoire-service-tier-toggle');
    expect(button?.hasClass('active')).toBe(false);
    expect(icon).not.toBeNull();
    expect(container?.getAttribute('title')).toBe('Toggle on/off fast mode');
  });

  it('renders the icon button in the active state when fast mode is on', () => {
    callbacks.getSettings.mockReturnValue({
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      thinkingBudget: 'off',
      effortLevel: 'medium',
      serviceTier: 'fast',
      permissionMode: 'normal',
    });
    const parentEl2 = createMockEl();
    new ServiceTierToggle(parentEl2, callbacks);

    const button = parentEl2.querySelector('.grimoire-service-tier-button');
    const container = parentEl2.querySelector('.grimoire-service-tier-toggle');
    expect(button?.hasClass('active')).toBe(true);
    expect(container?.getAttribute('title')).toBe('Toggle on/off fast mode');
  });

  it('toggles from Standard to Fast on click', async () => {
    const button = parentEl.querySelector('.grimoire-service-tier-button');
    await button?.dispatchEvent('click');
    expect(callbacks.onServiceTierChange).toHaveBeenCalledWith('fast');
  });

  it('toggles from Fast to Standard on click', async () => {
    callbacks.getSettings.mockReturnValue({
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      thinkingBudget: 'off',
      effortLevel: 'medium',
      serviceTier: 'fast',
      permissionMode: 'normal',
    });
    const parentEl2 = createMockEl();
    new ServiceTierToggle(parentEl2, callbacks);

    const button = parentEl2.querySelector('.grimoire-service-tier-button');
    await button?.dispatchEvent('click');
    expect(callbacks.onServiceTierChange).toHaveBeenCalledWith('default');
  });

  it('hides the control when the provider exposes no service tier UI', () => {
    callbacks.getChatUI.mockReturnValue(createMockChatUI({
      ...createMockUIConfig(),
      getServiceTierToggle: jest.fn().mockReturnValue(null),
    }));
    const parentEl2 = createMockEl();
    new ServiceTierToggle(parentEl2, callbacks);

    const container = parentEl2.querySelector('.grimoire-service-tier-toggle');
    expect(container?.style.display).toBe('none');
  });
});

describe('McpServerSelector', () => {
  let parentEl: any;
  let selector: McpServerSelector;

  function createMockMcpManager(servers: { name: string; enabled: boolean; contextSaving?: boolean }[] = []) {
    return {
      getServers: jest.fn().mockReturnValue(
        servers.map(s => ({
          name: s.name,
          enabled: s.enabled,
          contextSaving: s.contextSaving ?? false,
        }))
      ),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    selector = new McpServerSelector(parentEl);
  });

  it('should create container with mcp-selector class', () => {
    const container = parentEl.querySelector('.grimoire-mcp-selector');
    expect(container).not.toBeNull();
  });

  it('should return empty set of enabled servers initially', () => {
    expect(selector.getEnabledServers().size).toBe(0);
  });

  it('should hide container when no servers configured', () => {
    selector.setMcpManager(createMockMcpManager([]));
    const container = parentEl.querySelector('.grimoire-mcp-selector');
    expect(container?.style.display).toBe('none');
  });

  it('should show container when servers are configured', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'test', enabled: true }]));
    const container = parentEl.querySelector('.grimoire-mcp-selector');
    expect(container?.hasClass('grimoire-hidden')).toBe(false);
  });

  it('should show empty message when all servers are disabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'test', enabled: false }]));
    const empty = parentEl.querySelector('.grimoire-mcp-selector-empty');
    expect(empty?.textContent).toBe('All MCP servers disabled');
  });

  it('should show no servers message when no servers configured', () => {
    selector.setMcpManager(createMockMcpManager([]));
    const empty = parentEl.querySelector('.grimoire-mcp-selector-empty');
    expect(empty?.textContent).toBe('No MCP servers configured');
  });

  it('should add mentioned servers', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.addMentionedServers(new Set(['server1']));
    expect(selector.getEnabledServers().has('server1')).toBe(true);
  });

  it('should not re-render when adding already enabled servers', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.addMentionedServers(new Set(['server1']));
    const enabledBefore = selector.getEnabledServers();

    selector.addMentionedServers(new Set(['server1']));
    expect(selector.getEnabledServers()).toEqual(enabledBefore);
  });

  it('should clear all enabled servers', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.addMentionedServers(new Set(['server1', 'server2']));
    expect(selector.getEnabledServers().size).toBe(2);

    selector.clearEnabled();
    expect(selector.getEnabledServers().size).toBe(0);
  });

  it('should set enabled servers from array', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);
    expect(selector.getEnabledServers().size).toBe(2);
  });

  it('should prune enabled servers that no longer exist in manager', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);

    // Now update manager to only have server1
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    expect(selector.getEnabledServers().has('server1')).toBe(true);
    expect(selector.getEnabledServers().has('server2')).toBe(false);
  });

  it('should invoke onChange callback when pruning removes servers', () => {
    const onChange = jest.fn();
    selector.setOnChange(onChange);

    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);
    onChange.mockClear();

    // Prune by removing server2
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    expect(onChange).toHaveBeenCalled();
  });

  it('should show badge when more than 1 server enabled', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
      { name: 'server2', enabled: true },
    ]));
    selector.setEnabledServers(['server1', 'server2']);
    selector.updateDisplay();

    const badge = parentEl.querySelector('.grimoire-mcp-selector-badge');
    expect(badge?.hasClass('visible')).toBe(true);
    expect(badge?.textContent).toBe('2');
  });

  it('should not show badge when only 1 server enabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.setEnabledServers(['server1']);
    selector.updateDisplay();

    const badge = parentEl.querySelector('.grimoire-mcp-selector-badge');
    expect(badge?.hasClass('visible')).toBe(false);
  });

  it('should add active class to icon when servers are enabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.setEnabledServers(['server1']);
    selector.updateDisplay();

    const icon = parentEl.querySelector('.grimoire-mcp-selector-icon');
    expect(icon?.hasClass('active')).toBe(true);
  });

  it('should remove active class from icon when no servers enabled', () => {
    selector.setMcpManager(createMockMcpManager([{ name: 'server1', enabled: true }]));
    selector.clearEnabled();
    selector.updateDisplay();

    const icon = parentEl.querySelector('.grimoire-mcp-selector-icon');
    expect(icon?.hasClass('active')).toBe(false);
  });

  it('should handle null mcpManager', () => {
    selector.setMcpManager(null);
    expect(selector.getEnabledServers().size).toBe(0);
  });
});

describe('ContextUsageMeter', () => {
  let parentEl: any;
  let meter: ContextUsageMeter;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    meter = new ContextUsageMeter(parentEl);
  });

  it('should create a container with context-meter class', () => {
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container).not.toBeNull();
  });

  it('should expose the compact header badge accessibility contract', () => {
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.getAttribute('role')).toBe('button');
    expect(container?.getAttribute('tabindex')).toBe('0');
  });

  it('should be hidden initially', () => {
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.style.display).toBe('none');
  });

  it('should remain hidden when update called with null', () => {
    meter.update(null);
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.style.display).toBe('none');
  });

  it('should remain hidden when contextTokens is 0', () => {
    meter.update(makeUsage({ contextTokens: 0, contextWindow: 200000, percentage: 0 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.style.display).toBe('none');
  });

  it('should support a header mode that stays visible at 0%', () => {
    const headerParentEl = createMockEl();
    const headerMeter = new ContextUsageMeter(headerParentEl, { showWhenEmpty: true });

    headerMeter.update(null);

    const container = headerParentEl.querySelector('.grimoire-context-meter');
    expect(container?.style.display).toBe('flex');
    expect(headerParentEl.querySelector('.grimoire-context-meter-percent')?.textContent).toBe('0%');
    expect(setTooltip).toHaveBeenCalledWith(container, 'No context used yet', { placement: 'bottom' });
  });

  it('should become visible when contextTokens > 0', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.style.display).toBe('flex');
  });

  it('should display percentage', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const percent = parentEl.querySelector('.grimoire-context-meter-percent');
    expect(percent?.textContent).toBe('25%');
  });

  it('should add warning class when usage > 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.hasClass('warning')).toBe(true);
  });

  it('should remove warning class when usage drops below 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(container?.hasClass('warning')).toBe(false);
  });

  it('should use a plain tooltip containing only used and total context', () => {
    meter.update(makeUsage({ contextTokens: 50000, contextWindow: 200000, percentage: 25 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(setTooltip).toHaveBeenCalledWith(container, '50k / 200k tokens', { placement: 'bottom' });
    expect(parentEl.querySelector('.grimoire-context-meter-tip')).toBeNull();
  });

  it('should format small token counts without k suffix', () => {
    meter.update(makeUsage({ contextTokens: 500, contextWindow: 200000, percentage: 0 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(setTooltip).toHaveBeenCalledWith(container, '500 / 200k tokens', { placement: 'bottom' });
  });

  it('should keep the plain tooltip when usage is above 80%', () => {
    meter.update(makeUsage({ contextTokens: 170000, contextWindow: 200000, percentage: 85 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(setTooltip).toHaveBeenCalledWith(container, '170k / 200k tokens', { placement: 'bottom' });
  });

  it('should keep the plain tooltip when usage is at 80%', () => {
    meter.update(makeUsage({ contextTokens: 160000, contextWindow: 200000, percentage: 80 }));
    const container = parentEl.querySelector('.grimoire-context-meter');
    expect(setTooltip).toHaveBeenCalledWith(container, '160k / 200k tokens', { placement: 'bottom' });
  });
});

describe('McpServerSelector - toggle and badges', () => {
  let parentEl: any;
  let selector: McpServerSelector;

  function createMockMcpManager(servers: { name: string; enabled: boolean; contextSaving?: boolean }[] = []) {
    return {
      getServers: jest.fn().mockReturnValue(
        servers.map(s => ({
          name: s.name,
          enabled: s.enabled,
          contextSaving: s.contextSaving ?? false,
        }))
      ),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl();
    selector = new McpServerSelector(parentEl);
  });

  it('should render context-saving badge for servers with contextSaving', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true, contextSaving: true },
    ]));

    const csBadge = parentEl.querySelector('.grimoire-mcp-selector-cs-badge');
    expect(csBadge).not.toBeNull();
    expect(csBadge?.textContent).toBe('@');
  });

  it('should not render context-saving badge for servers without contextSaving', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true, contextSaving: false },
    ]));

    const csBadge = parentEl.querySelector('.grimoire-mcp-selector-cs-badge');
    expect(csBadge).toBeNull();
  });

  it('should toggle server on mousedown and update display', () => {
    const onChange = jest.fn();
    selector.setOnChange(onChange);

    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
    ]));

    // Find the server item and trigger mousedown
    const item = parentEl.querySelector('.grimoire-mcp-selector-item');
    expect(item).not.toBeNull();

    // Simulate mousedown to enable
    const mousedownHandlers = item._eventListeners?.get('mousedown');
    expect(mousedownHandlers).toBeDefined();
    mousedownHandlers![0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

    expect(selector.getEnabledServers().has('server1')).toBe(true);
    expect(onChange).toHaveBeenCalled();

    // Toggle again to disable
    onChange.mockClear();
    mousedownHandlers![0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });

    expect(selector.getEnabledServers().has('server1')).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it('should re-render dropdown on mouseenter', () => {
    selector.setMcpManager(createMockMcpManager([
      { name: 'server1', enabled: true },
    ]));

    // Get container and trigger mouseenter
    const container = parentEl.querySelector('.grimoire-mcp-selector');
    const mouseenterHandlers = container?._eventListeners?.get('mouseenter');
    expect(mouseenterHandlers).toBeDefined();

    // Should not throw
    expect(() => mouseenterHandlers![0]()).not.toThrow();
  });
});

describe('ExternalContextSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a compact paperclip action while preserving the accessible tooltip', () => {
    const parentEl = createMockEl();
    const selector = new (require('@/features/chat/ui/InputToolbar').ExternalContextSelector)(parentEl);
    const buttonEl = parentEl.querySelector('.grimoire-external-context-icon-wrapper');
    const iconEl = parentEl.querySelector('.grimoire-external-context-icon');

    expect(selector).toBeDefined();
    expect(setIcon).toHaveBeenCalledWith(iconEl, 'paperclip');
    expect(buttonEl?.getAttribute('aria-label')).toBe('Add external contexts');
    expect(setTooltip).toHaveBeenCalledWith(buttonEl, 'Add external contexts', { placement: 'top' });
  });

  it('opens a picker that allows selecting files as well as directories', async () => {
    const remote = {
      dialog: {
        showOpenDialog: jest.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      },
    };
    jest.isolateModules(() => {
      jest.doMock('electron', () => ({ remote }), { virtual: true });
      const { ExternalContextSelector } = require('@/features/chat/ui/InputToolbar');
      const parentEl = createMockEl();
      new ExternalContextSelector(parentEl);

      parentEl.querySelector('.grimoire-external-context-icon-wrapper')?.click();
    });

    await Promise.resolve();

    expect(remote.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openFile', 'openDirectory'],
    }));
  });
});

describe('OrchestratorToggle', () => {
  let parentEl: any;
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    setLocale('en');
    parentEl = createMockEl();
    callbacks = createMockCallbacks();
  });

  it('should create an orchestrator toggle container', () => {
    new OrchestratorToggle(parentEl, callbacks);

    expect(parentEl.querySelector('.grimoire-orchestrator-toggle')).not.toBeNull();
  });

  it('should show active state when orchestrator mode is enabled', () => {
    callbacks.getOrchestratorMode.mockReturnValue(true);

    new OrchestratorToggle(parentEl, callbacks);

    expect(parentEl.querySelector('.grimoire-orchestrator-button')?.hasClass('active')).toBe(true);
  });

  it('should call onOrchestratorModeChange when clicked', async () => {
    new OrchestratorToggle(parentEl, callbacks);

    parentEl.querySelector('.grimoire-orchestrator-button')?.click();
    await Promise.resolve();

    expect(callbacks.onOrchestratorModeChange).toHaveBeenCalledTimes(1);
  });

  it('should localize its tooltip and accessible label', () => {
    setLocale('ru');

    new OrchestratorToggle(parentEl, callbacks);

    const button = parentEl.querySelector('.grimoire-orchestrator-button');
    expect(parentEl.querySelector('.grimoire-orchestrator-toggle')?.getAttribute('title')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Переключить параллельных исполнителей');
    expect(setTooltip).toHaveBeenCalledWith(button, 'Параллельные исполнители', { placement: 'top' });
  });
});

describe('createInputToolbar', () => {
  it('should return all toolbar components', () => {
    const parentEl = createMockEl();
    const callbacks = createMockCallbacks();
    const toolbar = createInputToolbar(parentEl, callbacks);

    expect(toolbar.modelSelector).toBeInstanceOf(ModelSelector);
    expect(toolbar.modeSelector).toBeInstanceOf(ModeSelector);
    expect(toolbar.thinkingBudgetSelector).toBeInstanceOf(ThinkingBudgetSelector);
    expect(toolbar.contextUsageMeter).toBeInstanceOf(ContextUsageMeter);
    expect(toolbar.mcpServerSelector).toBeInstanceOf(McpServerSelector);
    expect(toolbar.permissionToggle).toBeInstanceOf(PermissionToggle);
    expect(toolbar.serviceTierToggle).toBeInstanceOf(ServiceTierToggle);
    expect(toolbar.planUsageBadge).toBeInstanceOf(PlanUsageBadge);
    expect(toolbar.orchestratorToggle).toBeInstanceOf(OrchestratorToggle);
    expect(toolbar.projectWorkspaceSelector).toBeInstanceOf(ProjectWorkspaceSelector);
    expect(toolbar.relevantNotesContainerEl).toBeDefined();
  });

  it('should group left-aligned configuration controls separately from send actions', () => {
    const parentEl = createMockEl();
    const callbacks = createMockCallbacks();

    createInputToolbar(parentEl, callbacks);

    const actionsRow = parentEl.children.find((child: any) => child.hasClass('grimoire-input-toolbar-actions-row'));
    expect(actionsRow).toBeDefined();
    const modelStack = actionsRow.children.find((child: any) => child.hasClass('grimoire-model-context-stack'));
    const configActions = actionsRow.children.find((child: any) => child.hasClass('grimoire-input-toolbar-config-actions'));
    expect(modelStack).toBeDefined();
    expect(configActions).toBeDefined();
    const permissionIndex = configActions.children.findIndex((child: any) => child.hasClass('grimoire-permission-toggle'));
    const modeIndex = configActions.children.findIndex((child: any) => child.hasClass('grimoire-mode-selector'));
    const orchestratorIndex = configActions.children.findIndex((child: any) => child.hasClass('grimoire-orchestrator-toggle'));
    expect(permissionIndex).toBeGreaterThanOrEqual(0);
    expect(modeIndex).toBeGreaterThan(permissionIndex);
    expect(orchestratorIndex).toBeGreaterThan(modeIndex);
  });

  it('should place the relevant notes slot beside the model selector', () => {
    const parentEl = createMockEl();
    const callbacks = createMockCallbacks();
    const toolbar = createInputToolbar(parentEl, callbacks);

    const modelRow = parentEl.children.find((child: any) => child.hasClass('grimoire-input-toolbar-model-row'));
    const actionsRow = parentEl.children.find((child: any) => child.hasClass('grimoire-input-toolbar-actions-row'));
    const stack = modelRow?.children.find((child: any) => child.hasClass('grimoire-model-context-stack'));

    expect(stack).toBeDefined();
    expect(modelRow).toBe(actionsRow);
    expect(stack.children[0]?.hasClass('grimoire-model-selector')).toBe(true);
    expect(stack.children[1]?.hasClass('grimoire-plan-usage-badge')).toBe(true);
    expect(stack.children[2]).toBe(toolbar.relevantNotesContainerEl);
    expect(toolbar.relevantNotesContainerEl.hasClass('grimoire-relevant-notes-slot')).toBe(true);
  });
});

describe('ProjectWorkspaceSelector', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('is hidden when no workspaces exist', () => {
    const parentEl = createMockEl();
    const callbacks = createMockCallbacks({
      getProjectWorkspaces: jest.fn().mockReturnValue([]),
    });

    new ProjectWorkspaceSelector(parentEl, callbacks);

    const selector = parentEl.querySelector('.grimoire-project-workspace-selector');
    expect(selector?.hasClass('grimoire-hidden')).toBe(true);
  });

  it('saves active workspace changes', async () => {
    const parentEl = createMockEl();
    const callbacks = createMockCallbacks({
      getProjectWorkspaces: jest.fn().mockReturnValue([
        {
          id: 'workspace-1',
          name: 'Project Alpha',
          systemPrompt: '',
          vaultFolders: [],
          vaultFiles: [],
          tags: [],
          externalContextPaths: [],
        },
      ]),
      getActiveProjectWorkspaceId: jest.fn().mockReturnValue(''),
    });

    new ProjectWorkspaceSelector(parentEl, callbacks);

    const select = findByTag(parentEl, 'select') as HTMLSelectElement;
    select.value = 'workspace-1';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(callbacks.onProjectWorkspaceChange).toHaveBeenCalledWith('workspace-1');
  });

  it('localizes the empty and fallback workspace labels', () => {
    const parentEl = createMockEl();
    const callbacks = createMockCallbacks({
      getProjectWorkspaces: jest.fn().mockReturnValue([
        {
          id: 'workspace-1',
          name: '',
          systemPrompt: '',
          vaultFolders: [],
          vaultFiles: [],
          tags: [],
          externalContextPaths: [],
        },
      ]),
      getActiveProjectWorkspaceId: jest.fn().mockReturnValue(''),
    });
    setLocale('de');

    new ProjectWorkspaceSelector(parentEl, callbacks);

    const select = findByTag(parentEl, 'select') as HTMLSelectElement;
    const options = select.children as unknown as HTMLElement[];
    expect(options[0]?.textContent).toBe('Kein Arbeitsbereich');
    expect(options[1]?.textContent).toBe('Unbenannter Arbeitsbereich');
  });
});
