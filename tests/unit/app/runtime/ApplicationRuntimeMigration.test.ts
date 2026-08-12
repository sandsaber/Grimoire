import { ApplicationRuntimeMigration } from '@/app/runtime/ApplicationRuntimeMigration';

describe('ApplicationRuntimeMigration', () => {
  it('runs once and is idempotent', async () => {
    const migration = new ApplicationRuntimeMigration();
    await expect(migration.migrate()).resolves.toBeUndefined();
    await expect(migration.migrate()).resolves.toBeUndefined();
  });
});
