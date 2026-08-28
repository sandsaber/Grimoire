import '@/providers';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';

import { GRIMOIRE_SETTINGS_PATH, GrimoireSettingsStorage } from '@/app/settings/GrimoireSettingsStorage';
import { SharedStorageService } from '@/app/storage/SharedStorageService';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
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

/**
 * The conversation inside the file, whatever the file is wrapped in.
 *
 * Since M4 a conversation is written as a versioned record: the same object,
 * inside an envelope carrying its schema version and its revision. The
 * compatibility promise is about the conversation, so that is what these
 * comparisons read — and the envelope itself is asserted once, on its own.
 */
function payloadOf(adapter: { files: Map<string, string> }, path: string): unknown {
  const stored = JSON.parse(adapter.files.get(path) as string) as Record<string, unknown>;
  return stored.payload ?? stored;
}

describe('persisted state characterization', () => {
  describe('.grimoire/sessions/*.meta.json', () => {
    const raw = readFixture('session.meta.json');
    const parsed = JSON.parse(raw) as SessionMetadata & Record<string, unknown>;
    const path = `${SESSIONS_PATH}/${parsed.id}.meta.json`;

    it('refuses a conversation id that would write outside the sessions folder', async () => {
      const adapter = createDurableInMemoryVaultAdapter();
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      // A conversation's id is its provider's session id whenever one was
      // resumed, so it is a value Grimoire did not mint. Interpolated into a
      // path unchecked, this one writes into the user's own notes.
      await expect(storage.saveMetadata({
        ...parsed,
        id: '../../../notes/stolen',
      })).rejects.toThrow(/not usable as a session file name/);
      expect([...adapter.files.keys()]).toEqual([]);
      // And it is not quietly answered as a conversation that exists, either.
      await expect(storage.loadMetadata('../../../notes/stolen')).resolves.toBeNull();
    });

    it('leaves the previous transcript readable when a write is interrupted', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));
      const previous = adapter.files.get(path) as string;

      // A metadata file is a whole conversation. A plain write torn by a crash
      // or a quit left truncated JSON behind, which `loadMetadata` then
      // answered as a conversation that no longer exists.
      adapter.rename = async () => {
        throw new Error('interrupted');
      };
      await expect(storage.saveMetadata({ ...parsed, title: 'Half written' }))
        .rejects.toThrow('interrupted');

      const recovered = await new SessionStorage(
        adapter,
        new VaultDurableStorage(adapter),
      ).loadMetadata(parsed.id);
      expect(recovered).toEqual(JSON.parse(previous));
    });

    it('loads a session written by a newer build without dropping it', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      const loaded = await storage.loadMetadata(parsed.id);

      expect(loaded).toEqual(parsed);
    });

    it('preserves unknown top-level and provider fields across a load-save cycle', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      const loaded = await storage.loadMetadata(parsed.id);
      await storage.saveMetadata(loaded as SessionMetadata);

      // The reference is the parsed original: formatting may be re-emitted,
      // but no field may be lost, reordered into oblivion, or rewritten.
      expect(payloadOf(adapter, path)).toEqual(parsed);
    });

    it('wraps the conversation in a record envelope, and keeps the file name', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      const loaded = await storage.loadMetadata(parsed.id);
      await storage.saveMetadata(loaded as SessionMetadata);

      // The layout M4 lands: the same path, the same file name, the same
      // conversation — inside an envelope that says which schema wrote it and
      // which revision this is, so a writer holding an older one is refused
      // rather than applied.
      const stored = JSON.parse(adapter.files.get(path) as string) as Record<string, unknown>;
      expect(stored.schemaVersion).toBe(1);
      expect(stored.recordId).toBe(parsed.id);
      expect(typeof stored.revision).toBe('number');
      expect(stored.payload).toEqual(parsed);
      expect([...adapter.files.keys()]).toEqual([path]);
    });

    it('reads a conversation written before the envelope existed, and upgrades it in place', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      // Every vault in the field holds the bare object. Read as-is by a store
      // that only understood envelopes it would be unreadable — for every
      // conversation the user has, at once.
      const before = await storage.loadMetadata(parsed.id);
      expect(before).toEqual(parsed);
      // Untouched until something legitimately writes it.
      expect(adapter.files.get(path)).toBe(raw);

      await storage.saveMetadata(before as SessionMetadata);

      expect(payloadOf(adapter, path)).toEqual(parsed);
      await expect(storage.loadMetadata(parsed.id)).resolves.toEqual(parsed);
    });

    it('keeps the fork source and the unknown provider field inside providerState', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      const loaded = await storage.loadMetadata(parsed.id);
      await storage.saveMetadata(loaded as SessionMetadata);

      const rewritten = payloadOf(adapter, path) as SessionMetadata;
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
      const adapter = createDurableInMemoryVaultAdapter({ [path]: foreign });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

      expect(await storage.loadMetadata(parsed.id)).toBeNull();
      expect(await storage.listMetadata()).toEqual([]);
    });

    it('round-trips through a list as well as a direct read', async () => {
      const adapter = createDurableInMemoryVaultAdapter({ [path]: raw });
      const storage = new SessionStorage(adapter, new VaultDurableStorage(adapter));

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

    async function loadAndSave(): Promise<Record<string, unknown>> {
      const adapter = createDurableInMemoryVaultAdapter({ [GRIMOIRE_SETTINGS_PATH]: raw });
      const storage = new GrimoireSettingsStorage(adapter);

      const loaded = await storage.load();
      await storage.save(loaded);

      return JSON.parse(adapter.files.get(GRIMOIRE_SETTINGS_PATH) as string) as Record<
        string,
        unknown
      >;
    }

    it('describes every registered provider', () => {
      const providerConfigs = parsed.providerConfigs as Record<string, unknown>;
      const registered = [
        ...readFileSync(resolve(process.cwd(), 'src/providers/index.ts'), 'utf8').matchAll(
          /ProviderWorkspaceRegistry\.register\('([^']+)'/g,
        ),
      ].map(match => match[1]);

      expect(Object.keys(providerConfigs).sort()).toEqual([...registered].sort());
    });

    it('drops provider-config keys outside the provider settings schema', async () => {
      const rewritten = await loadAndSave();
      const providerConfigs = rewritten.providerConfigs as Record<string, Record<string, unknown>>;

      // Characterized, and the most consequential finding of this suite:
      // `load()` rebuilds each provider config block from that provider's own
      // settings schema, so a key written by a newer build — or simply a key
      // this build does not model — does not survive. Settings are normalized
      // state, not a preserved document. Anything the migration needs to keep
      // across a flip must live in the schema or in session metadata, which is
      // the artifact that genuinely is byte-preserved.
      expect((parsed.providerConfigs as Record<string, Record<string, unknown>>).claude
        .providerOwnedSetting).toBe('kept verbatim');
      expect(providerConfigs.claude.providerOwnedSetting).toBeUndefined();
    });

    it('keeps every provider config block through a real load-save cycle', async () => {
      const rewritten = await loadAndSave();
      const before = parsed.providerConfigs as Record<string, unknown>;
      const after = rewritten.providerConfigs as Record<string, unknown>;

      // The blocks themselves survive even though their unknown keys do not.
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect((after.claude as Record<string, unknown>).enabled).toBe(true);
    });

    it('strips the declared transient provider field on save', async () => {
      const rewritten = await loadAndSave();
      const providerConfigs = rewritten.providerConfigs as Record<string, Record<string, unknown>>;

      // By design, not by accident: `projectSettingsSnapshot` is listed as a
      // transient Claude field and is removed when settings are written.
      expect(providerConfigs.claude.projectSettingsSnapshot).toBeUndefined();
    });

    it('rewrites tabBarPosition rather than preserving it', async () => {
      const rewritten = await loadAndSave();

      // Characterized, not endorsed, and the reason the exit-gate wording is
      // "session metadata is byte-preserved" rather than "settings are":
      // `normalizeTabBarPosition` returns 'header' unconditionally, so a stored
      // 'top' does not survive a load-save cycle. Settings are normalized state,
      // not a preserved document.
      expect(parsed.tabBarPosition).toBe('top');
      expect(rewritten.tabBarPosition).toBe('header');
    });
  });

  describe('persisted tab state', () => {
    const parsed = JSON.parse(readFixture('tab-state.json')) as AppTabManagerState;

    /** Drives the real validation path, which reads through `plugin.loadData()`. */
    async function loadThroughStorage(state: unknown): Promise<AppTabManagerState | null> {
      const plugin = {
        app: { vault: { adapter: {} } },
        loadData: async () => ({ tabManagerState: state }),
        saveData: jest.fn(),
      } as unknown as ConstructorParameters<typeof SharedStorageService>[0];

      const storage = new SharedStorageService(plugin);
      return (await storage.getTabManagerState());
    }

    it('normalizes rather than preserves: falsy and null fields are dropped', async () => {
      const loaded = await loadThroughStorage(parsed);

      // Characterized, not endorsed. `validateTabManagerState` rebuilds each
      // tab from scratch and only carries a field forward when it has the
      // expected type, so `orchestratorMode: false` and explicit nulls vanish.
      // The surviving values are equivalent in meaning, which is why this is
      // normalized state rather than a preserved document — the same reason the
      // exit-gate wording promises byte preservation for session metadata only.
      expect(loaded).toEqual({
        activeTabId: 'tab-1',
        openTabs: [
          {
            tabId: 'tab-1',
            conversationId: 'session-m0a-fixture',
            draftModel: 'gpt-5.3-codex',
            draftSettings: {
              reasoningEffort: 'high',
              providerOwnedDraftField: 'kept verbatim',
            },
          },
          {
            tabId: 'tab-2',
            conversationId: null,
          },
        ],
      });
    });

    it('keeps an orchestrator tab flagged when the flag is true', async () => {
      const withOrchestrator = {
        ...parsed,
        openTabs: [{ ...parsed.openTabs[0], orchestratorMode: true }],
      };

      const loaded = await loadThroughStorage(withOrchestrator);

      expect(loaded?.openTabs[0].orchestratorMode).toBe(true);
    });

    it('keeps provider-owned draft settings opaque', async () => {
      const loaded = await loadThroughStorage(parsed);
      const draftSettings = loaded?.openTabs[0].draftSettings as Record<string, unknown>;

      expect(draftSettings.providerOwnedDraftField).toBe('kept verbatim');
    });

    it('drops a tab without a string id instead of failing the whole state', async () => {
      const damaged = {
        ...parsed,
        openTabs: [...parsed.openTabs, { conversationId: 'orphan-without-a-tab-id' }],
      };

      const loaded = await loadThroughStorage(damaged);

      expect(loaded?.openTabs).toHaveLength(parsed.openTabs.length);
    });

    it('returns null when the persisted shape is not a tab state at all', async () => {
      expect(await loadThroughStorage({ openTabs: 'not an array' })).toBeNull();
    });
  });
});
