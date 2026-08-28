import type { SlashCommand } from '../../types';
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
  refresh(): Promise<void>;
}
