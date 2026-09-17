import type { DurableStorage } from '../persistence/DurableStorage';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type { ConversationMeta, SessionMetadata } from '../types';

const CACHE_PATH = '.grimoire/cache/conversation-headers.json';

interface HeaderEntry {
  mtime: number;
  size: number;
  metadata: SessionMetadata;
  summary: ConversationMeta;
}

/** Disposable startup cache. Conversation records remain the source of truth. */
export class ConversationHeaderCache {
  private previous = new Map<string, HeaderEntry>();
  private current = new Map<string, HeaderEntry>();

  constructor(private adapter: VaultFileAdapter, private durable: DurableStorage) {}

  async load(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await this.durable.read(CACHE_PATH) ?? 'null');
      if (!raw || typeof raw !== 'object') return;
      const cache = raw as { version?: unknown; entries?: unknown };
      if (cache.version !== 1 || !Array.isArray(cache.entries)) return;
      for (const entry of cache.entries) {
        if (isHeaderEntry(entry)) this.previous.set(entry.metadata.id, entry);
      }
    } catch {
      // Missing, damaged or incompatible caches are rebuilt from records.
    }
  }

  async get(id: string, path: string): Promise<HeaderEntry | undefined> {
    const entry = this.previous.get(id);
    const stat = await this.adapter.stat?.(path);
    if (!entry || !stat || stat.mtime !== entry.mtime || stat.size !== entry.size) return;
    this.current.set(id, entry);
    return entry;
  }

  async remember(
    metadata: SessionMetadata,
    summary: ConversationMeta,
    path: string,
    before: { mtime: number; size: number } | null | undefined,
  ): Promise<SessionMetadata> {
    // Keep session bindings for environment reconciliation, but no transcript
    // or per-message context. Opening a chat always reloads its actual record.
    const header = { ...metadata };
    delete header.messages;
    delete header.vaultSearchContexts;
    delete header.assistantResponseMetadata;
    const after = await this.adapter.stat?.(path);
    if (before && after && before.mtime === after.mtime && before.size === after.size) {
      this.current.set(metadata.id, { ...after, metadata: header, summary });
    }
    return header;
  }

  async save(): Promise<void> {
    try {
      await this.durable.writeAtomic(CACHE_PATH, JSON.stringify({ version: 1, entries: [...this.current.values()] }));
    } catch {
      // Cache writes must never make history unavailable or fail a saved turn.
    }
  }
}

function isHeaderEntry(value: unknown): value is HeaderEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as HeaderEntry;
  const meta = entry.metadata;
  const summary = entry.summary;
  return Number.isFinite(entry.mtime) && Number.isFinite(entry.size)
    && !!meta && typeof meta.id === 'string' && typeof meta.title === 'string'
    && Number.isFinite(meta.createdAt) && Number.isFinite(meta.updatedAt)
    && meta.messages === undefined && meta.vaultSearchContexts === undefined
    && meta.assistantResponseMetadata === undefined
    && !!summary && summary.id === meta.id && typeof summary.preview === 'string'
    && Number.isInteger(summary.messageCount) && summary.messageCount >= 0
    && typeof summary.hasUserMessage === 'boolean';
}
