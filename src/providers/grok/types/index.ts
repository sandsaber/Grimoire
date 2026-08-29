export interface GrokProviderState {
  /**
   * Set when a saved session failed to load and no replacement was persisted.
   * Read back on the next load so a dropped session is not mistaken for a
   * conversation that never had one.
   */
  sessionDropped?: boolean;
  sessionDirPath?: string;
  workspacePath?: string;
}

export function getGrokState(
  providerState?: Record<string, unknown>,
): GrokProviderState {
  if (!providerState || typeof providerState !== 'object') {
    return {};
  }

  const state: GrokProviderState = {};
  if (providerState.sessionDropped === true) {
    state.sessionDropped = true;
  }
  if (typeof providerState.sessionDirPath === 'string' && providerState.sessionDirPath.trim()) {
    state.sessionDirPath = providerState.sessionDirPath.trim();
  }
  if (typeof providerState.workspacePath === 'string' && providerState.workspacePath.trim()) {
    state.workspacePath = providerState.workspacePath.trim();
  }
  return state;
}