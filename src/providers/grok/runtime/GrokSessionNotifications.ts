import type { AcpSessionNotification } from '../../acp';

export const GROK_SESSION_UPDATE_NOTIFICATION_METHODS = [
  'x.ai/session/update',
  '_x.ai/session/update',
] as const;

export const GROK_WRAPPED_SESSION_NOTIFICATION_METHOD = '_x.ai/session_notification';

export const GROK_SESSION_NOTIFICATION_METHODS = [
  ...GROK_SESSION_UPDATE_NOTIFICATION_METHODS,
  GROK_WRAPPED_SESSION_NOTIFICATION_METHOD,
] as const;

const GROK_WRAPPED_SESSION_NOTIFICATION_NAME = 'x.ai/session_notification';

export type GrokSessionNotificationSource =
  | 'standard'
  | (typeof GROK_SESSION_UPDATE_NOTIFICATION_METHODS)[number]
  | typeof GROK_WRAPPED_SESSION_NOTIFICATION_METHOD;

export function parseGrokSessionNotification(
  method: string,
  params: unknown,
): AcpSessionNotification | null {
  if (GROK_SESSION_UPDATE_NOTIFICATION_METHODS.some(candidate => candidate === method)) {
    return parseSessionNotification(params);
  }

  if (method !== GROK_WRAPPED_SESSION_NOTIFICATION_METHOD || !isRecord(params)) {
    return null;
  }

  // Two shapes, and the wire says which one is current. 1.0.5 sends the
  // notification *as* the params — `{sessionId, update}` and nothing else — so
  // requiring the envelope's inner `method` dropped every update Grok sends
  // this way, the turn's usage and its stop reason among them. The envelope is
  // still accepted, because an older CLI wraps it.
  if (params.method === GROK_WRAPPED_SESSION_NOTIFICATION_NAME) {
    return parseSessionNotification(params.params);
  }
  return typeof params.method === 'string' ? null : parseSessionNotification(params);
}

function parseSessionNotification(value: unknown): AcpSessionNotification | null {
  if (!isRecord(value) || !isRecord(value.update)) {
    return null;
  }
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim()) {
    return null;
  }

  return value as unknown as AcpSessionNotification;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
