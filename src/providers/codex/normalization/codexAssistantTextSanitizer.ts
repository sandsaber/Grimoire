const MEMORY_CITATION_BLOCK_PATTERN = /<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g;
/*
 * Codex wraps a plan-mode proposal in `<proposed_plan>` … `</proposed_plan>`,
 * each on its own line, and the plan between them is the answer. Dropped as
 * lines rather than as a block: the same text arrives as deltas, so the opening
 * tag and the closing one are usually in different chunks and a paired pattern
 * would match neither - which is how a plan came to be read with its markup.
 */
const PROPOSED_PLAN_TAG_PATTERN = /^<\/?proposed_plan>$/;
const MEMORY_CITATION_LINE_PATTERN = /^(?:MEMORY\.md|rollout_summaries\/[^:\s]+|skills\/[^:\s]+):\d+(?:-\d+)?\|note=\[[^\]\r\n]*\](?:\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

interface SanitizeCodexAssistantTextOptions {
  trimTrailingWhitespace?: boolean;
}

export function sanitizeCodexAssistantText(
  text: string,
  options: SanitizeCodexAssistantTextOptions = {},
): string {
  if (!text) {
    return '';
  }

  const withoutBlocks = text.replace(MEMORY_CITATION_BLOCK_PATTERN, '');
  const lines = withoutBlocks.split('\n');
  const visibleLines = lines.filter(line => {
    const trimmed = line.trim();
    return !MEMORY_CITATION_LINE_PATTERN.test(trimmed)
      && !PROPOSED_PLAN_TAG_PATTERN.test(trimmed);
  });
  const sanitized = visibleLines.join('\n');

  const normalized = sanitized.replace(/\n{3,}/g, '\n\n');
  return options.trimTrailingWhitespace ? normalized.trimEnd() : normalized;
}
