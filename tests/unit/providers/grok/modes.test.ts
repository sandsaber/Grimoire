import {
  getEffectiveGrokModes,
  getManagedGrokModes,
  GROK_BUILD_MODE_ID,
  GROK_FALLBACK_MODES,
  GROK_FULL_ACCESS_MODE_ID,
  GROK_LEGACY_YOLO_MODE_ID,
  GROK_SAFE_MODE_ID,
  normalizeGrokAvailableModes,
  normalizeGrokSelectedMode,
  normalizeManagedGrokSelectedMode,
  resolveGrokAcpModeId,
  resolveGrokModeForPermissionMode,
  resolveGrokPermissionModeForSettings,
  resolvePermissionModeForManagedGrokMode,
} from '../../../../src/providers/grok/modes';
import { grokChatUIConfig } from '../../../../src/providers/grok/ui/GrokChatUIConfig';

describe('Grok Build mode settings', () => {
  it('normalizes duplicate/invalid mode entries', () => {
    expect(normalizeGrokAvailableModes([
      { id: 'build', name: 'Build' },
      { id: 'build', name: 'Duplicate build' },
      { id: 'plan', name: 'Plan', description: 'Planning-first agent' },
      null,
    ])).toEqual([
      { id: 'build', name: 'Build' },
      { description: 'Planning-first agent', id: 'plan', name: 'Plan' },
    ]);
  });

  it('preserves a saved mode string until fresh discovery decides whether it is valid', () => {
    expect(normalizeGrokSelectedMode('plan')).toBe('plan');
  });

  it('falls back to the built-in primary modes before ACP discovery finishes', () => {
    expect(getEffectiveGrokModes([])).toEqual(GROK_FALLBACK_MODES);
  });

  it('keeps Grimoire on managed full-access/safe/plan modes even when discovery only reports custom agents', () => {
    expect(getManagedGrokModes([
      { id: 'compaction', name: 'compaction' },
      { id: 'summary', name: 'summary' },
    ])).toEqual(GROK_FALLBACK_MODES);
  });

  it('normalizes saved custom mode selections back to the managed full-access mode', () => {
    expect(normalizeManagedGrokSelectedMode('compaction')).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('normalizes the legacy build id back to the managed full-access mode', () => {
    expect(normalizeManagedGrokSelectedMode(GROK_BUILD_MODE_ID)).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('normalizes the legacy yolo mode id back to the managed full-access mode', () => {
    expect(normalizeManagedGrokSelectedMode(GROK_LEGACY_YOLO_MODE_ID)).toBe(GROK_FULL_ACCESS_MODE_ID);
  });

  it('normalizes native permission aliases into managed modes inside the Grok adapter', () => {
    expect(normalizeManagedGrokSelectedMode('always-approve')).toBe(GROK_FULL_ACCESS_MODE_ID);
    expect(normalizeManagedGrokSelectedMode('bypassPermissions')).toBe(GROK_FULL_ACCESS_MODE_ID);
    expect(normalizeManagedGrokSelectedMode('ask')).toBe(GROK_SAFE_MODE_ID);
    expect(normalizeManagedGrokSelectedMode('default')).toBe(GROK_SAFE_MODE_ID);
  });

  it('maps shared permission modes onto managed Grok Build modes', () => {
    expect(resolveGrokModeForPermissionMode('full_access')).toBe(GROK_FULL_ACCESS_MODE_ID);
    expect(resolveGrokModeForPermissionMode('normal')).toBe(GROK_SAFE_MODE_ID);
    expect(resolveGrokModeForPermissionMode('plan')).toBe('plan');
  });

  it('maps shared permission modes onto Grok managed_config permission_mode values', () => {
    expect(resolveGrokPermissionModeForSettings('full_access')).toBe('always-approve');
    expect(resolveGrokPermissionModeForSettings('normal')).toBe('ask');
    expect(resolveGrokPermissionModeForSettings('plan')).toBe('plan');
  });

  it('maps managed Grok Build modes back to shared permission modes', () => {
    expect(resolvePermissionModeForManagedGrokMode(GROK_BUILD_MODE_ID)).toBe('full_access');
    expect(resolvePermissionModeForManagedGrokMode(GROK_FULL_ACCESS_MODE_ID)).toBe('full_access');
    expect(resolvePermissionModeForManagedGrokMode(GROK_LEGACY_YOLO_MODE_ID)).toBe('full_access');
    expect(resolvePermissionModeForManagedGrokMode(GROK_SAFE_MODE_ID)).toBe('normal');
    expect(resolvePermissionModeForManagedGrokMode('plan')).toBe('plan');
    expect(resolvePermissionModeForManagedGrokMode('always-approve')).toBe('full_access');
    expect(resolvePermissionModeForManagedGrokMode('bypassPermissions')).toBe('full_access');
    expect(resolvePermissionModeForManagedGrokMode('ask')).toBe('normal');
    expect(resolvePermissionModeForManagedGrokMode('default')).toBe('normal');
    expect(resolvePermissionModeForManagedGrokMode('summary')).toBeNull();
  });

  it('maps toolbar mode ids onto advertised ACP ids and skips unknown native sessions', () => {
    expect(resolveGrokAcpModeId(GROK_SAFE_MODE_ID, 'ask', [])).toBe('ask');
    expect(resolveGrokAcpModeId(GROK_FULL_ACCESS_MODE_ID, 'always-approve', [])).toBe('always-approve');
    expect(resolveGrokAcpModeId(
      GROK_FULL_ACCESS_MODE_ID,
      GROK_SAFE_MODE_ID,
      [GROK_FULL_ACCESS_MODE_ID, GROK_SAFE_MODE_ID],
    )).toBe(GROK_FULL_ACCESS_MODE_ID);
    expect(resolveGrokAcpModeId(
      GROK_FULL_ACCESS_MODE_ID,
      'ask',
      ['always-approve', 'ask', 'plan'],
    )).toBe('always-approve');
    expect(resolveGrokAcpModeId(GROK_FULL_ACCESS_MODE_ID, 'ask', [])).toBeNull();
  });
});

describe('grokChatUIConfig permission mode wiring', () => {
  it('exposes the shared Safe/Auto-approve/Plan toggle instead of a provider-owned mode selector', () => {
    expect(grokChatUIConfig.getModeSelector?.({
      providerConfigs: {
        grok: {
          availableModes: [
            { id: GROK_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
            { id: GROK_SAFE_MODE_ID, name: 'Safe' },
            { id: 'plan', name: 'Plan' },
          ],
          selectedMode: GROK_SAFE_MODE_ID,
        },
      },
    }) ?? null).toBeNull();

    expect(grokChatUIConfig.getPermissionModeToggle?.()).toEqual({
      activeLabel: 'Auto-approve',
      activeValue: 'full_access',
      inactiveLabel: 'Safe',
      inactiveValue: 'normal',
      planLabel: 'Plan',
      planValue: 'plan',
    });
  });

  it('derives shared permission mode from the saved managed Grok Build mode', () => {
    expect(grokChatUIConfig.resolvePermissionMode?.({
      providerConfigs: {
        grok: {
          selectedMode: GROK_BUILD_MODE_ID,
        },
      },
    })).toBe('full_access');

    expect(grokChatUIConfig.resolvePermissionMode?.({
      providerConfigs: {
        grok: {
          selectedMode: GROK_SAFE_MODE_ID,
        },
      },
    })).toBe('normal');

    expect(grokChatUIConfig.resolvePermissionMode?.({
      providerConfigs: {
        grok: {
          selectedMode: GROK_FULL_ACCESS_MODE_ID,
        },
      },
    })).toBe('full_access');

    expect(grokChatUIConfig.resolvePermissionMode?.({
      providerConfigs: {
        grok: {
          selectedMode: 'plan',
        },
      },
    })).toBe('plan');
  });

  it('maps shared permission mode changes back into managed Grok Build modes', () => {
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      providerConfigs: {
        grok: {
          availableModes: [
            { id: GROK_FULL_ACCESS_MODE_ID, name: 'Auto-approve' },
            { id: GROK_SAFE_MODE_ID, name: 'Safe' },
            { id: 'plan', name: 'Plan' },
          ],
          selectedMode: GROK_FULL_ACCESS_MODE_ID,
        },
      },
    };

    grokChatUIConfig.applyPermissionMode?.('normal', settings);
    expect(settings.permissionMode).toBe('normal');
    expect((settings.providerConfigs as Record<string, Record<string, unknown>>).grok.selectedMode).toBe(GROK_SAFE_MODE_ID);

    grokChatUIConfig.applyPermissionMode?.('plan', settings);
    expect((settings.providerConfigs as Record<string, Record<string, unknown>>).grok.selectedMode).toBe('plan');

    grokChatUIConfig.applyPermissionMode?.('full_access', settings);
    expect((settings.providerConfigs as Record<string, Record<string, unknown>>).grok.selectedMode).toBe(GROK_FULL_ACCESS_MODE_ID);
  });
});
