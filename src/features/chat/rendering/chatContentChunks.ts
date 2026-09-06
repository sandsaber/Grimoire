import type { ChatContentItem, StreamChunk } from '../../../core/types';

/**
 * What of a provider's presented output is *content*, and what is framing.
 *
 * A content presenter still returns the whole `StreamChunk` union, and two
 * provider normalizers still emit framing into it. **No surface receives one**:
 * a turn's shape is what the projection states — where it begins, when it is
 * running, how it ended — so framing arriving as content would be a second
 * opinion about a fact the kernel owns, and this filter drops it.
 *
 * It is emitted anyway, and the reason is not that something draws it. For the
 * ACP providers the framing is the presenter's *only* response to a message
 * chunk: `GrokContentPresenter` given an `agent_message_chunk` returns
 * `assistant_message_start` and nothing else, and returns nothing at all for
 * the chunks after it, because the answer's text is what the kernel already
 * carries — which is what the presenter tests mean by "drops the copy of the
 * answer the kernel already carries". `wireVocabularyCoverage` reads a
 * presenter returning any chunk as that update having been modelled, so
 * deleting the emission would file `agent_message_chunk` and
 * `user_message_chunk` under "nothing draws the surface from this" for updates
 * the kernel does consume. Removing it needs a way for that gate to see kernel
 * consumption, not just presenter output. Recorded against the smoke matrix.
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
