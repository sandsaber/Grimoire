import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { VaultSkillCommandCatalog, type VaultSkillStorageAdapter } from '../../../core/providers/commands/VaultSkillCommandCatalog';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import { parseFrontmatter } from '../../../utils/frontmatter';
import { dumpYamlFrontmatter } from '../../../utils/yamlFrontmatter';

const COMMANDS_PATH = '.qwen/commands';
const COMMAND_PREFIX = 'qwen-command';
type Adapter = Pick<VaultFileAdapter, 'delete' | 'ensureFolder' | 'exists' | 'listFilesRecursive' | 'read' | 'write'>;

export class QwenCommandCatalog implements ProviderCommandCatalog {
  private runtimeCommands: SlashCommand[] = [];
  private readonly skills: VaultSkillCommandCatalog;

  constructor(private readonly adapter?: Adapter & VaultSkillStorageAdapter) {
    this.skills = new VaultSkillCommandCatalog(adapter, {
      providerId: 'qwen', roots: [{ id: 'qwen', path: '.qwen/skills', editable: true }], dropdown: dropdownConfig,
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
    return dedupeByName([...runtime, ...vault]);
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    return [...await this.loadCommands(), ...await this.skills.listVaultEntries()];
  }

  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') return this.skills.saveVaultEntry(entry);
    if (!this.adapter) throw new Error('Vault command storage is unavailable.');
    const priorPath = parsePersistenceKey(entry.persistenceKey);
    const targetPath = `${COMMANDS_PATH}/${entry.name.split(':').join('/')}.md`;
    if (!isValidName(entry.name)) throw new Error('Command name must use safe colon-separated namespace segments.');
    if ((!priorPath || priorPath !== targetPath) && await this.adapter.exists(targetPath)) {
      throw new Error(`A command already exists at ${targetPath}.`);
    }
    const extra = priorPath ? await this.readExtraFrontmatter(priorPath) : {};
    await this.adapter.ensureFolder(targetPath.slice(0, targetPath.lastIndexOf('/')));
    await this.adapter.write(targetPath, serializeCommand(entry, extra));
    if (priorPath && priorPath !== targetPath) await this.adapter.delete(priorPath);
  }

  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') return this.skills.deleteVaultEntry(entry);
    if (!this.adapter) throw new Error('Vault command storage is unavailable.');
    const filePath = parsePersistenceKey(entry.persistenceKey);
    if (!filePath) throw new Error('Command storage location is unavailable.');
    await this.adapter.delete(filePath);
  }

  defaultVaultStoragePath(): string { return '.qwen/skills'; }
  async refresh(): Promise<void> { await this.skills.refresh(); }

  private async loadCommands(): Promise<ProviderCommandEntry[]> {
    if (!this.adapter) return [];
    try {
      const files = await this.adapter.listFilesRecursive(COMMANDS_PATH);
      const entries: ProviderCommandEntry[] = [];
      for (const filePath of files) {
        if (!filePath.toLowerCase().endsWith('.md')) continue;
        try {
          const entry = parseCommand(await this.adapter.read(filePath), filePath);
          if (entry) entries.push(entry);
        } catch { /* Skip malformed user files. */ }
      }
      return entries;
    } catch { return []; }
  }

  private async readExtraFrontmatter(filePath: string): Promise<Record<string, unknown>> {
    if (!this.adapter) return {};
    const content = await this.adapter.read(filePath);
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      if (content.trimStart().startsWith('---')) {
        throw new Error('Cannot safely edit a command with invalid frontmatter.');
      }
      return {};
    }
    const { name: _name, description: _description, ...extra } = parsed.frontmatter;
    return extra;
  }
}

const dropdownConfig = { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' };

function parseCommand(content: string, filePath: string): ProviderCommandEntry | null {
  const parsed = parseFrontmatter(content);
  const fallbackName = filePath.slice(`${COMMANDS_PATH}/`.length).replace(/\.md$/i, '').split('/').join(':');
  const name = parsed && typeof parsed.frontmatter.name === 'string' && parsed.frontmatter.name.trim()
    ? parsed.frontmatter.name.trim() : fallbackName;
  if (!name) return null;
  return {
    id: `${COMMAND_PREFIX}:${encodeURIComponent(filePath)}`, providerId: 'qwen', kind: 'command', name,
    description: parsed && typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description.trim() : undefined,
    content: parsed ? parsed.body.trim() : content, scope: 'vault', source: 'user', isEditable: true, isDeletable: true,
    displayPrefix: '/', insertPrefix: '/', persistenceKey: `${COMMAND_PREFIX}:${encodeURIComponent(filePath)}`,
    storagePath: COMMANDS_PATH,
  };
}

function runtimeEntry(command: SlashCommand): ProviderCommandEntry {
  return { id: command.id, providerId: 'qwen', kind: 'command', name: command.name, description: command.description,
    content: command.content, argumentHint: command.argumentHint, allowedTools: command.allowedTools, model: command.model,
    disableModelInvocation: command.disableModelInvocation, userInvocable: command.userInvocable, context: command.context,
    agent: command.agent, hooks: command.hooks, scope: 'runtime', source: command.source ?? 'sdk', isEditable: false,
    isDeletable: false, displayPrefix: '/', insertPrefix: '/' };
}

function dedupeByName(entries: ProviderCommandEntry[]): ProviderCommandEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function parsePersistenceKey(key?: string): string | null {
  const [prefix, encoded] = key?.split(':') ?? [];
  if (prefix !== COMMAND_PREFIX || !encoded) return null;
  const filePath = decodeURIComponent(encoded).replace(/\\/g, '/');
  return filePath.startsWith(`${COMMANDS_PATH}/`) && filePath.endsWith('.md') ? filePath : null;
}

function serializeCommand(entry: ProviderCommandEntry, extra: Record<string, unknown>): string {
  const frontmatter = { name: entry.name, ...(entry.description ? { description: entry.description } : {}), ...extra };
  return `---\n${dumpYamlFrontmatter(frontmatter)}\n---\n${entry.content}\n`;
}

function isValidName(name: string): boolean {
  return name.split(':').every((part) => part && part === part.trim() && part !== '.' && part !== '..' && !/[<>:"\\|?*/]/.test(part));
}
