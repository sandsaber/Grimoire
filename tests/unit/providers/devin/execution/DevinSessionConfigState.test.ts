// The permission mode is read through the settings coordinator, which asks the
// registry for this provider's chat UI config.
import '@/providers';

import { DevinSessionConfigState } from '@/providers/devin/execution/DevinSessionConfigState';
import { getDevinProviderSettings, updateDevinProviderSettings } from '@/providers/devin/settings';

/** The `configOptions` the recorded `session/new` answers with, shortened. */
function recordedConfigOptions(): NonNullable<Parameters<DevinSessionConfigState['syncSessionDiscovery']>[0]['configOptions']> {
  return [
    {
      id: 'mode',
      name: 'Session Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'accept-edits',
      options: [
        { value: 'accept-edits', name: 'Code', description: 'Write and edit code' },
        { value: 'smart', name: 'Smart', description: 'Auto-approve actions the model judges safe' },
        { value: 'ask', name: 'Ask', description: 'Answer questions without code changes' },
        { value: 'plan', name: 'Plan', description: 'Plan changes before implementing' },
        { value: 'bypass', name: 'Bypass Permissions', description: 'Auto-approve all tool calls' },
      ],
    },
    {
      id: 'model',
      name: 'Model',
      description: 'AI model to use',
      category: 'model',
      type: 'select',
      currentValue: 'swe-1-6-slow',
      options: [
        { value: 'swe-1-6-slow', name: 'SWE-1.6 Slow' },
        { value: 'claude-opus-5-medium', name: 'Claude Opus 5 Medium' },
      ],
    },
  ] as never;
}

describe('DevinSessionConfigState', () => {
  function createState(settings: Record<string, unknown> = {}): {
    state: DevinSessionConfigState;
    settings: Record<string, unknown>;
  } {
    updateDevinProviderSettings(settings, { enabled: true });
    return { state: new DevinSessionConfigState({ settingsBag: () => settings }), settings };
  }

  describe('what a session reported about itself', () => {
    it('seeds the models and modes from the config options a session opens with', () => {
      const { state, settings } = createState();

      expect(state.syncSessionDiscovery({ configOptions: recordedConfigOptions() })).toBe(true);

      const stored = getDevinProviderSettings(settings);
      expect(stored.visibleModels).toEqual(['swe-1-6-slow', 'claude-opus-5-medium']);
      expect(stored.discoveredModels).toEqual([
        { label: 'SWE-1.6 Slow', rawId: 'swe-1-6-slow' },
        { label: 'Claude Opus 5 Medium', rawId: 'claude-opus-5-medium' },
      ]);
      expect(stored.availableModes.map(mode => mode.id))
        .toEqual(['accept-edits', 'smart', 'ask', 'plan', 'bypass']);
      expect(state.sessionModelId).toBe('swe-1-6-slow');
      expect(state.sessionModeId).toBe('accept-edits');
    });

    it('replaces a stale catalogue rather than merging into it', () => {
      // A different account offers a different list, and the old one must go.
      const { state, settings } = createState();
      updateDevinProviderSettings(settings, {
        discoveredModels: [{ label: 'Gone', rawId: 'gpt-5-6-sol-low' }],
        visibleModels: ['gpt-5-6-sol-low'],
      });

      state.syncSessionDiscovery({ configOptions: recordedConfigOptions() });

      expect(getDevinProviderSettings(settings).visibleModels)
        .toEqual(['swe-1-6-slow', 'claude-opus-5-medium']);
    });

    it('reports nothing changed when the session named nothing', () => {
      const { state } = createState();

      expect(state.syncSessionDiscovery({})).toBe(false);
    });

    it('records where the agent starts without moving what the user picked', () => {
      const { state, settings } = createState();
      updateDevinProviderSettings(settings, { selectedMode: 'plan' });

      state.syncSessionDiscovery({ configOptions: recordedConfigOptions() });

      expect(getDevinProviderSettings(settings).selectedMode).toBe('plan');
      expect(state.sessionModeId).toBe('accept-edits');
    });
  });

  describe('a mode somebody switched the session to', () => {
    it('translates on the way into the vault and keeps the raw id beside it', () => {
      const { state, settings } = createState();

      expect(state.adoptCurrentMode('smart')).toBe('normal');

      expect(getDevinProviderSettings(settings).selectedMode).toBe('normal');
      expect(state.sessionModeId).toBe('smart');
    });

    it('maps the agent bypass mode back to Auto-approve', () => {
      const { state, settings } = createState();

      expect(state.adoptCurrentMode('bypass')).toBe('full_access');
      expect(getDevinProviderSettings(settings).selectedMode).toBe('full_access');
    });
  });

  describe('what the live session was set to', () => {
    it('forgets the model and the mode together', () => {
      const { state } = createState();
      state.markApplied({ modeId: 'plan', modelId: 'swe-1-6-slow' });

      state.forgetSession();

      expect(state.sessionModeId).toBeNull();
      expect(state.sessionModelId).toBeNull();
    });
  });

  describe('what a turn should run under', () => {
    it('prefers the permission mode over the stored selection', () => {
      const { state, settings } = createState();
      settings.permissionMode = 'full_access';
      settings.savedProviderPermissionMode = { devin: 'full_access' };
      updateDevinProviderSettings(settings, { selectedMode: 'normal' });

      expect(state.resolveSelectedModeId()).toBe('full_access');
      expect(state.fullAccess()).toBe(true);
    });

    it('reads its own permission mode, not whichever provider was toggled last', () => {
      const { state, settings } = createState();
      settings.permissionMode = 'full_access';
      settings.savedProviderPermissionMode = { devin: 'normal' };

      expect(state.fullAccess()).toBe(false);
    });

    it('asks for the model the query named, decoded out of the chat id', () => {
      const { state } = createState();

      expect(state.resolveSelectedRawModelId({ model: 'devin:swe-1-6-slow' }))
        .toBe('swe-1-6-slow');
    });

    it('asks for nothing at all before a session has said what exists', () => {
      const { state } = createState();

      expect(state.resolveSelectedRawModelId()).toBeNull();
    });

    it('falls back to the vault saved model, then to the first it discovered', () => {
      const { state, settings } = createState();
      updateDevinProviderSettings(settings, { visibleModels: ['swe-1-6-slow', 'claude-opus-5-medium'] });

      expect(state.resolveSelectedRawModelId()).toBe('swe-1-6-slow');

      settings.savedProviderModel = { devin: 'devin:claude-opus-5-medium' };
      expect(state.resolveSelectedRawModelId()).toBe('claude-opus-5-medium');
    });

    it('labels the badge with the model the session is actually on', () => {
      const { state, settings } = createState();
      updateDevinProviderSettings(settings, { visibleModels: ['swe-1-6-slow'] });

      expect(state.getActiveDisplayModel()).toBe('devin:swe-1-6-slow');

      state.markApplied({ modelId: 'claude-opus-5-medium' });
      expect(state.getActiveDisplayModel()).toBe('devin:claude-opus-5-medium');
    });
  });
});
