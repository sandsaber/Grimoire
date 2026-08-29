import { JsonRpcErrorResponse } from './AcpJsonRpcTransport';

/**
 * Shared helpers for ACP managed-CLI session resume.
 *
 * OpenCode-family providers (and Grok) persist `sessionId` + optional
 * `databasePath` in conversation meta. When `session/load` fails we must not
 * throw away the database path (history hydrate / OPENCODE_DB still need it)
 * and should surface a clear diagnostic rather than silently wiping state.
 */

export interface AcpSessionClearOptions {
  /** When true, keep the last known native DB path after a failed resume. */
  preserveDatabasePath?: boolean;
}

export interface AcpSessionRuntimeState {
  currentDatabasePath: string | null;
  loadedSessionId: string | null;
  sessionId: string | null;
  sessionInvalidated: boolean;
}

export interface AcpSessionLoadFailureContext {
  cwd?: string;
  databasePath?: string | null;
  error?: unknown;
  providerId: string;
  sessionId: string;
  stderr?: string;
}

export interface AcpPersistedSessionUpdateInput {
  conversationDatabasePath?: string | null;
  /** What the conversation already recorded, so the marker survives a save. */
  conversationSessionDropped?: boolean;
  currentDatabasePath?: string | null;
  sessionId: string | null;
  sessionInvalidated: boolean;
}

/**
 * `session`, as the CLIs actually spell it: plural in "no previous sessions",
 * camel-cased in "Unknown sessionId". A bare `\bsession\b` matches neither.
 */
const SESSION_TOKEN = String.raw`session(?:s|[_ -]?ids?|[_ -]?id)?`;
const GONE_TOKEN = String.raw`(?:does not exist|missing|not[_ -]?found|unknown|no previous|expired|no longer (?:exists|available))`;

const MISSING_SESSION_REASON_PATTERN = new RegExp(
  String.raw`^(?:invalid[_ -]?${SESSION_TOKEN}|missing[_ -]?${SESSION_TOKEN}|${SESSION_TOKEN}[_ -]?(?:missing|not[_ -]?found|unknown|expired))$`,
  'i',
);
const MISSING_SESSION_MESSAGE_PATTERNS = [
  new RegExp(String.raw`\b${SESSION_TOKEN}\b.{0,80}\b${GONE_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\b(?:missing|no|unknown|not[_ -]?found)\b.{0,40}\b${SESSION_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\bcould not find\b.{0,40}\b${SESSION_TOKEN}\b`, 'i'),
  new RegExp(String.raw`\binvalid ${SESSION_TOKEN}\b`, 'i'),
];

/**
 * Return true only when session/load explicitly reports that the persisted
 * session no longer exists. Transport, authentication, and configuration
 * failures must propagate without invalidating the saved binding.
 */
export function isAcpMissingSessionError(error: unknown): boolean {
  if (!(error instanceof JsonRpcErrorResponse)) {
    return false;
  }
  if (error.method !== 'session/load' && error.method !== 'loadSession') {
    return false;
  }

  return collectDiagnosticStrings(error.message, error.data).some((value) => {
    const normalized = value.trim();
    return MISSING_SESSION_REASON_PATTERN.test(normalized)
      || MISSING_SESSION_MESSAGE_PATTERNS.some(pattern => pattern.test(normalized));
  });
}

export interface AcpSessionListing {
  sessions?: Array<{ sessionId?: string | null } | null> | null;
}

export interface AcpSessionGoneProbe {
  /** The error `session/load` rejected with. */
  error: unknown;
  /** Asks the agent which sessions it still has. */
  listSessions: () => Promise<AcpSessionListing>;
  /** The session id the failed load was for. */
  sessionId: string;
}

/**
 * Whether a failed `session/load` means the session is gone.
 *
 * Error text alone cannot answer this. Every managed CLI we ship against
 * reports a missing session as a generic internal error - OpenCode and MiMoCode
 * as a bare `-32603 Internal error`, with nothing in `data` to key on - so the
 * message patterns above recognise none of them. Reading the wrong answer out
 * of that text is expensive in both directions: treat a live session as gone
 * and the conversation silently loses its context, treat a gone session as live
 * and every turn retries a dead id.
 *
 * So we ask instead. `session/list` is part of the same ACP surface and the
 * agent has already answered on this connection, which is what makes the extra
 * round trip safe to spend here: it only happens on a load that already failed.
 * An agent without the method, or one that fails to answer, leaves us where we
 * started - the binding is kept and the original error propagates, so a
 * recoverable failure stays recoverable.
 */
export async function isAcpSessionGone(probe: AcpSessionGoneProbe): Promise<boolean> {
  if (isAcpMissingSessionError(probe.error)) {
    return true;
  }
  // A transport failure says nothing about the session, and there is no live
  // connection left to ask on.
  if (!(probe.error instanceof JsonRpcErrorResponse)) {
    return false;
  }

  let listing: AcpSessionListing;
  try {
    listing = await probe.listSessions();
  } catch {
    return false;
  }

  const sessions = listing?.sessions;
  if (!Array.isArray(sessions)) {
    return false;
  }

  return !sessions.some(entry => entry?.sessionId === probe.sessionId);
}

function collectDiagnosticStrings(...values: unknown[]): string[] {
  const result: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === 'string') {
      result.push(value);
      return;
    }
    if (depth >= 3 || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 20)) visit(entry, depth + 1);
      return;
    }
    for (const entry of Object.values(value as Record<string, unknown>).slice(0, 20)) {
      visit(entry, depth + 1);
    }
  };

  for (const value of values) visit(value, 0);
  return result;
}

/**
 * Clear in-memory ACP session bindings after a failed load or explicit reset.
 * Optionally retain `currentDatabasePath` so history hydrate and CLI env still
 * point at the native store.
 */
export function clearAcpManagedSessionState(
  state: AcpSessionRuntimeState,
  options: AcpSessionClearOptions = {},
): void {
  if (!options.preserveDatabasePath) {
    state.currentDatabasePath = null;
  }
  state.sessionId = null;
  state.loadedSessionId = null;
}

/**
 * Mark a saved session as unloadable and clear the active binding while
 * preserving the native database path for history and relaunch.
 */
export function markAcpSessionLoadFailed(
  state: AcpSessionRuntimeState,
): void {
  state.sessionInvalidated = true;
  clearAcpManagedSessionState(state, { preserveDatabasePath: true });
}

/**
 * Build conversation persistence fields after a turn/session change.
 *
 * On invalidation without a replacement session id we clear `sessionId` so the
 * next send creates a fresh ACP session, but we keep `databasePath` so SQLite
 * hydrate and OPENCODE_DB / equivalent env still resolve.
 */
export function buildAcpPersistedSessionFields(
  input: AcpPersistedSessionUpdateInput,
): {
  databasePath?: string;
  sessionDropped: boolean;
  sessionId: string | null;
} {
  const databasePath = input.currentDatabasePath
    ?? input.conversationDatabasePath
    ?? null;
  const sessionId = input.sessionInvalidated && !input.sessionId
    ? null
    : input.sessionId;

  // "We had a session and lost it" has to outlive the runtime that learned it.
  // The in-memory flag is consumed by the first save, and saves happen on tab
  // close and on quit - so without a persisted marker a drop that nobody
  // answered yet reads as a first-ever send on the next launch, and the whole
  // transcript gets replayed into a fresh session. The marker clears itself the
  // moment a real session id is persisted again.
  const sessionDropped = !sessionId
    && (input.sessionInvalidated || input.conversationSessionDropped === true);

  return {
    ...(databasePath ? { databasePath } : {}),
    sessionDropped,
    sessionId,
  };
}

export function buildAcpSessionLoadFailureDebugEvent(
  context: AcpSessionLoadFailureContext,
): {
  data: Record<string, unknown>;
  error?: unknown;
  event: string;
  level: 'warn';
  scope: string;
} {
  const errorMessage = context.error instanceof Error
    ? context.error.message
    : context.error === undefined || context.error === null
      ? undefined
      : typeof context.error === 'string'
        ? context.error
        : undefined;

  return {
    data: {
      ...(context.cwd ? { cwdLabel: context.cwd } : {}),
      ...(context.databasePath ? { pathEntryCount: 1 } : {}),
      ...(errorMessage ? { errorSummary: errorMessage } : {}),
      provider: context.providerId,
      reason: 'session_load_failed',
      ...(context.stderr ? { stderrPreview: context.stderr.slice(0, 500) } : {}),
      // session ids are opaque provider tokens; keep short for diagnostics.
      status: context.sessionId.slice(0, 12),
    },
    error: context.error,
    event: 'session.load_failed',
    level: 'warn',
    scope: `provider.${context.providerId}`,
  };
}
