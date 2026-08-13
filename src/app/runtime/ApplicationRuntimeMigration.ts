/**
 * Storage migration for the new application runtime. Currently a no-op:
 * legacy vault data migration is a dedicated step that will
 * populate this port. The runtime calls it first during startup, before any
 * backend preparation, so migrations may run before the lifecycle registry
 * opens.
 */
export class ApplicationRuntimeMigration {
  private migrated = false;

  async migrate(): Promise<void> {
    if (this.migrated) return;
    this.migrated = true;
  }
}
