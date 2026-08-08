import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { SESSIONS_PATH, SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { GRIMOIRE_STORAGE_PATH } from '../../core/bootstrap/StoragePaths';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { t } from '../../i18n/i18n';
import { GrimoireSettingsStorage, type StoredGrimoireSettings } from '../settings/GrimoireSettingsStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type PersistedTabState = {
  tabId: string;
  conversationId: string | null;
  draftModel?: string | null;
  draftSettings?: Record<string, unknown> | null;
  orchestratorMode?: boolean;
};

type PersistedTabManagerState = {
  openTabs: PersistedTabState[];
  activeTabId: string | null;
};

function cloneJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return undefined;
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map(item => cloneJsonValue(item, depth + 1))
      .filter(item => item !== undefined);
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const cloned = cloneJsonValue(entry, depth + 1);
      if (cloned !== undefined) {
        result[key] = cloned;
      }
    }
    return result;
  }
  return undefined;
}

function normalizeDraftSettings(value: unknown): Record<string, unknown> | undefined {
  const cloned = cloneJsonValue(value);
  return isRecord(cloned) ? cloned : undefined;
}

export class SharedStorageService implements SharedAppStorage {
  readonly grimoireSettings: GrimoireSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.grimoireSettings = new GrimoireSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }

  async initialize(): Promise<{ grimoire: Record<string, unknown> }> {
    await this.ensureDirectories();
    const grimoire = await this.grimoireSettings.load();
    return { grimoire };
  }

  async saveGrimoireSettings(settings: Record<string, unknown>): Promise<void> {
    // Live plugin settings are always a GrimoireSettings object; storage persists
    // them as JSON without a full structural re-parse on every save.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- settings is the live GrimoireSettings instance.
    await this.grimoireSettings.save(settings as StoredGrimoireSettings);
  }

  async setTabManagerState(state: PersistedTabManagerState): Promise<void> {
    try {
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      data.tabManagerState = state;
      await this.plugin.saveData(data);
    } catch {
      new Notice(t('storage.tabLayoutSaveFailed'));
    }
  }

  async getTabManagerState(): Promise<PersistedTabManagerState | null> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return this.validateTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(GRIMOIRE_STORAGE_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }

  private validateTabManagerState(data: unknown): PersistedTabManagerState | null {
    if (!isRecord(data)) {
      return null;
    }

    const state = data;
    if (!Array.isArray(state.openTabs)) {
      return null;
    }

    const validatedTabs: PersistedTabState[] = [];
    for (const tab of state.openTabs) {
      if (!isRecord(tab)) {
        continue;
      }

      const tabObj = tab;
      if (typeof tabObj.tabId !== 'string') {
        continue;
      }

      const draftSettings = normalizeDraftSettings(tabObj.draftSettings);
      validatedTabs.push({
        tabId: tabObj.tabId,
        conversationId: typeof tabObj.conversationId === 'string' ? tabObj.conversationId : null,
        ...(typeof tabObj.draftModel === 'string'
          ? { draftModel: tabObj.draftModel }
          : {}),
        ...(draftSettings ? { draftSettings } : {}),
        ...(tabObj.orchestratorMode === true
          ? { orchestratorMode: true }
          : {}),
      });
    }

    return {
      openTabs: validatedTabs,
      activeTabId: typeof state.activeTabId === 'string' ? state.activeTabId : null,
    };
  }
}
