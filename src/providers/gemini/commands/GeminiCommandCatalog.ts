import * as path from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import {
  VaultSkillCommandCatalog,
  type VaultSkillStorageAdapter,
} from '../../../core/providers/commands/VaultSkillCommandCatalog';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import { isRecord } from '../../../utils/records';

export const GEMINI_COMMANDS_PATH = '.gemini/commands';
const GEMINI_COMMAND_PERSISTENCE_PREFIX = 'gemini-command';

type GeminiCommandAdapter = VaultSkillStorageAdapter & Pick<VaultFileAdapter, 'listFilesRecursive'>;

interface GeminiCommandLocation {
  relativePath: string;
}

export class GeminiCommandCatalog implements ProviderCommandCatalog {
  private readonly skills: VaultSkillCommandCatalog;

  constructor(private readonly adapter?: GeminiCommandAdapter) {
    this.skills = new VaultSkillCommandCatalog(adapter, {
      providerId: 'gemini',
      roots: [
        { id: 'gemini', path: '.gemini/skills', editable: true },
        { id: 'agents', path: '.agents/skills', editable: true },
      ],
      dropdown: {
        triggerChars: ['/'],
        builtInPrefix: '/',
        skillPrefix: '/',
        commandPrefix: '/',
      },
    });
  }

  setRuntimeCommands(_commands: SlashCommand[]): void {
    // Gemini ACP has not advertised a stable runtime command inventory.
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    return this.listVaultEntries();
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    const [commands, skills] = await Promise.all([
      this.listCommands(),
      this.skills.listVaultEntries(),
    ]);
    return [...commands, ...skills];
  }

  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') {
      await this.skills.saveVaultEntry(entry);
      return;
    }
    if (!this.adapter) throw new Error('Gemini command storage is unavailable.');
    if (!entry.content.trim()) throw new Error('Gemini command prompt is required.');

    const previous = parseGeminiCommandPersistenceKey(entry.persistenceKey);
    const target = commandNameToLocation(entry.name);
    const previousPath = previous ? locationPath(previous) : null;
    const targetPath = locationPath(target);
    if ((!previousPath || previousPath !== targetPath) && await this.adapter.exists(targetPath)) {
      throw new Error(`A Gemini command already exists at ${targetPath}.`);
    }

    let document: Record<string, unknown> = {};
    if (previousPath) {
      document = parseGeminiCommandDocument(await this.adapter.read(previousPath)) ?? {};
    }
    document.prompt = entry.content;
    if (entry.description?.trim()) {
      document.description = entry.description.trim();
    } else {
      delete document.description;
    }

    await this.adapter.ensureFolder(path.posix.dirname(targetPath));
    await this.adapter.write(targetPath, stringifyToml(document));
    if (previousPath && previousPath !== targetPath) {
      await this.adapter.delete(previousPath);
    }
  }

  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') {
      await this.skills.deleteVaultEntry(entry);
      return;
    }
    if (!this.adapter) throw new Error('Gemini command storage is unavailable.');
    const location = parseGeminiCommandPersistenceKey(entry.persistenceKey);
    if (!location) throw new Error('Gemini command location is unavailable.');
    await this.adapter.delete(locationPath(location));
  }

  defaultVaultStoragePath(): string | null {
    return '.gemini/skills';
  }

  async refresh(): Promise<void> {
    // Vault resources are read fresh for each request.
  }

  private async listCommands(): Promise<ProviderCommandEntry[]> {
    if (!this.adapter) return [];
    let files: string[];
    try {
      files = await this.adapter.listFilesRecursive(GEMINI_COMMANDS_PATH);
    } catch {
      return [];
    }

    const entries: ProviderCommandEntry[] = [];
    for (const filePath of files.sort()) {
      if (!filePath.endsWith('.toml')) continue;
      try {
        const document = parseGeminiCommandDocument(await this.adapter.read(filePath));
        if (!document || typeof document.prompt !== 'string' || !document.prompt.trim()) continue;
        const location = filePathToLocation(filePath);
        if (!location) continue;
        const name = location.relativePath.slice(0, -5).split('/').join(':');
        entries.push({
          id: createGeminiCommandPersistenceKey(location),
          providerId: 'gemini',
          kind: 'command',
          name,
          description: typeof document.description === 'string' ? document.description : undefined,
          content: document.prompt,
          scope: 'vault',
          source: 'user',
          isEditable: true,
          isDeletable: true,
          displayPrefix: '/',
          insertPrefix: '/',
          storagePath: GEMINI_COMMANDS_PATH,
          persistenceKey: createGeminiCommandPersistenceKey(location),
        });
      } catch {
        // One malformed file must not hide the rest of the command inventory.
      }
    }
    return entries;
  }
}

export function parseGeminiCommandDocument(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = parseToml(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createGeminiCommandPersistenceKey(location: GeminiCommandLocation): string {
  return `${GEMINI_COMMAND_PERSISTENCE_PREFIX}:${encodeURIComponent(location.relativePath)}`;
}

function parseGeminiCommandPersistenceKey(value?: string): GeminiCommandLocation | null {
  if (!value) return null;
  const [prefix, encodedPath] = value.split(':');
  if (prefix !== GEMINI_COMMAND_PERSISTENCE_PREFIX || !encodedPath) return null;
  const relativePath = normalizeRelativePath(decodeURIComponent(encodedPath));
  return isSafeCommandRelativePath(relativePath) ? { relativePath } : null;
}

function commandNameToLocation(name: string): GeminiCommandLocation {
  const validationError = validateGeminiCommandName(name);
  if (validationError) throw new Error(validationError);
  const segments = name.split(':');
  return { relativePath: `${segments.join('/')}.toml` };
}

export function validateGeminiCommandName(name: string): string | null {
  const segments = name.split(':');
  if (segments.length === 0 || segments.some((segment) => !/^[a-z0-9][a-z0-9_-]*$/i.test(segment))) {
    return 'Gemini command names use letters, numbers, hyphens, underscores, and colon namespaces.';
  }
  return null;
}

function filePathToLocation(filePath: string): GeminiCommandLocation | null {
  const prefix = `${GEMINI_COMMANDS_PATH}/`;
  if (!filePath.startsWith(prefix)) return null;
  const relativePath = normalizeRelativePath(filePath.slice(prefix.length));
  return isSafeCommandRelativePath(relativePath) ? { relativePath } : null;
}

function locationPath(location: GeminiCommandLocation): string {
  return `${GEMINI_COMMANDS_PATH}/${location.relativePath}`;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isSafeCommandRelativePath(value: string): boolean {
  return value.endsWith('.toml')
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

