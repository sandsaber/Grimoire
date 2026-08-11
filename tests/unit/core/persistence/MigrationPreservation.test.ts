import { readFileSync } from 'node:fs';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { GrimoireSettingsStorage } from '@/app/settings/GrimoireSettingsStorage';
import { GRIMOIRE_SETTINGS_PATH, SESSIONS_PATH } from '@/core/bootstrap/StoragePaths';
import { ConversationRepository } from '@/core/persistence/ConversationRepository';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { SessionMetadata } from '@/core/types';

const FIXTURE_ROOT = 'tests/fixtures/persistence';
const NATIVE_HISTORY_PATH = '.codex/sessions/native-thread-1.jsonl';
const PLUGIN_DATA_PATH = '.obsidian/plugins/grimoire/data.json';

function readFixture(name: string): string {
  return readFileSync(`${FIXTURE_ROOT}/${name}`, 'utf8');
}

describe('persistence migration preservation', () => {
  it('imports legacy session metadata without rewriting settings or provider-native data', async () => {
    const storage = new TestDurableStorage();
    const settingsBytes = readFixture('grimoire-settings.json');
    const pluginDataBytes = readFixture('plugin-data.json');
    const sessionBytes = readFixture('session-metadata.json');
    const nativeHistoryBytes = readFixture('codex-rollout.jsonl');
    const legacySessionPath = `${SESSIONS_PATH}/fixture-conversation.meta.json`;
    storage.seed(GRIMOIRE_SETTINGS_PATH, settingsBytes);
    storage.seed(PLUGIN_DATA_PATH, pluginDataBytes);
    storage.seed(legacySessionPath, sessionBytes);
    storage.seed(NATIVE_HISTORY_PATH, nativeHistoryBytes);
    const metadata = JSON.parse(sessionBytes) as SessionMetadata;
    const settingsWrite = jest.fn(async (path: string, content: string) => {
      await storage.writeAtomic(path, content);
    });
    const settingsStorage = new GrimoireSettingsStorage({
      exists: async (path: string) => await storage.read(path) !== null,
      read: async (path: string) => {
        const value = await storage.read(path);
        if (value === null) {
          throw new Error(`Missing fixture path ${path}`);
        }
        return value;
      },
      write: settingsWrite,
      delete: async (path: string) => storage.remove(path),
      rename: async () => {
        throw new Error('Fixture settings must not be migrated.');
      },
    } as unknown as VaultFileAdapter);
    const repository = new ConversationRepository(storage, { now: () => 1750000002000 });

    const loadedSettings = await settingsStorage.load();
    const imported = await repository.importLegacyMetadata(metadata, 'claude');
    const replayed = await repository.importLegacyMetadata(metadata, 'claude');

    expect(imported.revision).toBe(1);
    expect(replayed.revision).toBe(1);
    expect(imported.payload).toEqual({
      ...metadata,
      providerId: 'codex',
    });
    expect(imported.payload.providerState).toEqual(metadata.providerState);
    expect(loadedSettings.userName).toBe('Vault User');
    expect(loadedSettings.model).toBe('gpt-5-codex');
    expect(loadedSettings.effortLevel).toBe('high');
    expect(loadedSettings.providerConfigs.codex).toMatchObject({
      enabled: true,
      reasoningSummary: 'detailed',
    });
    expect(JSON.parse(pluginDataBytes)).toMatchObject({
      tabManagerState: {
        openTabs: [{ titleOverride: 'Pinned fixture' }],
      },
    });
    expect(nativeHistoryBytes.split('\n').filter(Boolean).map(line => (
      JSON.parse(line) as { type: string }
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session_meta' }),
      expect.objectContaining({ type: 'response_item' }),
    ]));
    expect(settingsWrite).not.toHaveBeenCalled();
    expect(storage.get(GRIMOIRE_SETTINGS_PATH)).toBe(settingsBytes);
    expect(storage.get(PLUGIN_DATA_PATH)).toBe(pluginDataBytes);
    expect(storage.get(legacySessionPath)).toBe(sessionBytes);
    expect(storage.get(NATIVE_HISTORY_PATH)).toBe(nativeHistoryBytes);
  });
});
