import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { AcpSessionConfigOption } from '@/providers/acp/types';
import {
  type MimocodeSessionConfigPorts,
  MimocodeSessionConfigState,
} from '@/providers/mimocode/execution/MimocodeSessionConfigState';
import { MIMOCODE_DEFAULT_THINKING_LEVEL } from '@/providers/mimocode/models';

/**
 * What `MimocodeChatRuntime` used to hold in five fields, now held here.
 *
 * The runtime's own suite covers the paths it still drives. What it cannot
 * cover is what the extraction added for the composition — the three ways of
 * forgetting a session, which are deliberately not the same, and the level a
 * turn wants before any session has said which levels exist.
 */
describe('MimocodeSessionConfigState', () => {
  function createState(settings: Record<string, unknown> = {}): {
    state: MimocodeSessionConfigState;
    saved: () => number;
  } {
    let saves = 0;
    const ports: MimocodeSessionConfigPorts = {
      settingsBag: () => settings,
      saveSettings: async () => { saves += 1; },
      refreshSelectors: () => {},
      syncPermissionMode: () => {},
    };
    jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot')
      .mockImplementation(() => settings);
    return { state: new MimocodeSessionConfigState(ports), saved: () => saves };
  }

  const thoughtLevels: AcpSessionConfigOption[] = [{
    category: 'thought_level',
    currentValue: 'low',
    id: 'effort',
    name: 'Effort',
    options: [
      { name: 'Low', value: 'low' },
      { name: 'High', value: 'high' },
    ],
    type: 'select',
  }] as AcpSessionConfigOption[];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forgets the whole session when the conversation changes', async () => {
    const { state } = createState({ effortLevel: 'high' });
    await state.syncSessionModelState({ configOptions: thoughtLevels });
    state.markApplied({ modeId: 'plan', modelId: 'provider/model' });
    expect(state.effortConfigId).toBe('effort');

    state.forgetSession();

    expect(state.sessionModelId).toBeNull();
    expect(state.sessionModeId).toBeNull();
    expect(state.effortConfigId).toBeNull();
    expect(state.effortValue).toBeNull();
    // The levels went with it: another conversation is another session, and it
    // reports its own.
    expect(state.resolveSelectedEffortValue()).toBeNull();
  });

  it('keeps the reported levels when it is the process that went away', async () => {
    const { state } = createState({ effortLevel: 'high' });
    await state.syncSessionModelState({ configOptions: thoughtLevels });
    state.markApplied({ modeId: 'plan', modelId: 'provider/model' });

    state.forgetProcessSelection();

    expect(state.sessionModelId).toBeNull();
    expect(state.sessionModeId).toBeNull();
    // Deliberately narrower than forgetSession: this is what the legacy runtime
    // cleared on shutdown, and widening it would be a behaviour change wearing
    // a refactor's clothes.
    expect(state.effortConfigId).toBe('effort');
    expect(state.resolveSelectedEffortValue()).toBe('high');
  });

  it('forgets only the model when a set was rejected', () => {
    const { state } = createState();
    state.markApplied({ modeId: 'plan', modelId: 'provider/model' });

    state.forgetSessionModel();

    expect(state.sessionModelId).toBeNull();
    expect(state.sessionModeId).toBe('plan');
  });

  it('reports a level the vault wants before any session has offered one', async () => {
    const { state } = createState({ effortLevel: 'high' });

    // resolveSelectedEffortValue answers for a session that has reported its
    // options; a tab's first turn is composed before one exists.
    expect(state.resolveSelectedEffortValue()).toBeNull();
    expect(state.desiredEffortValue()).toBe('high');

    await state.syncSessionModelState({ configOptions: thoughtLevels });
    expect(state.resolveSelectedEffortValue()).toBe('high');
  });

  it('wants nothing when the vault is on the default level, or on none', () => {
    expect(createState({ effortLevel: MIMOCODE_DEFAULT_THINKING_LEVEL }).state.desiredEffortValue())
      .toBeNull();
    expect(createState({ effortLevel: '   ' }).state.desiredEffortValue()).toBeNull();
    expect(createState({}).state.desiredEffortValue()).toBeNull();
  });
});
