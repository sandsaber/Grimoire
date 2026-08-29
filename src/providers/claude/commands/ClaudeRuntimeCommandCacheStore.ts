import { hashCatalogFingerprint } from '../../../core/providers/catalogFingerprint';
import type { SlashCommand } from '../../../core/types';
import type GrimoirePlugin from '../../../main';
import { buildClaudeCatalogCacheKey } from '../cli/claudeCatalogCache';
import {
  type ClaudeProviderSettings,
  getClaudeProviderSettings,
  normalizeClaudeDiscoveredCommands,
  updateClaudeProviderSettings,
} from '../settings';

export interface RuntimeCommandCacheRecord {
  fingerprint: string;
  commands: SlashCommand[];
}

/**
 * The catalog's only view of persistence. It hands out digests, never the raw
 * key, so the policy in ClaudeCommandCatalog can be tested against a fake and
 * the raw environment never leaves this file.
 */
export interface RuntimeCommandCacheStore {
  currentFingerprint(): string;
  read(): RuntimeCommandCacheRecord | null;
  write(value: RuntimeCommandCacheRecord): Promise<void>;
  clear(): Promise<void>;
}

export function createClaudeRuntimeCommandCacheStore(
  plugin: GrimoirePlugin,
): RuntimeCommandCacheStore {
  const readSettings = (): ClaudeProviderSettings =>
    getClaudeProviderSettings(plugin.settings ?? {});

  return {
    async clear() {
      const settings = readSettings();
      const previousCommands = settings.discoveredCommands;
      const previousFingerprint = settings.discoveredCommandsFingerprint;
      updateClaudeProviderSettings(plugin.settings, {
        discoveredCommands: [],
        discoveredCommandsFingerprint: '',
      });
      try {
        await plugin.saveSettings?.();
      } catch (error) {
        // Memory said cleared while disk kept the list, so a restart would
        // resurrect exactly what this was meant to drop.
        updateClaudeProviderSettings(plugin.settings, {
          discoveredCommands: previousCommands,
          discoveredCommandsFingerprint: previousFingerprint,
        });
        throw error;
      }
    },
    currentFingerprint() {
      const cliPath = plugin.getResolvedProviderCliPath?.('claude') ?? '';
      return hashCatalogFingerprint(buildClaudeCatalogCacheKey(readSettings(), cliPath));
    },
    read() {
      const settings = readSettings();
      // Unlike the model catalog there is no legacy list to be lenient about:
      // the fingerprint field ships together with the cache itself, so a record
      // without one was never written by this store and is not trusted.
      if (settings.discoveredCommands.length === 0 || !settings.discoveredCommandsFingerprint) {
        return null;
      }
      return {
        commands: settings.discoveredCommands,
        fingerprint: settings.discoveredCommandsFingerprint,
      };
    },
    async write(value) {
      const commands = normalizeClaudeDiscoveredCommands(value.commands);
      const settings = readSettings();
      // A live session hands the same list over on every dropdown open, and a
      // settings write is a file write the user's vault sync sees. Nothing
      // changed means nothing to save.
      if (
        settings.discoveredCommandsFingerprint === value.fingerprint
        && JSON.stringify(settings.discoveredCommands) === JSON.stringify(commands)
      ) {
        return;
      }

      const previousCommands = settings.discoveredCommands;
      const previousFingerprint = settings.discoveredCommandsFingerprint;
      updateClaudeProviderSettings(plugin.settings, {
        discoveredCommands: commands,
        discoveredCommandsFingerprint: value.fingerprint,
      });
      try {
        await plugin.saveSettings?.();
      } catch (error) {
        // Otherwise memory claims the list is filed under this configuration
        // while disk has nothing, and the next unrelated save from anywhere in
        // the plugin quietly persists a record that was never verified.
        updateClaudeProviderSettings(plugin.settings, {
          discoveredCommands: previousCommands,
          discoveredCommandsFingerprint: previousFingerprint,
        });
        throw error;
      }
    },
  };
}
