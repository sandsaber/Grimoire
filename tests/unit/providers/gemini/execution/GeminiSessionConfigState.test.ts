// The permission mode is read through the settings coordinator, which asks the
// registry for this provider's chat UI config.
import '@/providers';

import { GeminiSessionConfigState } from '@/providers/gemini/execution/GeminiSessionConfigState';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '@/providers/gemini/settings';

/**
 * What a Gemini session is configured with, and what the vault knows of it.
 *
 * Reached through `GeminiChatRuntime` before the flip deleted it. The state is
 * the same object the runtime delegated to, so these are the same assertions
 * against one fewer layer.
 */
describe('GeminiSessionConfigState', () => {
  function createState(settings: Record<string, unknown> = {}): {
    state: GeminiSessionConfigState;
    settings: Record<string, unknown>;
  } {
    updateGeminiProviderSettings(settings, { enabled: true });
    return { state: new GeminiSessionConfigState({ settingsBag: () => settings }), settings };
  }

  describe('what a session reported about itself', () => {
    it('seeds the visible models from a session that has never been asked', () => {
      const { state, settings } = createState();

      expect(state.syncSessionDiscovery({
        models: {
          availableModels: [
            { id: 'auto', name: 'Auto', description: 'Let Gemini CLI decide' },
            { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
          ],
          currentModelId: 'auto',
        },
      })).toBe(true);

      const stored = getGeminiProviderSettings(settings);
      expect(stored.visibleModels).toEqual(['auto', 'gemini-2.5-pro']);
      expect(stored.discoveredModels).toEqual([
        { description: 'Let Gemini CLI decide', label: 'Auto', rawId: 'auto' },
        { label: 'gemini-2.5-pro', rawId: 'gemini-2.5-pro' },
      ]);
      expect(state.sessionModelId).toBe('auto');
    });

    it('replaces a stale catalogue rather than merging into it', () => {
      const { state, settings } = createState();
      updateGeminiProviderSettings(settings, {
        discoveredModels: [{ label: 'Gone', rawId: 'gemini-1.0-ultra' }],
        visibleModels: ['gemini-1.0-ultra'],
      });

      state.syncSessionDiscovery({
        models: {
          availableModels: [{ id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }],
          currentModelId: 'gemini-2.5-pro',
        },
      });

      expect(getGeminiProviderSettings(settings).visibleModels).toEqual(['gemini-2.5-pro']);
    });

    it('reports nothing changed when the session named nothing', () => {
      // The caller saves the vault on this answer; a truthy one on every
      // session open is a settings write per turn.
      const { state } = createState();

      expect(state.syncSessionDiscovery({})).toBe(false);
    });

    it('records where the agent starts without moving what the user picked', () => {
      // The fifth review's G1. `selectedMode` is what the toolbar reads back and
      // what the next turn's mode is resolved from, so adopting the mode a
      // session opens in talks a vault out of its own choice.
      const { state, settings } = createState();
      updateGeminiProviderSettings(settings, { selectedMode: 'plan' });

      state.syncSessionDiscovery({
        modes: {
          availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }],
          currentModeId: 'default',
        },
      });

      expect(getGeminiProviderSettings(settings).selectedMode).toBe('plan');
      // Recorded all the same, in the agent's own vocabulary: it is what a
      // redundant `set_mode` would be skipped on.
      expect(state.sessionModeId).toBe('default');
      expect(getGeminiProviderSettings(settings).availableModes).toEqual([
        { id: 'default', name: 'Default' },
        { id: 'yolo', name: 'YOLO' },
      ]);
    });
  });

  describe('a mode somebody switched the session to', () => {
    it('translates on the way into the vault and keeps the raw id beside it', () => {
      const { state, settings } = createState();

      expect(state.adoptCurrentMode('autoEdit')).toBe('normal');

      expect(getGeminiProviderSettings(settings).selectedMode).toBe('normal');
      expect(state.sessionModeId).toBe('autoEdit');
    });

    it('maps the agent yolo mode back to Auto-approve', () => {
      const { state, settings } = createState();

      expect(state.adoptCurrentMode('yolo')).toBe('full_access');
      expect(getGeminiProviderSettings(settings).selectedMode).toBe('full_access');
    });
  });

  describe('what the live session was set to', () => {
    it('forgets the model and the mode together', () => {
      // Both are what an applier skips its call on. Kept across a session
      // change, the next turn believes the new session is already in a mode
      // nobody set it to — and runs in the agent's default while the toolbar
      // says Plan.
      const { state } = createState();
      state.markApplied({ modeId: 'plan', modelId: 'gemini-2.5-pro' });

      state.forgetSession();

      expect(state.sessionModeId).toBeNull();
      expect(state.sessionModelId).toBeNull();
    });
  });

  describe('what a turn should run under', () => {
    it('prefers the permission mode over the stored selection', () => {
      const { state, settings } = createState();
      settings.permissionMode = 'full_access';
      settings.savedProviderPermissionMode = { gemini: 'full_access' };
      updateGeminiProviderSettings(settings, { selectedMode: 'normal' });

      expect(state.resolveSelectedModeId()).toBe('full_access');
      expect(state.fullAccess()).toBe(true);
    });

    it('reads its own permission mode, not whichever provider was toggled last', () => {
      // `settings.permissionMode` is shared: the coordinator projects the
      // active provider's value into it. Reading it directly is how another
      // provider's Auto-approve came to switch off this one's containment.
      const { state, settings } = createState();
      settings.permissionMode = 'full_access';
      settings.savedProviderPermissionMode = { gemini: 'normal' };

      expect(state.fullAccess()).toBe(false);
    });

    it('asks for the model the query named, decoded out of the chat id', () => {
      const { state } = createState();

      expect(state.resolveSelectedRawModelId({ model: 'gemini:gemini-2.5-pro' }))
        .toBe('gemini-2.5-pro');
    });

    it('asks for nothing at all before a session has said what exists', () => {
      // A tab's first turn on a fresh vault: the model list is answered by
      // `session/new`, so there is nothing to name yet and the agent runs on
      // its own current model.
      const { state } = createState();

      expect(state.resolveSelectedRawModelId()).toBeNull();
    });

    it('falls back to the vault saved model, then to the first it discovered', () => {
      const { state, settings } = createState();
      updateGeminiProviderSettings(settings, { visibleModels: ['auto', 'gemini-2.5-pro'] });

      expect(state.resolveSelectedRawModelId()).toBe('auto');

      settings.savedProviderModel = { gemini: 'gemini:gemini-2.5-pro' };
      expect(state.resolveSelectedRawModelId()).toBe('gemini-2.5-pro');
    });

    it('labels the badge with the model the session is actually on', () => {
      const { state, settings } = createState();
      updateGeminiProviderSettings(settings, { visibleModels: ['gemini-2.5-pro'] });

      expect(state.getActiveDisplayModel()).toBe('gemini:gemini-2.5-pro');

      state.markApplied({ modelId: 'gemini-3.5-flash' });
      expect(state.getActiveDisplayModel()).toBe('gemini:gemini-3.5-flash');
    });
  });
});
