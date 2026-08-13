import { LEGACY_SESSIONS_PATH,SESSIONS_PATH } from '../../core/bootstrap/StoragePaths';
import type { DurableStorage } from '../../core/persistence/DurableStorage';
import type { SessionMetadata } from '../../core/types';
import type { LegacySessionMetadataReader } from './ApplicationRuntimeMigration';

/**
 * Reads legacy session metadata from the durable storage paths.
 * Used by the migration to import legacy conversations into the
 * revisioned conversation repository.
 */
export class LegacySessionMetadataAdapter implements LegacySessionMetadataReader {
  constructor(private readonly storage: DurableStorage) {}

  async listMetadata(): Promise<SessionMetadata[]> {
    const results: SessionMetadata[] = [];
    for (const basePath of [SESSIONS_PATH, LEGACY_SESSIONS_PATH]) {
      const paths = await this.storage.list(basePath);
      for (const path of paths) {
        if (!path.endsWith('.meta.json')) continue;
        try {
          const raw = await this.storage.read(path);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as SessionMetadata;
          if (parsed && typeof parsed.id === 'string') {
            results.push(parsed);
          }
        } catch {
          // Skip unreadable or invalid metadata files.
        }
      }
    }
    return results;
  }
}
