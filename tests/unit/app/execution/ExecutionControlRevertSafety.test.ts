import { createPassthroughDurableStorage } from '@test/helpers/passthroughDurableStorage';

import { GrimoireSettingsStorage } from '@/app/settings/GrimoireSettingsStorage';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { SessionStorage } from '@/core/bootstrap/SessionStorage';
import { GRIMOIRE_SETTINGS_PATH, GRIMOIRE_STORAGE_PATH, SESSIONS_PATH } from '@/core/bootstrap/StoragePaths';
import { EXECUTION_RUNS_PATH, SHUTDOWN_CHECKPOINTS_PATH } from '@/core/execution/ExecutionControlPaths';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/**
 * Revert safety for the first shipped flip.
 *
 * A release that ships a flip may be followed by a release that reverts it, and
 * the vault keeps the control records the flipped build wrote. The rule is that
 * those files are **inert** to the runtime path that does not know about them:
 * the reverted build must open the same vault, see the same conversations and
 * the same settings, and neither read nor trip over anything under
 * `.grimoire/control/`.
 *
 * Asserted against the real readers rather than by reasoning about paths,
 * because the failure this guards is a reader that recurses from the storage
 * root and swallows a directory it was never meant to see.
 */
describe('control records are inert to the runtime that does not own them', () => {
  /** A vault the flipped build has already written control records into. */
  function createVault(): { files: Map<string, string>; adapter: VaultFileAdapter } {
    const files = new Map<string, string>([
      [GRIMOIRE_SETTINGS_PATH, JSON.stringify({ permissionMode: 'full_access' })],
      [`${SESSIONS_PATH}/conversation-1.meta.json`, JSON.stringify({
        id: 'conversation-1',
        title: 'A conversation from before the revert',
        createdAt: 1,
        updatedAt: 2,
      })],
      [`${EXECUTION_RUNS_PATH}/run-${'a'.repeat(32)}.json`, JSON.stringify({
        schemaVersion: 1,
        recordId: `run-${'a'.repeat(32)}`,
        revision: 1,
        updatedAt: 3,
        payload: { state: 'succeeded' },
      })],
      [`${SHUTDOWN_CHECKPOINTS_PATH}/sd-${'b'.repeat(32)}.json`, JSON.stringify({
        schemaVersion: 1,
        recordId: `sd-${'b'.repeat(32)}`,
        revision: 1,
        updatedAt: 4,
        payload: {},
      })],
    ]);
    return { files, adapter: createAdapter(files) };
  }

  it('leaves conversations and settings exactly as the reverted build expects', async () => {
    const vault = createVault();

    const sessions = await new SessionStorage(vault.adapter, createPassthroughDurableStorage(vault.adapter)).listMetadata();
    const settings = await new GrimoireSettingsStorage(vault.adapter).load();

    expect(sessions.map(meta => meta.id)).toEqual(['conversation-1']);
    expect(settings.permissionMode).toBe('full_access');
  });

  it('never reads a control record while doing it', async () => {
    const vault = createVault();
    const reads: string[] = [];
    const watched = createAdapter(vault.files, path => reads.push(path));

    await new SessionStorage(watched, createPassthroughDurableStorage(watched)).listAllConversations();
    await new GrimoireSettingsStorage(watched).load();

    // The strong half. Returning the right conversations while also parsing
    // control records would still be a build coupled to files it must not know
    // about, and the coupling is what a revert breaks.
    expect(reads.filter(path => path.startsWith(`${GRIMOIRE_STORAGE_PATH}/control/`))).toEqual([]);
    expect(reads.length).toBeGreaterThan(0);
  });

  it('writes control records only under the control root', async () => {
    // The other direction: the flipped build must not put kernel bookkeeping
    // anywhere the reverted build reads.
    const vault = createVault();
    const storage = new VaultDurableStorage(vault.adapter);

    await storage.writeAtomic(`${EXECUTION_RUNS_PATH}/run-${'c'.repeat(32)}.json`, '{}');

    const written = [...vault.files.keys()].filter(path => !path.startsWith(`${GRIMOIRE_STORAGE_PATH}/control/`));
    expect(written.sort()).toEqual([
      GRIMOIRE_SETTINGS_PATH,
      `${SESSIONS_PATH}/conversation-1.meta.json`,
    ]);
  });
});

function createAdapter(
  files: Map<string, string>,
  onRead?: (path: string) => void,
): VaultFileAdapter {
  const adapter = {
    coordinationKey: files,
    async exists(path: string): Promise<boolean> {
      return files.has(path) || [...files.keys()].some(file => file.startsWith(`${path}/`));
    },
    async read(path: string): Promise<string> {
      onRead?.(path);
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`No such file: ${path}`);
      }
      return content;
    },
    async write(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      const content = files.get(oldPath);
      if (content !== undefined) {
        files.delete(oldPath);
        files.set(newPath, content);
      }
    },
    async delete(path: string): Promise<void> {
      files.delete(path);
    },
    async ensureFolder(): Promise<void> {},
    async listFiles(folder: string): Promise<string[]> {
      return [...files.keys()].filter(path => path.startsWith(`${folder}/`)
        && !path.slice(folder.length + 1).includes('/'));
    },
    async listFilesRecursive(folder: string): Promise<string[]> {
      return [...files.keys()].filter(path => path.startsWith(`${folder}/`));
    },
  };
  return adapter as unknown as VaultFileAdapter;
}
