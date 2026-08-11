import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import { GrimoireSettingsStorage, type StoredGrimoireSettings } from '../../../app/settings/GrimoireSettingsStorage';
import { SESSIONS_PATH, SessionStorage } from '../../../core/bootstrap/SessionStorage';
import { GRIMOIRE_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import type { LegacyProviderContext } from '../../../core/providers/LegacyProviderContext';
import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  SlashCommand,
} from '../../../core/types';
import { t } from '../../../i18n/i18n';
import {
  type CCPermissions,
  type CCSettings,
  createPermissionRule,
} from '../types/settings';
import { AGENTS_PATH, AgentVaultStorage } from './AgentVaultStorage';
import { CCSettingsStorage } from './CCSettingsStorage';
import { McpStorage } from './McpStorage';
import { SKILLS_PATH, SkillStorage } from './SkillStorage';
import { COMMANDS_PATH, SlashCommandStorage } from './SlashCommandStorage';

export const CLAUDE_PATH = '.claude';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

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

export interface CombinedSettings {
  cc: CCSettings;
  grimoire: StoredGrimoireSettings;
}

export class StorageService {
  readonly ccSettings: CCSettingsStorage;
  readonly grimoireSettings: GrimoireSettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly skills: SkillStorage;
  readonly sessions: SessionStorage;
  readonly mcp: McpStorage;
  readonly agents: AgentVaultStorage;

  private adapter: VaultFileAdapter;
  private plugin: Pick<LegacyProviderContext, 'app' | 'loadData' | 'saveData'>;
  private app: App;

  constructor(plugin: Pick<LegacyProviderContext, 'app' | 'loadData' | 'saveData'>, adapter?: VaultFileAdapter) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.adapter = adapter ?? new VaultFileAdapter(this.app);
    this.ccSettings = new CCSettingsStorage(this.adapter);
    this.grimoireSettings = new GrimoireSettingsStorage(this.adapter);
    this.commands = new SlashCommandStorage(this.adapter);
    this.skills = new SkillStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
    this.mcp = new McpStorage(this.adapter);
    this.agents = new AgentVaultStorage(this.adapter);
  }

  async initialize(): Promise<CombinedSettings> {
    await this.ensureDirectories();

    const cc = await this.ccSettings.load();
    const grimoire = await this.grimoireSettings.load();

    return { cc, grimoire };
  }

  async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(CLAUDE_PATH);
    await this.adapter.ensureFolder(GRIMOIRE_STORAGE_PATH);
    await this.adapter.ensureFolder(COMMANDS_PATH);
    await this.adapter.ensureFolder(SKILLS_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
    await this.adapter.ensureFolder(AGENTS_PATH);
  }

  async loadAllSlashCommands(): Promise<SlashCommand[]> {
    const commands = await this.commands.loadAll();
    const skills = await this.skills.loadAll();
    return [...commands, ...skills];
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  async getPermissions(): Promise<CCPermissions> {
    return this.ccSettings.getPermissions();
  }

  async updatePermissions(permissions: CCPermissions): Promise<void> {
    return this.ccSettings.updatePermissions(permissions);
  }

  async addAllowRule(rule: string): Promise<void> {
    return this.ccSettings.addAllowRule(createPermissionRule(rule));
  }

  async addDenyRule(rule: string): Promise<void> {
    return this.ccSettings.addDenyRule(createPermissionRule(rule));
  }

  async removePermissionRule(rule: string): Promise<void> {
    return this.ccSettings.removeRule(createPermissionRule(rule));
  }

  async updateGrimoireSettings(updates: Partial<StoredGrimoireSettings>): Promise<void> {
    return this.grimoireSettings.update(updates);
  }

  async saveGrimoireSettings(settings: StoredGrimoireSettings): Promise<void> {
    return this.grimoireSettings.save(settings);
  }

  async loadGrimoireSettings(): Promise<StoredGrimoireSettings> {
    return this.grimoireSettings.load();
  }

  async getTabManagerState(): Promise<TabManagerPersistedState | null> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (isRecord(data) && data.tabManagerState) {
        return this.validateTabManagerState(data.tabManagerState);
      }
      return null;
    } catch {
      return null;
    }
  }

  private validateTabManagerState(data: unknown): TabManagerPersistedState | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const state = data as Record<string, unknown>;

    if (!Array.isArray(state.openTabs)) {
      return null;
    }

    const validatedTabs: TabManagerPersistedState['openTabs'] = [];
    for (const tab of state.openTabs) {
      if (!tab || typeof tab !== 'object') {
        continue; // Skip invalid entries
      }
      const tabObj = tab as Record<string, unknown>;
      if (typeof tabObj.tabId !== 'string') {
        continue; // Skip entries without valid tabId
      }
      const draftSettings = normalizeDraftSettings(tabObj.draftSettings);
      validatedTabs.push({
        tabId: tabObj.tabId,
        conversationId:
          typeof tabObj.conversationId === 'string' ? tabObj.conversationId : null,
        ...(typeof tabObj.draftModel === 'string'
          ? { draftModel: tabObj.draftModel }
          : {}),
        ...(draftSettings ? { draftSettings } : {}),
        ...(typeof tabObj.titleOverride === 'string'
          ? { titleOverride: tabObj.titleOverride }
          : {}),
        ...(tabObj.orchestratorMode === true ? { orchestratorMode: true } : {}),
      });
    }

    const activeTabId =
      typeof state.activeTabId === 'string' ? state.activeTabId : null;

    return {
      openTabs: validatedTabs,
      activeTabId,
    };
  }

  async setTabManagerState(state: TabManagerPersistedState): Promise<void> {
    try {
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      data.tabManagerState = state;
      await this.plugin.saveData(data);
    } catch {
      new Notice(t('storage.tabLayoutSaveFailed'));
    }
  }
}

export interface TabManagerPersistedState {
  openTabs: Array<{
    tabId: string;
    conversationId: string | null;
    draftModel?: string | null;
    draftSettings?: Record<string, unknown> | null;
    titleOverride?: string | null;
    orchestratorMode?: boolean;
  }>;
  activeTabId: string | null;
}
