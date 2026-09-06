import type { ChatMessage } from '../types';

/**
 * Attachments live only in Grimoire's own copy of a turn.
 *
 * A provider that rebuilds a conversation from its native transcript records
 * the image its own way - Grok Build saves it into the session's `assets/`
 * directory and names the path in the prompt, Codex writes an `<image ...>`
 * wrapper - so a message rebuilt from that log carries no `images` at all.
 * Replacing the stored list with the native one is what those transcripts are
 * for, but it must not cost the user the picture their message was about.
 *
 * User turns are aligned in order by what they say, so a prompt repeated with
 * and without an image keeps them apart: the first hydrated copy takes the
 * first stored copy, not whichever one happened to carry an attachment.
 */
export function carryOverImageAttachments(
  stored: readonly ChatMessage[],
  hydrated: ChatMessage[],
): ChatMessage[] {
  const storedUserMessages = stored.filter((message) => message.role === 'user');
  if (!storedUserMessages.some((message) => (message.images?.length ?? 0) > 0)) {
    return hydrated;
  }

  let cursor = 0;
  return hydrated.map((message) => {
    if (message.role !== 'user') {
      return message;
    }

    const content = comparableContent(message);
    while (
      cursor < storedUserMessages.length
      && comparableContent(storedUserMessages[cursor]) !== content
    ) {
      cursor += 1;
    }
    if (cursor >= storedUserMessages.length) {
      return message;
    }

    const match = storedUserMessages[cursor];
    cursor += 1;
    return (match.images?.length ?? 0) > 0 && (message.images?.length ?? 0) === 0
      ? { ...message, images: match.images }
      : message;
  });
}

function comparableContent(message: ChatMessage): string {
  return (message.displayContent ?? message.content ?? '').trim();
}
