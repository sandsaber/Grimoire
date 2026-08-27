import type { ChatContentItem, StreamChunk } from '../../../core/types';

/**
 * What of a provider's presented output is *content*, and what is framing.
 *
 * A content presenter still returns the whole `StreamChunk` union, because
 * `InputController` reads turn framing off that channel on the legacy path. On
 * the projection path a turn's shape is what the projection states — where it
 * begins, when it is running, how it ended — so framing arriving as content
 * would be a second opinion about a fact the kernel owns, drawn into the column
 * beside the projection's own.
 *
 * One definition, shared by the tab binding that applies it and by the live
 * harnesses that certify a flip. It had two: the harness's copy left the filter
 * out entirely, and the first Codex projection run drew `user_message_start`
 * and `assistant_message_start` into the column and reported it as a finding —
 * a harness that does not mirror the binding measures itself.
 */
const TURN_LIFECYCLE_TYPES: ReadonlySet<string> = new Set([
  'user_message_start',
  'assistant_message_start',
  'status',
  'error',
  'done',
]);

export function isChatContent(chunk: StreamChunk): chunk is ChatContentItem {
  return !TURN_LIFECYCLE_TYPES.has(chunk.type);
}
