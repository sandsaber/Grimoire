/**
 * What is attached to the next message, as one list.
 *
 * Before this the composer knew about the open note, a set of mentioned vault
 * paths and a list of external files, and each of the three was drawn by a
 * different view that could not see the others. A reader with nine things
 * attached had no way to see what they were, what they cost, or to remove one
 * of them without removing the rest.
 */

/** Where an attached thing came from. Ordering inside a group is insertion order. */
export type ContextSourceKind =
  | 'vault-file'
  | 'vault-folder'
  | 'external-file'
  | 'link'
  | 'selection'
  | 'open-note';

/**
 * Whether the thing can contribute to the next turn.
 *
 * `failed` is not a synonym for absent: an unreadable attachment stays in the
 * list with its reason until the reader removes it, because silently dropping
 * it is how a turn goes out missing the file it was about.
 */
export type ContextItemState = 'loaded' | 'loading' | 'failed' | 'pinned';

export interface ContextItem {
  /** Stable across re-renders; the row key. */
  id: string;
  kind: ContextSourceKind;
  /** What the row shows — `2026-08 Tromsø.md`. */
  name: string;
  /** Where it came from — a folder, "dropped from Finder", a host. */
  detail: string;
  /** Vault-relative, absolute, or a URL. */
  path: string;
  /** `null` while unknown. Rendered as an em dash, never as zero. */
  tokens: number | null;
  state: ContextItemState;
  /** One line, e.g. "unreadable — needs a text layer". */
  error?: string;
  addedBy: 'mention' | 'drop' | 'picker' | 'auto';
  /** True while the item is part of a turn already in flight. */
  inFlight?: boolean;
}

export interface ContextBudget {
  /** The model's reported context window, or 0 when the model has not said. */
  windowTokens: number;
  /** Everything already in the conversation. */
  usedTokens: number;
}

/** The two groups, in the order they are shown. */
export const CONTEXT_GROUPS = ['vault', 'external'] as const;
export type ContextGroup = typeof CONTEXT_GROUPS[number];

export function groupOf(item: ContextItem): ContextGroup {
  return item.kind === 'external-file' || item.kind === 'link' ? 'external' : 'vault';
}

/**
 * The sum of what is attached, and how many items could not be counted.
 *
 * Computed, never stored: a cached total is a total that disagrees with the
 * list the moment a row is removed.
 */
export function attachedTokens(items: readonly ContextItem[]): {
  total: number;
  uncounted: number;
} {
  let total = 0;
  let uncounted = 0;
  for (const item of items) {
    if (item.state === 'failed') continue;
    if (item.tokens === null) {
      uncounted += 1;
      continue;
    }
    total += item.tokens;
  }
  return { total, uncounted };
}

/**
 * The share of the window this message would take, as a percentage.
 *
 * Returns `null` when the model has not reported a window: a percentage of an
 * unknown total is a number that looks like information and is not.
 */
export function projectedPercent(
  items: readonly ContextItem[],
  budget: ContextBudget,
): number | null {
  if (!Number.isFinite(budget.windowTokens) || budget.windowTokens <= 0) return null;
  const used = Math.max(0, budget.usedTokens) + attachedTokens(items).total;
  return Math.round((used / budget.windowTokens) * 100);
}

/** By how many tokens this message would overrun the window, or 0. */
export function overBudgetTokens(
  items: readonly ContextItem[],
  budget: ContextBudget,
): number {
  if (!Number.isFinite(budget.windowTokens) || budget.windowTokens <= 0) return 0;
  const used = Math.max(0, budget.usedTokens) + attachedTokens(items).total;
  return Math.max(0, used - budget.windowTokens);
}

export function isOverBudget(items: readonly ContextItem[], budget: ContextBudget): boolean {
  return overBudgetTokens(items, budget) > 0;
}

/**
 * A token count as the reader sees it: `18.4k`, `812`, or an em dash.
 *
 * Never "0". A file whose size could not be read has an unknown cost, and zero
 * is a specific claim that it is free.
 */
export function formatTokens(tokens: number | null): string {
  if (tokens === null || !Number.isFinite(tokens)) return '—';
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

/**
 * Sorted into groups without being re-sorted inside one.
 *
 * "Never re-sort under the user" is the whole rule here: a row that moves while
 * it is being pointed at is a row that gets removed by mistake.
 */
export function groupItems(items: readonly ContextItem[]): Map<ContextGroup, ContextItem[]> {
  const grouped = new Map<ContextGroup, ContextItem[]>();
  for (const group of CONTEXT_GROUPS) grouped.set(group, []);
  for (const item of items) grouped.get(groupOf(item))?.push(item);
  for (const group of CONTEXT_GROUPS) {
    if (grouped.get(group)?.length === 0) grouped.delete(group);
  }
  return grouped;
}

/**
 * Truncates a long name through the middle, never through the extension.
 *
 * The extension is the part that says what the thing is, and it is the part a
 * tail-truncation eats first.
 */
export function truncateName(name: string, max = 18): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const stem = extension ? name.slice(0, dot) : name;
  const room = max - extension.length - 1;
  if (room <= 1) return `${name.slice(0, Math.max(1, max - 1))}…`;
  const head = Math.ceil(room / 2);
  const tail = Math.floor(room / 2);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${extension}`;
}
