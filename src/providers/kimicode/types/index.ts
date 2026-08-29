export interface KimicodeProviderState {
  databasePath?: string;
  /**
   * Set when a saved session failed to load and no replacement was persisted.
   * Read back on the next load so a dropped session is not mistaken for a
   * conversation that never had one.
   */
  sessionDropped?: boolean;
}

export function getKimicodeState(
  providerState?: Record<string, unknown>,
): KimicodeProviderState {
  return (providerState ?? {});
}
