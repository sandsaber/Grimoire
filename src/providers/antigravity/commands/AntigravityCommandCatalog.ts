import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import {
  VaultSkillCommandCatalog,
  type VaultSkillStorageAdapter,
} from '../../../core/providers/commands/VaultSkillCommandCatalog';

// Must stay in sync with the invocation grammar in
// expandAntigravityVaultSkillInvocation (/^\/([\p{L}\p{N}_-]+)(?:\s|$)/).
const INVOCABLE_SKILL_NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

/**
 * AGY does not advertise a slash-command inventory, but Grimoire can still
 * offer vault skills and expand the selected invocation before launching AGY.
 */
export class AntigravityCommandCatalog extends VaultSkillCommandCatalog {
  constructor(adapter?: VaultSkillStorageAdapter) {
    super(adapter, {
      providerId: 'antigravity',
      roots: [
        {
          id: 'claude',
          path: '.claude/skills',
          editable: false,
          allowContentOnlySkills: true,
          deriveDescriptionFromBody: true,
        },
        {
          id: 'agents',
          path: '.agents/skills',
          editable: false,
          allowContentOnlySkills: true,
          deriveDescriptionFromBody: true,
        },
      ],
      dropdown: {
        triggerChars: ['/'],
        builtInPrefix: '/',
        skillPrefix: '/',
        commandPrefix: '/',
      },
    });
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    return this.listVaultEntries();
  }

  override async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    const seenNames = new Set<string>();
    return (await super.listVaultEntries()).filter((entry) => {
      // Only offer skills the runtime can actually expand: the name must fit
      // the `/name` invocation grammar and the body must be non-empty.
      if (!INVOCABLE_SKILL_NAME_PATTERN.test(entry.name) || !entry.content?.trim()) return false;
      const name = entry.name.toLowerCase();
      if (seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });
  }
}
