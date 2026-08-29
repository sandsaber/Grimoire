export interface MimocodeProviderState {
  databasePath?: string;
  /**
   * Set when a saved session failed to load and no replacement was persisted.
   * Read back on the next load so a dropped session is not mistaken for a
   * conversation that never had one.
   */
  sessionDropped?: boolean;
}

export function getMimocodeState(
  providerState?: Record<string, unknown>,
): MimocodeProviderState {
  return (providerState ?? {});
}
