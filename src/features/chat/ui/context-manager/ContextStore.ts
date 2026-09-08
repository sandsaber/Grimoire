import type { ContextBudget, ContextItem } from './contextItems';

export type ContextStoreListener = () => void;

/**
 * The one list the composer, the manage dialog and the add picker all read.
 *
 * It owns order — insertion order inside a group, and nothing re-sorts under
 * the reader — and it owns identity, so adding the same path twice flashes the
 * row that is already there instead of growing a second one.
 */
export class ContextStore {
  private items: ContextItem[] = [];
  private budget: ContextBudget = { windowTokens: 0, usedTokens: 0 };
  private readonly listeners = new Set<ContextStoreListener>();
  /** Rows the dialog should flash because the reader added them again. */
  private readonly duplicates = new Set<string>();

  subscribe(listener: ContextStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getItems(): readonly ContextItem[] {
    return this.items;
  }

  getBudget(): ContextBudget {
    return this.budget;
  }

  setBudget(budget: ContextBudget): void {
    if (
      budget.windowTokens === this.budget.windowTokens
      && budget.usedTokens === this.budget.usedTokens
    ) {
      return;
    }
    this.budget = budget;
    this.emit();
  }

  has(id: string): boolean {
    return this.items.some(item => item.id === id);
  }

  /**
   * Adds an item, or marks the existing one as a duplicate.
   *
   * @returns whether the list grew.
   */
  add(item: ContextItem): boolean {
    if (this.has(item.id)) {
      this.duplicates.add(item.id);
      this.emit();
      return false;
    }
    this.items.push(item);
    this.emit();
    return true;
  }

  /** Replaces the whole list, keeping the order it is given. */
  replace(items: ContextItem[]): void {
    const sameLength = items.length === this.items.length;
    const unchanged = sameLength && items.every((item, index) => {
      const previous = this.items[index];
      return previous
        && previous.id === item.id
        && previous.tokens === item.tokens
        && previous.state === item.state
        && previous.inFlight === item.inFlight
        && previous.detail === item.detail
        && previous.error === item.error;
    });
    if (unchanged) return;
    this.items = items;
    this.emit();
  }

  remove(id: string): void {
    const next = this.items.filter(item => item.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.duplicates.delete(id);
    this.emit();
  }

  removeMany(ids: Iterable<string>): void {
    const doomed = new Set(ids);
    if (doomed.size === 0) return;
    const next = this.items.filter(item => !doomed.has(item.id));
    if (next.length === this.items.length) return;
    this.items = next;
    for (const id of doomed) this.duplicates.delete(id);
    this.emit();
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items = [];
    this.duplicates.clear();
    this.emit();
  }

  update(id: string, patch: Partial<ContextItem>): void {
    let changed = false;
    this.items = this.items.map(item => {
      if (item.id !== id) return item;
      changed = true;
      return { ...item, ...patch };
    });
    if (changed) this.emit();
  }

  /** Reads and clears the duplicate flags, so a flash plays once. */
  takeDuplicates(): Set<string> {
    const taken = new Set(this.duplicates);
    this.duplicates.clear();
    return taken;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
