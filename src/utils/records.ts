/**
 * The one `isRecord`.
 *
 * Twenty-seven copies of this lived across the codebase in five spellings —
 * `!!value &&`, `value !== null &&`, `Boolean(value) &&`, `value != null &&` —
 * all meaning the same thing, which is the problem: five ways to write one rule
 * is five places for it to stop meaning the same thing. It is a type guard
 * every layer needs and none owns, so it lives here with the other neutral
 * helpers.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
