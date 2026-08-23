// The permission mode is read through the settings coordinator, which asks the
// registry for this provider's chat UI config.
import '@/providers';

import { QwenSessionConfigState } from '@/providers/qwen/execution/QwenSessionConfigState';
import { getQwenProviderSettings, updateQwenProviderSettings } from '@/providers/qwen/settings';

/**
 * What a Qwen session is configured with, and what the vault knows of it.
 *
 * Reached through `QwenChatRuntime` before the flip deleted it. The state is
 * the same object the runtime delegated to, so these are the same assertions
 * against one fewer layer.
 */
describe('QwenSessionConfigState', () => {
  function createState(settings: Record<string, unknown> = {}): {
    state: QwenSessionConfigState;
    settings: Record<string, unknown>;
  } {
    updateQwenProviderSettings(settings, { enabled: true });
    return { state: new QwenSessionConfigState({ settingsBag: () => settings }), settings };
  }

  describe('what a session reported about itself', () => {
    it('seeds the visible models from a session that has never been asked', () => {
      const { state, settings } = createState();

      expect(state.syncSessionDiscovery({
        models: {
          availableModels: [
            { id: 'auto', name: 'Auto', description: 'Let Qwen CLI decide' },
            { id: 'qwen3-coder-plus', name: 'qwen3-coder-plus' },
          ],
          currentModelId: 'auto',
        },
      })).toBe(true);

      const stored = getQwenProviderSettings(settings);
      expect(stored.visibleModels).toEqual(['auto', 'qwen3-coder-plus']);
      expect(stored.discoveredModels).toEqual([
        { description: 'Let Qwen CLI decide', label: 'Auto', rawId: 'auto' },
        { label: 'qwen3-coder-plus', rawId: 'qwen3-coder-plus' },
      ]);
      expect(state.sessionModelId).toBe('auto');
    });

    it('replaces a stale catalogue rather than merging into it', () => {
      const { state, settings } = createState();
      updateQwenProviderSettings(settings, {
        discoveredModels: [{ label: 'Gone', rawId: 'qwen-legacy' }],
        visibleModels: ['qwen-legacy'],
      });

      state.syncSessionDiscovery({
        models: {
          availableModels: [{ id: 'qwen3-coder-plus', name: 'qwen3-coder-plus' }],
          currentModelId: 'qwen3-coder-plus',
        },
      });

      expect(getQwenProviderSettings(settings).visibleModels).toEqual(['qwen3-coder-plus']);
    });

    it('reports nothing changed when the session named nothing', () => {
      // The caller saves the vault on this answer; a truthy one on every
      // session open is a settings write per turn.
      const { state } = createState();

      expect(state.syncSessionDiscovery({})).toBe(false);
    });

    it('records where the agent starts without moving what the user picked', () => {
      // The fifth review's G1, which this provider carried in a worse form:
      // the reported mode was written into `selectedMode` *and* pushed at the
      // toolbar, where `updatePlanModeUI` commits it. A vault on Plan, opening
      // a session that reports `default`, was switched to Safe and had it
      // saved — on every open and every resume.
      const { state, settings } = createState();
      updateQwenProviderSettings(settings, { selectedMode: 'plan' });

      state.syncSessionDiscovery({
        modes: {
          availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }],
          currentModeId: 'default',
        },
      });

      expect(getQwenProviderSettings(settings).selectedMode).toBe('plan');
      // Recorded all the same, in the agent's own vocabulary: it is what a
      // redundant `set_mode` would be skipped on.
      expect(state.sessionModeId).toBe('default');
      expect(getQwenProviderSettings(settings).availableModes).toEqual([
        { id: 'default', name: 'Default' },
        { id: 'yolo', name: 'YOLO' },
      ]);
    });
  });

  describe('a mode somebody switched the session to', () => {
    it('translates on the way into the vault and keeps the raw id beside it', () => {
      const { state, settings } = createState();

      expect(state.adoptCurrentMode('auto-edit')).toBe('normal');

      expect(getQwenProviderSettings(settings).selectedMode).toBe('normal');
      expect(state.sessionModeId).toBe('auto-edit');
    });

    it('maps the agent yolo mode back to Auto-approve', () => {
      const { state, settings } = createState();

      expect(state.adoptCurrentMode('yolo')).toBe('full_access');
      expect(getQwenProviderSettings(settings).selectedMode).toBe('full_access');
    });
  });

  describe('what the live session was set to', () => {
    it('forgets the model, the mode and the effort together', () => {
      // Both are what an applier skips its call on. Kept across a session
      // change, the next turn believes the new session is already in a mode
      // nobody set it to — and runs in the agent's default while the toolbar
      // says Plan.
      const { state } = createState();
      state.markApplied({ modeId: 'plan', modelId: 'qwen3-coder-plus', effortLevel: 'max' });

      state.forgetSession();

      expect(state.sessionModeId).toBeNull();
      expect(state.sessionModelId).toBeNull();
      // The effort matters most of the three: applying it sends a whole prompt,
      // so a level kept across a session change is a turn the new session never
      // received — and one the vendor still charged for.
      expect(state.sessionEffortLevel).toBeNull();
    });

    it('reports the level the vault is set to, normalized', () => {
      const { state, settings } = createState();
      updateQwenProviderSettings(settings, { effortLevel: 'xhigh' });

      expect(state.resolveSelectedEffortLevel()).toBe('xhigh');

      // A level this CLI does not have would reach it as a `/effort <level>`
      // prompt it cannot understand, which is a turn spent on nothing.
      updateQwenProviderSettings(settings, { effortLevel: 'ludicrous' as never });
      expect(state.resolveSelectedEffortLevel()).toBe('high');
    });
  });

  describe('what a turn should run under', () => {
    it('prefers the permission mode over the stored selection', () => {
      const { state, settings } = createState();
      settings.permissionMode = 'full_access';
      settings.savedProviderPermissionMode = { qwen: 'full_access' };
      updateQwenProviderSettings(settings, { selectedMode: 'normal' });

      expect(state.resolveSelectedModeId()).toBe('full_access');
      expect(state.fullAccess()).toBe(true);
    });

    it('reads its own permission mode, not whichever provider was toggled last', () => {
      // `settings.permissionMode` is shared: the coordinator projects the
      // active provider's value into it. Reading it directly is how another
      // provider's Auto-approve came to switch off this one's containment.
      const { state, settings } = createState();
      settings.permissionMode = 'full_access';
      settings.savedProviderPermissionMode = { qwen: 'normal' };

      expect(state.fullAccess()).toBe(false);
    });

    it('asks for the model the query named, decoded out of the chat id', () => {
      const { state } = createState();

      expect(state.resolveSelectedRawModelId({ model: 'qwen:qwen3-coder-plus' }))
        .toBe('qwen3-coder-plus');
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
      updateQwenProviderSettings(settings, { visibleModels: ['auto', 'qwen3-coder-plus'] });

      expect(state.resolveSelectedRawModelId()).toBe('auto');

      settings.savedProviderModel = { qwen: 'qwen:qwen3-coder-plus' };
      expect(state.resolveSelectedRawModelId()).toBe('qwen3-coder-plus');
    });

    it('labels the badge with the model the session is actually on', () => {
      const { state, settings } = createState();
      updateQwenProviderSettings(settings, { visibleModels: ['qwen3-coder-plus'] });

      expect(state.getActiveDisplayModel()).toBe('qwen:qwen3-coder-plus');

      state.markApplied({ modelId: 'qwen3-max' });
      expect(state.getActiveDisplayModel()).toBe('qwen:qwen3-max');
    });
  });
});
