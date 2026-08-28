import { dumpYamlFrontmatter, loadYamlFrontmatter } from '../../../utils/yamlFrontmatter';
import type { VaultFileAdapter } from '../../storage/VaultFileAdapter';
import type { SlashCommand } from '../../types';
import type { ProviderId } from '../types';
import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
} from './ProviderCommandCatalog';
import type { ProviderCommandEntry } from './ProviderCommandEntry';

const PERSISTENCE_PREFIX = 'vault-skill';
const SKILL_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type VaultSkillStorageAdapter = Pick<
  VaultFileAdapter,
  | 'delete'
  | 'deleteFolderRecursive'
  | 'ensureFolder'
  | 'exists'
  | 'listFiles'
  | 'listFolders'
  | 'read'
  | 'rename'
  | 'write'
>;

export interface VaultSkillRoot {
  id: string;
  path: string;
  editable?: boolean;
  includeFlatFiles?: boolean;
}

export interface VaultSkillCommandCatalogOptions {
  providerId: ProviderId;
  roots: VaultSkillRoot[];
  dropdown: Omit<ProviderCommandDropdownConfig, 'providerId'>;
}

interface VaultSkillLocation {
  form: 'directory' | 'flat';
  name: string;
  rootId: string;
}

function encodePersistencePart(value: string): string {
  return encodeURIComponent(value);
}

function createPersistenceKey(location: VaultSkillLocation): string {
  return [
    PERSISTENCE_PREFIX,
    encodePersistencePart(location.rootId),
    location.form,
    encodePersistencePart(location.name),
  ].join(':');
}

function parsePersistenceKey(value?: string): VaultSkillLocation | null {
  if (!value) return null;
  const [prefix, encodedRootId, form, encodedName] = value.split(':');
  if (
    prefix !== PERSISTENCE_PREFIX
    || !encodedRootId
    || (form !== 'directory' && form !== 'flat')
    || !encodedName
  ) {
    return null;
  }
  return {
    form,
    name: decodeURIComponent(encodedName),
    rootId: decodeURIComponent(encodedRootId),
  };
}

function normalizeRuntimeCommands(commands: SlashCommand[]): SlashCommand[] {
  const results: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const command of commands) {
    const name = command.name.trim().replace(/^\/+/, '');
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    results.push({ ...command, name });
  }
  return results;
}

function runtimeCommandToEntry(
  providerId: ProviderId,
  command: SlashCommand,
): ProviderCommandEntry {
  return {
    id: command.id,
    providerId,
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

function serializeSkill(
  frontmatter: Record<string, unknown>,
  content: string,
): string {
  const yaml = dumpYamlFrontmatter(frontmatter);
  const body = content.trimEnd();
  return `---\n${yaml}\n---\n\n${body}\n`;
}

function parseSkillMarkdown(
  content: string,
): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(SKILL_FRONTMATTER_PATTERN);
  if (!match) return null;

  try {
    const parsed: unknown = loadYamlFrontmatter(match[1]);
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      return null;
    }
    return {
      frontmatter: (parsed as Record<string, unknown> | null) ?? {},
      body: match[2],
    };
  } catch {
    return null;
  }
}

export class VaultSkillCommandCatalog implements ProviderCommandCatalog {
  private runtimeCommands: SlashCommand[] = [];

  constructor(
    private readonly adapter: VaultSkillStorageAdapter | undefined,
    private readonly options: VaultSkillCommandCatalogOptions,
  ) {}

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = normalizeRuntimeCommands(commands);
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    return this.runtimeCommands.map((command) => runtimeCommandToEntry(
      this.options.providerId,
      command,
    ));
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    if (!this.adapter) return [];
    const entries: ProviderCommandEntry[] = [];

    for (const root of this.options.roots) {
      const folders = await this.listFolders(root.path);
      const directoryNames = new Set<string>();
      for (const folder of folders) {
        const name = folder.split('/').filter(Boolean).pop();
        if (!name) continue;
        const location: VaultSkillLocation = { form: 'directory', name, rootId: root.id };
        const entry = await this.loadEntry(root, location);
        if (entry) {
          directoryNames.add(name.toLowerCase());
          entries.push(entry);
        }
      }

      if (!root.includeFlatFiles) continue;
      const files = await this.listFiles(root.path);
      for (const file of files) {
        const fileName = file.split('/').filter(Boolean).pop() ?? '';
        if (!fileName.toLowerCase().endsWith('.md') || fileName === 'SKILL.md') continue;
        const name = fileName.slice(0, -3);
        if (!name || directoryNames.has(name.toLowerCase())) continue;
        const location: VaultSkillLocation = { form: 'flat', name, rootId: root.id };
        const entry = await this.loadEntry(root, location);
        if (entry) entries.push(entry);
      }
    }

    return entries;
  }

  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind !== 'skill' || !this.adapter) {
      throw new Error('Vault skill storage is unavailable.');
    }
    if (!entry.description?.trim()) {
      throw new Error('Skill description is required.');
    }

    const previous = parsePersistenceKey(entry.persistenceKey);
    const root = previous
      ? this.options.roots.find((candidate) => candidate.id === previous.rootId)
      : this.options.roots.find((candidate) => candidate.editable !== false);
    if (!root || root.editable === false) {
      throw new Error('This skill location is read only.');
    }

    let frontmatter: Record<string, unknown> = {};
    if (previous) {
      const existing = await this.adapter.read(this.filePath(root, previous));
      const parsed = parseSkillMarkdown(existing);
      if (!parsed) {
        throw new Error('Cannot safely edit a skill with invalid frontmatter.');
      }
      frontmatter = parsed.frontmatter;
    }
    frontmatter = { ...frontmatter, name: entry.name };
    if (entry.description?.trim()) {
      frontmatter.description = entry.description.trim();
    } else {
      delete frontmatter.description;
    }

    const target: VaultSkillLocation = {
      form: previous?.form ?? 'directory',
      name: entry.name,
      rootId: root.id,
    };
    const serialized = serializeSkill(frontmatter, entry.content);
    const moved = previous && (previous.name !== target.name || previous.form !== target.form);
    if (moved) {
      await this.moveLocation(root, previous, target, serialized);
      return;
    }

    if (!previous && await this.adapter.exists(this.locationPath(root, target))) {
      throw new Error(`A skill already exists at ${this.locationPath(root, target)}.`);
    }

    if (target.form === 'directory') {
      await this.adapter.ensureFolder(this.locationPath(root, target));
    } else {
      await this.adapter.ensureFolder(root.path);
    }
    await this.adapter.write(this.filePath(root, target), serialized);
  }

  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind !== 'skill' || !this.adapter) {
      throw new Error('Vault skill storage is unavailable.');
    }
    const location = parsePersistenceKey(entry.persistenceKey);
    const root = location
      ? this.options.roots.find((candidate) => candidate.id === location.rootId)
      : undefined;
    if (!location || !root || root.editable === false) {
      throw new Error('This skill location is read only.');
    }
    await this.deleteLocation(root, location);
  }

  defaultVaultStoragePath(): string | null {
    return this.options.roots.find((root) => root.editable !== false)?.path ?? null;
  }

  async refresh(): Promise<void> {
    // Vault entries are read fresh on every request. Runtime entries update through setRuntimeCommands().
  }

  private async loadEntry(
    root: VaultSkillRoot,
    location: VaultSkillLocation,
  ): Promise<ProviderCommandEntry | null> {
    if (!this.adapter) return null;
    try {
      const markdown = await this.adapter.read(this.filePath(root, location));
      const parsed = parseSkillMarkdown(markdown);
      if (!parsed) return null;
      const frontmatterName = typeof parsed.frontmatter.name === 'string'
        ? parsed.frontmatter.name.trim()
        : '';
      const description = typeof parsed.frontmatter.description === 'string'
        ? parsed.frontmatter.description.trim()
        : undefined;
      const name = frontmatterName || location.name;
      const editable = root.editable !== false;
      return {
        id: `${this.options.providerId}-skill-${root.id}-${location.form}-${location.name}`,
        providerId: this.options.providerId,
        kind: 'skill',
        name,
        description,
        content: parsed.body,
        scope: 'vault',
        source: 'user',
        isEditable: editable,
        isDeletable: editable,
        displayPrefix: this.options.dropdown.skillPrefix,
        insertPrefix: this.options.dropdown.skillPrefix,
        persistenceKey: createPersistenceKey(location),
        storagePath: root.path,
      };
    } catch {
      return null;
    }
  }

  private filePath(root: VaultSkillRoot, location: VaultSkillLocation): string {
    return location.form === 'directory'
      ? `${root.path}/${location.name}/SKILL.md`
      : `${root.path}/${location.name}.md`;
  }

  private locationPath(root: VaultSkillRoot, location: VaultSkillLocation): string {
    return location.form === 'directory'
      ? `${root.path}/${location.name}`
      : this.filePath(root, location);
  }

  private async moveLocation(
    root: VaultSkillRoot,
    previous: VaultSkillLocation,
    target: VaultSkillLocation,
    serialized: string,
  ): Promise<void> {
    if (!this.adapter) return;
    const previousPath = this.locationPath(root, previous);
    const targetPath = this.locationPath(root, target);
    if (await this.adapter.exists(targetPath)) {
      throw new Error(`A skill already exists at ${targetPath}.`);
    }

    await this.adapter.rename(previousPath, targetPath);
    try {
      await this.adapter.write(this.filePath(root, target), serialized);
    } catch (error) {
      try {
        await this.adapter.rename(targetPath, previousPath);
      } catch {
        // Preserve the original write failure. The moved bundle remains intact at the target path.
      }
      throw error;
    }
  }

  private async deleteLocation(root: VaultSkillRoot, location: VaultSkillLocation): Promise<void> {
    if (!this.adapter) return;
    if (location.form === 'directory') {
      await this.adapter.deleteFolderRecursive(this.locationPath(root, location));
      return;
    }
    await this.adapter.delete(this.filePath(root, location));
  }

  private async listFiles(path: string): Promise<string[]> {
    try {
      return await this.adapter?.listFiles(path) ?? [];
    } catch {
      return [];
    }
  }

  private async listFolders(path: string): Promise<string[]> {
    try {
      return await this.adapter?.listFolders(path) ?? [];
    } catch {
      return [];
    }
  }
}
