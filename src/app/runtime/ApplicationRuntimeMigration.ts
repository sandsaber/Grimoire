import type { ConversationRepository } from '../../core/persistence/ConversationRepository';
import type { ProviderCatalog } from '../../core/providers/ProviderCatalog';
import type { SessionMetadata } from '../../core/types';
import type { ProviderId } from '../../core/types/provider';

export interface LegacySessionMetadataReader {
  listMetadata(): Promise<readonly SessionMetadata[]>;
}

/**
 * Storage migration for the application runtime. Imports legacy conversation
 * metadata from the old session store into the revisioned conversation
 * repository. The runtime calls it first during startup, before any backend
 * preparation.
 */
export class ApplicationRuntimeMigration {
  private migrated = false;

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly legacySessions: LegacySessionMetadataReader,
    private readonly catalog: ProviderCatalog,
  ) {}

  async migrate(): Promise<void> {
    if (this.migrated) return;
    this.migrated = true;

    const metadatas = await this.legacySessions.listMetadata();
    if (metadatas.length === 0) return;

    const defaultProviderId: ProviderId = this.catalog.list()[0]?.manifest.id ?? 'claude';

    for (const metadata of metadatas) {
      try {
        await this.conversations.importLegacyMetadata(metadata, defaultProviderId);
      } catch {
        // Individual import failures are non-fatal: the legacy metadata
        // remains in the old store and can be retried on next startup.
      }
    }
  }
}
