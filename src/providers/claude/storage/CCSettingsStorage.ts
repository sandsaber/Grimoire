import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  CCPermissions,
  CCSettings,
  PermissionRule,
} from '../types/settings';
import { DEFAULT_CC_PERMISSIONS, DEFAULT_CC_SETTINGS } from '../types/settings';

export const CC_SETTINGS_PATH = '.claude/settings.json';

const CC_SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';

type CCSettingsAdapter = Pick<VaultFileAdapter, 'exists' | 'read' | 'write'>;

function normalizeRuleList(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is string => typeof r === 'string') as PermissionRule[];
}

function normalizePermissions(permissions: unknown): CCPermissions {
  if (!permissions || typeof permissions !== 'object') {
    return { ...DEFAULT_CC_PERMISSIONS };
  }

  const p = permissions as Record<string, unknown>;
  return {
    allow: normalizeRuleList(p.allow),
    deny: normalizeRuleList(p.deny),
    ask: normalizeRuleList(p.ask),
    defaultMode: typeof p.defaultMode === 'string' ? p.defaultMode as CCPermissions['defaultMode'] : undefined,
    additionalDirectories: Array.isArray(p.additionalDirectories)
      ? p.additionalDirectories.filter((d): d is string => typeof d === 'string')
      : undefined,
  };
}

export class CCSettingsStorage {
  constructor(private adapter: CCSettingsAdapter) { }

  async load(): Promise<CCSettings> {
    if (!(await this.adapter.exists(CC_SETTINGS_PATH))) {
      return { ...DEFAULT_CC_SETTINGS };
    }

    const content = await this.adapter.read(CC_SETTINGS_PATH);
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // A file this build cannot parse is not a reason to fail every permission
      // read — `save` has tolerated one since it was written, and only `load`
      // threw, so a single stray character broke reading *and* writing
      // permissions everywhere. Defaults are returned so the surface works; the
      // file itself is left exactly as it is, because it is the user's and it
      // may be recoverable by hand.
      return { ...DEFAULT_CC_SETTINGS };
    }

    return {
      $schema: CC_SETTINGS_SCHEMA,
      ...stored,
      permissions: normalizePermissions(stored.permissions),
    };
  }

  async save(settings: CCSettings): Promise<void> {
    // Preserve CC-specific fields we don't manage
    let existing: Record<string, unknown> = {};
    if (await this.adapter.exists(CC_SETTINGS_PATH)) {
      try {
        const content = await this.adapter.read(CC_SETTINGS_PATH);
        existing = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Parse error - start fresh with default settings
      }
    }

    // Merge: existing CC fields + our updates
    const merged: CCSettings = {
      ...existing,
      $schema: CC_SETTINGS_SCHEMA,
      permissions: settings.permissions ?? { ...DEFAULT_CC_PERMISSIONS },
    };

    const content = JSON.stringify(merged, null, 2);
    await this.adapter.write(CC_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(CC_SETTINGS_PATH);
  }

  async getPermissions(): Promise<CCPermissions> {
    const settings = await this.load();
    return settings.permissions ?? { ...DEFAULT_CC_PERMISSIONS };
  }

  async updatePermissions(permissions: CCPermissions): Promise<void> {
    const settings = await this.load();
    settings.permissions = permissions;
    await this.save(settings);
  }

  async addAllowRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    if (!permissions.allow?.includes(rule)) {
      permissions.allow = [...(permissions.allow ?? []), rule];
      await this.updatePermissions(permissions);
    }
  }

  async addDenyRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    if (!permissions.deny?.includes(rule)) {
      permissions.deny = [...(permissions.deny ?? []), rule];
      await this.updatePermissions(permissions);
    }
  }

  async addAskRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    if (!permissions.ask?.includes(rule)) {
      permissions.ask = [...(permissions.ask ?? []), rule];
      await this.updatePermissions(permissions);
    }
  }

  async removeRule(rule: PermissionRule): Promise<void> {
    const permissions = await this.getPermissions();
    permissions.allow = permissions.allow?.filter(r => r !== rule);
    permissions.deny = permissions.deny?.filter(r => r !== rule);
    permissions.ask = permissions.ask?.filter(r => r !== rule);
    await this.updatePermissions(permissions);
  }
}
