export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CommandcodeOutputLimitError extends Error {}

export interface CommandcodeResult {
  subtype: 'success' | 'error' | 'max_turns';
  finalText: string;
  sessionId?: string;
  usage?: Record<string, unknown>;
}

const CONTENT_EVENTS = new Set([
  'text_delta', 'thinking_delta', 'tool_queued', 'tool_running',
  'tool_completed', 'tool_errored', 'tool_hook_blocked', 'tool_denied', 'model_request_end',
]);

/** Accepts complete NDJSON lines; run_end's full transcript is never forwarded. */
export class CommandcodeStream {
  result: CommandcodeResult | undefined;
  sessionId: string | undefined;

  constructor(private readonly onEvent: (event: Record<string, unknown>) => void) {}

  accept(line: string): void {
    if (!line.trim()) return;
    const frame: unknown = JSON.parse(line);
    if (!isRecord(frame)) throw new Error('Invalid Command Code frame.');
    if (frame.type === 'result') {
      if (this.result || !['success', 'error', 'max_turns'].includes(String(frame.subtype))
        || typeof frame.finalText !== 'string') {
        throw new Error('Invalid Command Code result.');
      }
      this.result = {
        subtype: frame.subtype as CommandcodeResult['subtype'],
        finalText: frame.finalText,
        ...(typeof frame.sessionId === 'string' ? { sessionId: frame.sessionId } : {}),
        ...(isRecord(frame.usage) ? { usage: frame.usage } : {}),
      };
      if (this.result.sessionId) this.sessionId = this.result.sessionId;
      return;
    }
    if (frame.type !== 'event' || !isRecord(frame.event)) return;
    const event = frame.event;
    if (event.type === 'run_start' && typeof event.sessionId === 'string') {
      this.sessionId = event.sessionId;
    }
    if (CONTENT_EVENTS.has(String(event.type))) this.onEvent(event);
  }
}
