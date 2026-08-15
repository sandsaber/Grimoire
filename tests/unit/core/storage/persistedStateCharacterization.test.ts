import '@/providers';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { SESSIONS_PATH, SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { AppTabManagerState } from '@/core/providers/types';
import type { SessionMetadata } from '@/core/types';
import { getClaudeState } from '@/providers/claude/types/providerState';
import { getCodexState } from '@/providers/codex/types';

/**
 * Characterization of state Grimoire has already written to vaults.
 *
 * The migration's compatibility promise covers `.grimoire/grimoire-settings.json`,
 * `.grimoire/sessions/*.meta.json`, persisted tab state, and the opaque
 * `providerState` bag. "Byte-preserved by the test harness" is the M0a exit
 * gate wording, so these fixtures are the proof rather than the claim: each one
 * is a file as it exists on disk, carrying fields a newer build might have
 * written that this build knows nothing about.
 */

function readFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures/persisted-state', name), 'utf8');
}

describe('persisted state characterization', () => {
  describe('.grimoire/sessions/*.meta.json', () => {
    const raw = readFixture('session.meta.json');
    const parsed = JSON.parse(raw) as SessionMetadata & Record<string, unknown>;
    const path = `${SESSIONS_PATH}/${parsed.id}.meta.json`;

    it('loads a session written by a newer build without dropping it', async () => {
      const adapter = createInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter);

      const loaded = await storage.loadMetadata(parsed.id);

      expect(loaded).toEqual(parsed);
    });

    it('preserves unknown top-level and provider fields across a load-save cycle', async () => {
      const adapter = createInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter);

      const loaded = await storage.loadMetadata(parsed.id);
      await storage.saveMetadata(loaded as SessionMetadata);

      // The reference is the parsed original: formatting may be re-emitted,
      // but no field may be lost, reordered into oblivion, or rewritten.
      expect(JSON.parse(adapter.files.get(path) as string)).toEqual(parsed);
    });

    it('keeps the fork source and the unknown provider field inside providerState', async () => {
      const adapter = createInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter);

      const loaded = await storage.loadMetadata(parsed.id);
      await storage.saveMetadata(loaded as SessionMetadata);

      const rewritten = JSON.parse(adapter.files.get(path) as string) as SessionMetadata;
      expect(rewritten.providerState).toEqual(parsed.providerState);
      expect(rewritten.providerState?.unknownProviderField).toEqual({
        writtenByANewerBuild: true,
        nested: ['a', 'b'],
      });
    });

    it('silently drops a session whose provider is not registered', async () => {
      // Characterized, not endorsed. A conversation written by a build that had
      // a provider this build does not register disappears from history with no
      // error and no trace. The migration's typed hydration outcomes
      // (`absent`, `corrupt`, `stale`) exist to replace exactly this silence.
      const foreign = raw.replace('"providerId": "codex"', '"providerId": "retired-provider"');
      const adapter = createInMemoryVaultAdapter({ [path]: foreign });
      const storage = new SessionStorage(adapter);

      expect(await storage.loadMetadata(parsed.id)).toBeNull();
      expect(await storage.listMetadata()).toEqual([]);
    });

    it('round-trips through a list as well as a direct read', async () => {
      const adapter = createInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter);

      const listed = await storage.listMetadata();

      expect(listed).toEqual([parsed]);
    });
  });

  describe('opaque providerState', () => {
    const parsed = JSON.parse(readFixture('session.meta.json')) as SessionMetadata;

    it('reads the typed Codex view without discarding the rest of the bag', () => {
      const state = getCodexState(parsed.providerState);

      expect(state.threadId).toBe('thread_01HZXQ');
      expect(state.sessionFilePath).toBe('.codex/sessions/2026/08/thread_01HZXQ.jsonl');
      // The typed view is a projection, not a replacement: the bag itself is
      // what gets persisted, and it still carries the unknown field.
      expect(parsed.providerState?.unknownProviderField).toBeDefined();
    });

    it('returns an empty view when another provider reads the same bag', () => {
      const state = getClaudeState(parsed.providerState);

      expect(state.providerSessionId).toBeUndefined();
    });

    it('substitutes an empty view for a missing bag', () => {
      expect(getCodexState(undefined)).toEqual({});
      expect(getClaudeState(undefined)).toEqual({});
    });

    it('passes a malformed bag through unvalidated', () => {
      // Characterized, not endorsed. The accessors are plain passthroughs with
      // no shape check, so a corrupt `providerState` reaches provider code
      // exactly as it was read from disk. Validation belongs at the migration's
      // versioned persistence boundary, where a bad record becomes a typed
      // outcome rather than a surprise deeper in the provider.
      const malformed = 'not an object' as unknown as Record<string, unknown>;

      expect(getCodexState(malformed)).toBe(malformed);
      expect(getClaudeState(malformed)).toBe(malformed);
    });
  });

  describe('.grimoire/grimoire-settings.json', () => {
    const raw = readFixture('grimoire-settings.json');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    it('describes every registered provider', () => {
      const providerConfigs = parsed.providerConfigs as Record<string, unknown>;
      const registered = [
        ...readFileSync(resolve(process.cwd(), 'src/providers/index.ts'), 'utf8').matchAll(
          /ProviderRegistry\.register\('([^']+)'/g,
        ),
      ].map(match => match[1]);

      expect(Object.keys(providerConfigs).sort()).toEqual([...registered].sort());
    });

    it('carries a provider-owned setting this build does not model', () => {
      const providerConfigs = parsed.providerConfigs as Record<string, Record<string, unknown>>;

      // Pinned so a future settings normalization that strips unknown provider
      // keys has to face this fixture first.
      expect(providerConfigs.claude.providerOwnedSetting).toBe('kept verbatim');
    });
  });

  describe('persisted tab state', () => {
    const parsed = JSON.parse(readFixture('tab-state.json')) as AppTabManagerState;

    it('matches the shape the plugin persists', () => {
      expect(parsed.activeTabId).toBe('tab-1');
      expect(parsed.openTabs).toHaveLength(2);
      expect(parsed.openTabs[0].conversationId).toBe('session-m0a-fixture');
      expect(parsed.openTabs[1].conversationId).toBeNull();
    });

    it('keeps provider-owned draft settings opaque', () => {
      const draftSettings = parsed.openTabs[0].draftSettings as Record<string, unknown>;

      expect(draftSettings.providerOwnedDraftField).toBe('kept verbatim');
    });

    it('survives a JSON round-trip unchanged', () => {
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    });
  });
});
