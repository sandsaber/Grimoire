import { isRecord } from '../../../utils/records';
import type { AcpSessionNotification, AcpUsage } from '../../acp';

/**
 * The one notification Reasonix sends under its own name that anything is
 * drawn from.
 *
 * `reasonix acp` never sends the ACP `usage_update` session update — probed on
 * 2026-09-09 across a trivial turn and an eleven-tool Plan turn, and absent
 * from both. What it sends instead is `_reasonix.io/session/status_update`:
 * the whole session status, three or nine times a turn, with the turn's and the
 * session's tokens on it. Without this the usage badge would have nothing, and
 * with a guessed shape it would have the wrong thing.
 *
 * The status carries neither context occupancy nor a window. Its turn totals
 * sum every model request, including repeated prompts after tools. The
 * synthesized update therefore uses zero placeholders and keeps billing
 * counts only in metadata; the presenter does not draw a context meter from it.
 *
 * **The cost rides on the completion status and no other.** `usage.turn` is a
 * running figure for the turn in progress, re-sent whole on every status —
 * `event: "usage"` and `event: "completion"` both carried `totalTokens: 5999`
 * for one turn in the recording, and a nine-status turn would carry it nine
 * times. The spend store adds what it is given, so forwarding every status
 * would multiply one turn's charge by however many times the agent reported it.
 * Tokens are a replacement and may arrive at any status; a charge is an
 * addition and arrives once.
 */
export const REASONIX_STATUS_UPDATE_METHOD = '_reasonix.io/session/status_update';

/** The one status event that means the turn is over and its cost is final. */
const REASONIX_COMPLETION_EVENT = 'completion';

export const REASONIX_SESSION_NOTIFICATION_METHODS = [
  REASONIX_STATUS_UPDATE_METHOD,
] as const;

/** Where the turn's own token counts ride on the synthesised usage update. */
export const REASONIX_TURN_USAGE_META_KEY = 'reasonix.io/turnUsage';

export function parseReasonixSessionNotification(
  method: string,
  params: unknown,
): AcpSessionNotification | null {
  if (method !== REASONIX_STATUS_UPDATE_METHOD || !isRecord(params)) {
    return null;
  }
  const sessionId = params.sessionId;
  const status = params.status;
  if (typeof sessionId !== 'string' || !sessionId.trim() || !isRecord(status)) {
    return null;
  }
  const usage = isRecord(status.usage) ? status.usage : null;
  const turn = readUsage(usage?.turn);
  if (!turn) {
    return null;
  }
  return {
    sessionId,
    update: {
      sessionUpdate: 'usage_update',
      // No window is stated anywhere in the status, so none is claimed here.
      size: 0,
      // Turn totals sum repeated model requests; they are not occupancy.
      used: 0,
      cost: params.event === REASONIX_COMPLETION_EVENT ? readCost(usage?.turn) : null,
      _meta: { [REASONIX_TURN_USAGE_META_KEY]: turn },
    } as AcpSessionNotification['update'],
  };
}

/** The turn's tokens, in the shape every ACP usage badge is built from. */
function readUsage(value: unknown): AcpUsage | null {
  if (!isRecord(value)) {
    return null;
  }
  const totalTokens = readNumber(value.totalTokens);
  if (totalTokens === null || totalTokens <= 0) {
    // A turn that has not started reports zeros on every field; a badge built
    // from those would replace what the last turn spent with nothing.
    return null;
  }
  return {
    cachedReadTokens: readNumber(value.cacheHitTokens) ?? 0,
    // **`cacheMissTokens` is deliberately not `cachedWriteTokens`.** A miss is
    // a partition of the prompt, not a cache that was written: the recording's
    // own numbers are `promptTokens: 5996, cacheMissTokens: 5996`, and mapping
    // the second would report 11,992 tokens of a 5,996-token prompt under two
    // names. Reasonix says nothing about cache writes, so neither does this.
    cachedWriteTokens: 0,
    inputTokens: readNumber(value.promptTokens) ?? 0,
    outputTokens: readNumber(value.completionTokens) ?? 0,
    thoughtTokens: readNumber(value.reasoningTokens) ?? 0,
    totalTokens,
  };
}

/**
 * What the turn cost, when Reasonix could price it.
 *
 * Both fields are null on a provider with no price table — the recorded
 * session says so as `costQuote.incompleteReason: "no_price"` — so an unpriced
 * turn contributes nothing to the spend indicator rather than a zero.
 *
 * Only ever read for a completion status; see the note above on why.
 */
function readCost(value: unknown): { amount: number; currency: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const amount = readNumber(value.estimatedCost);
  const currency = typeof value.currency === 'string' ? value.currency.trim() : '';
  return amount !== null && amount > 0 && currency ? { amount, currency } : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
