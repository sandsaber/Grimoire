import type { ContextItem } from '@/features/chat/ui/context-manager/contextItems';
import { ContextStore } from '@/features/chat/ui/context-manager/ContextStore';

function item(id: string, overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id,
    kind: 'vault-file',
    name: `${id}.md`,
    detail: '',
    path: `${id}.md`,
    tokens: 100,
    state: 'loaded',
    addedBy: 'mention',
    ...overrides,
  };
}

describe('ContextStore', () => {
  it('keeps insertion order and refuses a second row for the same thing', () => {
    const store = new ContextStore();

    expect(store.add(item('a'))).toBe(true);
    expect(store.add(item('b'))).toBe(true);
    // Adding something already attached is not an error and not a no-op: the
    // row that is already there flashes, and the count stays the same.
    expect(store.add(item('a'))).toBe(false);

    expect(store.getItems().map(entry => entry.id)).toEqual(['a', 'b']);
    expect([...store.takeDuplicates()]).toEqual(['a']);
    // Read once, so the flash plays once.
    expect(store.takeDuplicates().size).toBe(0);
  });

  it('removes exactly the selection', () => {
    const store = new ContextStore();
    store.add(item('a'));
    store.add(item('b'));
    store.add(item('c'));

    store.removeMany(['a', 'c']);

    expect(store.getItems().map(entry => entry.id)).toEqual(['b']);
  });

  it('notifies once per change, and not at all when nothing changed', () => {
    const store = new ContextStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.add(item('a'));
    expect(listener).toHaveBeenCalledTimes(1);

    store.remove('missing');
    expect(listener).toHaveBeenCalledTimes(1);

    store.removeMany([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not redraw when a replace carries the same list', () => {
    // `sync()` runs on every keystroke that touches the composer; a store that
    // emitted on each one would rebuild the chip row under the reader's cursor.
    const store = new ContextStore();
    store.replace([item('a'), item('b')]);
    const listener = jest.fn();
    store.subscribe(listener);

    store.replace([item('a'), item('b')]);
    expect(listener).not.toHaveBeenCalled();

    store.replace([item('a'), item('b', { tokens: 200 })]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits when the window moves, because the same list now costs a different share', () => {
    const store = new ContextStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.setBudget({ windowTokens: 200_000, usedTokens: 1000 });
    expect(listener).toHaveBeenCalledTimes(1);

    store.setBudget({ windowTokens: 200_000, usedTokens: 1000 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener that unsubscribed', () => {
    const store = new ContextStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.add(item('a'));

    expect(listener).not.toHaveBeenCalled();
  });
});
