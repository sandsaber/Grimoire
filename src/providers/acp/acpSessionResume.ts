import { JsonRpcErrorResponse } from './AcpJsonRpcTransport';

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
