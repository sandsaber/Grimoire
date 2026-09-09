import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { VaultSkillCommandCatalog, type VaultSkillStorageAdapter } from '../../../core/providers/commands/VaultSkillCommandCatalog';
import type { ProviderCatalogRefreshOutcome } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { SlashCommand } from '../../../core/types';

const SKILLS_PATH = '.devin/skills';

/**
 * What a Devin slash menu lists: the vault's skills, and the commands the open
 * session announced.
 *
 * Devin has no command files of its own — a skill *is* its slash command, as
 * `devin skills --help` says — so there is no `.devin/commands` half here the
 * way Qwen has one. The two roots are the ones the CLI itself scans (`devin
 * skills paths`): its own directory, and the cross-provider `.agents/skills`.
 */
export class DevinCommandCatalog implements ProviderCommandCatalog {
  private runtimeCommands: SlashCommand[] = [];
  private readonly skills: VaultSkillCommandCatalog;

  constructor(adapter?: VaultSkillStorageAdapter) {
    this.skills = new VaultSkillCommandCatalog(adapter, {
      providerId: 'devin',
      roots: [
        { id: 'devin', path: SKILLS_PATH, editable: true },
        { id: 'agents', path: '.agents/skills', editable: true },
      ],
      dropdown: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
    });
  }

  setRuntimeCommands(commands: SlashCommand[]): void {
    const seen = new Set<string>();
    this.runtimeCommands = commands.flatMap((command) => {
      const name = command.name.trim().replace(/^\/+/, '');
      if (!name || seen.has(name.toLowerCase())) return [];
      seen.add(name.toLowerCase());
      return [{ ...command, name }];
    });
    this.skills.setRuntimeCommands([]);
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    const vault = await this.listVaultEntries();
    const runtime = this.runtimeCommands.map((command) => runtimeEntry(command));
    const seen = new Set<string>();
    return [...runtime, ...vault].filter((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  listVaultEntries(): Promise<ProviderCommandEntry[]> {
    return this.skills.listVaultEntries();
  }

  saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    return this.skills.saveVaultEntry(entry);
  }

  deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    return this.skills.deleteVaultEntry(entry);
  }

  defaultVaultStoragePath(): string { return SKILLS_PATH; }

  async refresh(): Promise<ProviderCatalogRefreshOutcome> {
    await this.skills.refresh();
    return 'refreshed';
  }
}

function runtimeEntry(command: SlashCommand): ProviderCommandEntry {
  return {
    id: command.id,
    providerId: 'devin',
    kind: 'command',
    name: command.name,
    description: command.description,
    content: command.content,
    argumentHint: command.argumentHint,
    allowedTools: command.allowedTools,
    model: command.model,
    disableModelInvocation: command.disableModelInvocation,
    userInvocable: command.userInvocable,
    context: command.context,
    agent: command.agent,
    hooks: command.hooks,
    scope: 'runtime',
    source: command.source ?? 'sdk',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}
