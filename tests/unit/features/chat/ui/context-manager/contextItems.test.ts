import type { ContextItem } from '@/features/chat/ui/context-manager/contextItems';
import {
  attachedTokens,
  formatTokens,
  groupItems,
  isOverBudget,
  overBudgetTokens,
  projectedPercent,
  truncateName,
} from '@/features/chat/ui/context-manager/contextItems';

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: overrides.path ? `vault:${overrides.path}` : 'vault:a.md',
    kind: 'vault-file',
    name: 'a.md',
    detail: '',
    path: 'a.md',
    tokens: 1000,
    state: 'loaded',
    addedBy: 'mention',
    ...overrides,
  };
}

describe('context items', () => {
  describe('cost', () => {
    it('sums what it can count and says how much it could not', () => {
      const { total, uncounted } = attachedTokens([
        item({ id: 'a', tokens: 1000 }),
        item({ id: 'b', tokens: 400 }),
        item({ id: 'c', tokens: null }),
      ]);

      expect(total).toBe(1400);
      expect(uncounted).toBe(1);
    });

    it('leaves a failed item out of the sum, because it cannot be sent', () => {
      const { total } = attachedTokens([
        item({ id: 'a', tokens: 1000 }),
        item({ id: 'b', tokens: 9000, state: 'failed', error: 'missing' }),
      ]);

      expect(total).toBe(1000);
    });

    it('renders an unknown cost as an em dash rather than as zero', () => {
      // Zero is a specific claim that the file is free.
      expect(formatTokens(null)).toBe('—');
      expect(formatTokens(812)).toBe('812');
      expect(formatTokens(1400)).toBe('1.4k');
      expect(formatTokens(18_400)).toBe('18k');
    });
  });

  describe('budget', () => {
    const budget = { windowTokens: 10_000, usedTokens: 2000 };

    it('projects the share of the window this message would take', () => {
      expect(projectedPercent([item({ tokens: 1400 })], budget)).toBe(34);
    });

    it('answers null rather than a percentage of an unknown window', () => {
      // A percentage of nothing looks like information and is not.
      expect(projectedPercent([item()], { windowTokens: 0, usedTokens: 0 })).toBeNull();
      expect(isOverBudget([item()], { windowTokens: 0, usedTokens: 0 })).toBe(false);
    });

    it('names the overage rather than only reporting that there is one', () => {
      const items = [item({ tokens: 9000 })];

      expect(isOverBudget(items, budget)).toBe(true);
      expect(overBudgetTokens(items, budget)).toBe(1000);
    });
  });

  describe('order', () => {
    it('groups vault before external and never re-sorts inside a group', () => {
      // A row that moves while it is being pointed at is a row removed by
      // mistake.
      const items = [
        item({ id: 'x', name: 'x.md', path: 'x.md' }),
        item({ id: 'e', kind: 'external-file', name: 'notes.txt', path: '/tmp/notes.txt' }),
        item({ id: 'a', name: 'a.md', path: 'a.md' }),
      ];

      const grouped = groupItems(items);

      expect([...grouped.keys()]).toEqual(['vault', 'external']);
      expect(grouped.get('vault')?.map(entry => entry.id)).toEqual(['x', 'a']);
      expect(grouped.get('external')?.map(entry => entry.id)).toEqual(['e']);
    });

    it('drops a group with nothing in it rather than labelling an empty one', () => {
      expect([...groupItems([item()]).keys()]).toEqual(['vault']);
    });
  });

  describe('names', () => {
    it('truncates through the middle and keeps the extension', () => {
      // The extension says what the thing is, and a tail truncation eats it
      // first.
      const truncated = truncateName('2026-08 Tromsø fieldnotes.md', 18);

      expect(truncated.endsWith('.md')).toBe(true);
      expect(truncated).toContain('…');
      expect(truncated.length).toBeLessThanOrEqual(18);
    });

    it('leaves a name that already fits alone', () => {
      expect(truncateName('a.md', 18)).toBe('a.md');
    });
  });
});
