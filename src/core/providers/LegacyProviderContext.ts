import type { App, PluginManifest } from 'obsidian';

import type { SharedAppStorage } from '../bootstrap/storage';
import type { DebugLogEvent } from '../debug/DebugLogService';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import type { GrimoireSettings } from '../types';
import type { ProviderId } from '../types/provider';
import type { EnvironmentScope } from '../types/settings';

/** Legacy view handle retained only until the application-wide cutover. */
export interface LegacyProviderViewHandle {
  getTabManager(): LegacyProviderTabManagerHandle | null;
  invalidateProviderCommandCaches?(providerIds: ProviderId[]): void;
  refreshModelSelector(): void;
}

/** Legacy tab-runtime broadcast handle retained only for the old production path. */
export interface LegacyProviderTabManagerHandle {
  broadcastToProviderTabs(
    providerId: ProviderId,
    callback: (runtime: ChatRuntime) => Promise<void> | void,
  ): Promise<void>;
  broadcastToAllTabs(
    callback: (runtime: ChatRuntime) => Promise<void> | void,
  ): Promise<void>;
}

/**
 * Temporary structural host for the production registries and ChatRuntime path.
 * New provider modules and execution backends must not depend on this contract;
 * it is deleted with the legacy registries at the application-wide cutover.
 */
export interface LegacyProviderContext {
  app: App;
  manifest: PluginManifest;
  settings: GrimoireSettings;
  storage: SharedAppStorage;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
  saveSettings(): Promise<void>;
  getEnvironmentVariablesForScope(scope: EnvironmentScope): string;
  applyEnvironmentVariables(scope: EnvironmentScope, value: string): Promise<void>;
  applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void>;
  getActiveEnvironmentVariables(providerId?: ProviderId): string;
  getResolvedProviderCliPath(providerId: ProviderId): string | null;
  getAllViews(): LegacyProviderViewHandle[];
  getView(): LegacyProviderViewHandle | null;
  recordDebugLog?(event: DebugLogEvent): void;
}
