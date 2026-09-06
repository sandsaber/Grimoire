export interface MimocodeProviderState {
  databasePath?: string;
  /**
   * Set when the agent no longer had this conversation's saved session and a
   * fresh one took its place. Read back on load, because the conversation is
   * reopened by a runtime that never saw the drop — and cleared by the next
   * resume that succeeds, which is the turn where the notice has done its job.
   */
  sessionDropped?: boolean;
}

export function getMimocodeState(
  providerState?: Record<string, unknown>,
): MimocodeProviderState {
  return (providerState ?? {});
}
