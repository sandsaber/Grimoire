import type { SlashCommand } from '../../types';
import type { ProviderCatalogRefreshOutcome } from '../ProviderModelCatalogRefreshCache';
import type { ProviderCommandDropdown } from '../ProviderModule';
import type { ProviderId } from '../types';
import type { ProviderCommandEntry } from './ProviderCommandEntry';

/**
 * The provider id, plus the module's `ProviderCommandDropdown` declaration.
 *
 * `readonly` because the declaration it is now built from is: this is a
 * constant a module publishes, and a consumer that pushed a trigger character
 * onto it would be editing every tab's parser.
 */
export interface ProviderCommandDropdownConfig extends ProviderCommandDropdown {
  readonly providerId: ProviderId;
}

export interface ProviderCommandCatalog {
  listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]>;
  listVaultEntries(): Promise<ProviderCommandEntry[]>;
  saveVaultEntry(entry: ProviderCommandEntry): Promise<void>;
  deleteVaultEntry(entry: ProviderCommandEntry): Promise<void>;
  setRuntimeCommands(commands: SlashCommand[]): void;
  defaultVaultStoragePath?(): string | null;
  /**
   * Re-reads the catalog's source, and says whether it answered.
   *
   * A catalog backed by the vault always answers. One that probes a CLI —
   * Claude's — can find nothing and keep the list it had, which is what makes
   * the list's own length useless as evidence of success.
   */
  refresh(): Promise<ProviderCatalogRefreshOutcome>;
}
