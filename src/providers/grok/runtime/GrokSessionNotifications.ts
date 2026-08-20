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

const ACP_SESSION_UPDATE_TYPES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'available_commands_update',
  'config_option_update',
  'current_mode_update',
  'plan',
  'session_info_update',
  'tool_call',
  'tool_call_update',
  'usage_update',
  'user_message_chunk',
]);

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

export function isGrokTurnCompletedUpdate(update: unknown): boolean {
  return isRecord(update)
    && (update.sessionUpdate === 'turn_completed' || update.type === 'turn_completed');
}

export function isSupportedAcpSessionUpdate(update: unknown): boolean {
  return isRecord(update)
    && typeof update.sessionUpdate === 'string'
    && ACP_SESSION_UPDATE_TYPES.has(update.sessionUpdate);
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
