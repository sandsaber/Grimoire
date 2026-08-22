import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  CCPermissions,
  CCSettings,
  PermissionRule,
} from '../types/settings';
import { DEFAULT_CC_PERMISSIONS, DEFAULT_CC_SETTINGS } from '../types/settings';

export const CC_SETTINGS_PATH = '.claude/settings.json';

const CC_SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';

type CCSettingsAdapter = Pick<VaultFileAdapter, 'exists' | 'read' | 'write'>
  & Partial<Pick<VaultFileAdapter, 'rename' | 'delete'>>;

/** Where a replacement is staged, beside the file it replaces. */
const CC_SETTINGS_PENDING_PATH = `${CC_SETTINGS_PATH}.grimoire-pending`;

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
  /** One save at a time: the merge below is a read-modify-write. */
  private writes: Promise<void> = Promise.resolve();

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
      // *read* — one stray character used to break reading permissions
      // everywhere. Defaults are returned so the surface works.
      //
      // Reading only. `saveUnlocked` refuses to write over a file it could not
      // parse, because these two together are a read-modify-write: degrading
      // the read to defaults and then merging onto `{}` would rewrite the
      // user's `settings.json` down to `$schema` and `permissions`, destroying
      // the `hooks`, `env`, `model` and `statusLine` that Claude Code itself
      // reads — on one "Always allow" click.
      return { ...DEFAULT_CC_SETTINGS };
    }

    return {
      $schema: CC_SETTINGS_SCHEMA,
      ...stored,
      permissions: normalizePermissions(stored.permissions),
    };
  }

  /**
   * Replaces the file, one writer at a time and without a torn state.
   *
   * Two problems that were one symptom. The merge is a read-modify-write, and
   * nothing serialized it — two saves overlapping meant the second read the
   * file before the first wrote it, and whichever finished last silently won,
   * dropping the other's permissions. And the write itself was direct, so a
   * crash mid-write left this shared file — Claude Code reads it too — as
   * truncated JSON.
   *
   * Staged beside the file and renamed over it where the adapter can, which is
   * every path that writes: the home adapter is read-only here. A reader that
   * opens `settings.json` sees the old content or the new one, never half.
   */
  save(settings: CCSettings): Promise<void> {
    this.writes = this.writes.catch(() => undefined).then(() => this.saveUnlocked(settings));
    return this.writes;
  }

  private async saveUnlocked(settings: CCSettings): Promise<void> {
    // Preserve CC-specific fields we don't manage
    let existing: Record<string, unknown> = {};
    if (await this.adapter.exists(CC_SETTINGS_PATH)) {
      const content = await this.adapter.read(CC_SETTINGS_PATH);
      try {
        existing = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Refused rather than merged onto nothing. This file is the user's and
        // Claude Code's, and everything in it this build does not model —
        // `hooks`, `env`, `model`, `statusLine`, `enabledPlugins` — survives
        // only by being read back and written out again. A parse failure means
        // it cannot be, so the write does not happen: a permission not saved is
        // recoverable, and a settings file rewritten down to two keys is not.
        throw new Error(
          `Grimoire could not update ${CC_SETTINGS_PATH} because it is not valid JSON. `
          + 'Fix or remove the file, then try again — nothing was written.',
        );
      }
    }

    // Merge: existing CC fields + our updates
    const merged: CCSettings = {
      ...existing,
      $schema: CC_SETTINGS_SCHEMA,
      permissions: settings.permissions ?? { ...DEFAULT_CC_PERMISSIONS },
    };

    const content = JSON.stringify(merged, null, 2);
    const rename = this.adapter.rename?.bind(this.adapter);
    if (!rename) {
      await this.adapter.write(CC_SETTINGS_PATH, content);
      return;
    }
    await this.adapter.write(CC_SETTINGS_PENDING_PATH, content);
    try {
      await rename(CC_SETTINGS_PENDING_PATH, CC_SETTINGS_PATH);
    } catch (error) {
      // The staged copy is this build's, and a failed rename leaves it beside
      // a file that is still whole. Removing it keeps the directory readable
      // to whoever looks at it next — Claude Code included.
      await this.adapter.delete?.(CC_SETTINGS_PENDING_PATH).catch(() => undefined);
      throw error;
    }
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
