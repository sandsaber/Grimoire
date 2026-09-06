import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { SlashCommand } from '@/core/types';
import { ClaudeCommandCatalog } from '@/providers/claude/commands/ClaudeCommandCatalog';
import type { RuntimeCommandCacheRecord } from '@/providers/claude/commands/ClaudeRuntimeCommandCacheStore';
import { SkillStorage } from '@/providers/claude/storage/SkillStorage';
import { SlashCommandStorage } from '@/providers/claude/storage/SlashCommandStorage';

function createMockAdapter(files: Record<string, string> = {}): VaultFileAdapter {
  return {
    exists: jest.fn(async (path: string) => path in files || Object.keys(files).some(k => k.startsWith(path + '/'))),
    read: jest.fn(async (path: string) => {
      if (!(path in files)) throw new Error(`File not found: ${path}`);
      return files[path];
    }),
    write: jest.fn(),
    delete: jest.fn(),
    listFolders: jest.fn(async (folder: string) => {
      const prefix = folder.endsWith('/') ? folder : folder + '/';
      const folders = new Set<string>();
      for (const path of Object.keys(files)) {
        if (path.startsWith(prefix)) {
          const rest = path.slice(prefix.length);
          const firstSlash = rest.indexOf('/');
          if (firstSlash >= 0) {
            folders.add(prefix + rest.slice(0, firstSlash));
          }
        }
      }
      return Array.from(folders);
    }),
    listFiles: jest.fn(),
    listFilesRecursive: jest.fn(async (folder: string) => {
      const prefix = folder.endsWith('/') ? folder : folder + '/';
      return Object.keys(files).filter(k => k.startsWith(prefix));
    }),
    ensureFolder: jest.fn(),
    rename: jest.fn(),
    append: jest.fn(),
    stat: jest.fn(),
    deleteFolder: jest.fn(),
  } as unknown as VaultFileAdapter;
}

function createCacheStore(record: RuntimeCommandCacheRecord | null, fingerprint = 'fp-current') {
  let current = record;
  return {
    clear: jest.fn(async () => { current = null; }),
    currentFingerprint: jest.fn(() => fingerprint),
    read: jest.fn(() => current),
    write: jest.fn(async (value: RuntimeCommandCacheRecord) => { current = value; }),
  };
}

const CACHED_COMMANDS: SlashCommand[] = [
  { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
];

describe('ClaudeCommandCatalog', () => {
  // Restored here rather than at the end of each body: a failing assertion
  // above the restore would leave Date.now pinned for every later test in this
  // file and turn one regression into a cascade.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listDropdownEntries', () => {
    it('returns SDK runtime commands as ProviderCommandEntry', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      const sdkCommands: SlashCommand[] = [
        { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
        { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
      ];
      catalog.setRuntimeCommands(sdkCommands);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries).toHaveLength(2);

      const commitEntry = entries.find(e => e.name === 'commit');
      expect(commitEntry).toBeDefined();
      expect(commitEntry!.providerId).toBe('claude');
      expect(commitEntry!.scope).toBe('runtime');
      expect(commitEntry!.source).toBe('sdk');
      expect(commitEntry!.isEditable).toBe(false);
      expect(commitEntry!.isDeletable).toBe(false);
      expect(commitEntry!.displayPrefix).toBe('/');
      expect(commitEntry!.insertPrefix).toBe('/');
    });

    it('returns empty when no runtime commands and no probe', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries).toHaveLength(0);
    });

    it('filters out built-in hidden SDK commands', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      catalog.setRuntimeCommands([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
        { id: 'sdk:init', name: 'init', description: 'Init', content: '', source: 'sdk' },
        { id: 'sdk:debug', name: 'debug', description: 'Debug', content: '', source: 'sdk' },
        { id: 'sdk:cost', name: 'cost', description: 'Cost', content: '', source: 'sdk' },
        { id: 'sdk:review', name: 'review', description: 'Review', content: '', source: 'sdk' },
      ]);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      const names = entries.map(e => e.name);
      expect(names).toEqual(['commit', 'review']);
      expect(names).not.toContain('init');
      expect(names).not.toContain('debug');
      expect(names).not.toContain('cost');
    });

    it('probes SDK on cold start when cache is empty', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([
        { id: 'sdk:commit', name: 'commit', description: 'Create git commit', content: '', source: 'sdk' },
      ]);
      const catalog = new ClaudeCommandCatalog(commands, skills, probe);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('commit');
      expect(entries[0].scope).toBe('runtime');
    });

    it('falls back to vault commands and skills when SDK discovery is empty', async () => {
      const adapter = createMockAdapter({
        '.claude/commands/review.md': `---
description: Review code
---
Review this code`,
        '.claude/skills/deploy/SKILL.md': `---
description: Deploy app
---
Deploy the app`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([]);
      const catalog = new ClaudeCommandCatalog(commands, skills, probe);

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(entries).toHaveLength(2);
      expect(entries.map(entry => entry.name).sort()).toEqual(['deploy', 'review']);
      expect(entries.every(entry => entry.scope === 'vault')).toBe(true);
    });

    it('does not probe when runtime commands are cached', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([]);
      const catalog = new ClaudeCommandCatalog(commands, skills, probe);

      catalog.setRuntimeCommands([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);

      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent probe calls', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const probe = jest.fn().mockResolvedValue([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);
      const catalog = new ClaudeCommandCatalog(commands, skills, probe);

      const [a, b] = await Promise.all([
        catalog.listDropdownEntries({ includeBuiltIns: false }),
        catalog.listDropdownEntries({ includeBuiltIns: false }),
      ]);

      expect(probe).toHaveBeenCalledTimes(1);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    it('does not overwrite runtime commands with stale probe results', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);

      let resolveProbe: (v: SlashCommand[]) => void;
      const probe = jest.fn().mockReturnValue(new Promise<SlashCommand[]>((r) => { resolveProbe = r; }));
      const catalog = new ClaudeCommandCatalog(commands, skills, probe);

      // Start probe (it will hang)
      const entriesPromise = catalog.listDropdownEntries({ includeBuiltIns: false });

      // Runtime provides fresh data while probe is in-flight
      catalog.setRuntimeCommands([
        { id: 'sdk:review', name: 'review', description: 'Review', content: '', source: 'sdk' },
      ]);

      // Probe returns stale data
      resolveProbe!([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);

      const entries = await entriesPromise;

      // Runtime data wins — probe result is discarded
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('review');
    });
  });

  describe('listVaultEntries', () => {
    it('returns only vault-owned commands and skills', async () => {
      const adapter = createMockAdapter({
        '.claude/commands/review.md': `---
description: Review code
---
Review this code`,
        '.claude/skills/deploy/SKILL.md': `---
description: Deploy
---
Deploy the app`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      // Set SDK commands to verify they're excluded from vault entries
      catalog.setRuntimeCommands([
        { id: 'sdk:commit', name: 'commit', description: 'Commit', content: '', source: 'sdk' },
      ]);

      const entries = await catalog.listVaultEntries();

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.scope === 'vault')).toBe(true);
      expect(entries.find(e => e.name === 'commit')).toBeUndefined();
    });
  });

  describe('saveVaultEntry', () => {
    it('saves a command entry via command storage', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      await catalog.saveVaultEntry({
        id: 'cmd-review',
        providerId: 'claude',
        kind: 'command',
        name: 'review',
        description: 'Review code',
        allowedTools: ['Read', 'Edit'],
        model: 'claude-sonnet-4-5',
        content: 'Review this code',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.write).toHaveBeenCalledWith(
        '.claude/commands/review.md',
        expect.stringContaining('Review this code'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.claude/commands/review.md',
        expect.stringContaining('allowed-tools:'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.claude/commands/review.md',
        expect.stringContaining('model: claude-sonnet-4-5'),
      );
    });

    it('saves a skill entry via skill storage', async () => {
      const adapter = createMockAdapter({});
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      await catalog.saveVaultEntry({
        id: 'skill-deploy',
        providerId: 'claude',
        kind: 'skill',
        name: 'deploy',
        description: 'Deploy app',
        content: 'Deploy the app',
        disableModelInvocation: true,
        userInvocable: false,
        context: 'fork',
        agent: 'deployer',
        hooks: { preToolUse: ['check'] },
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.ensureFolder).toHaveBeenCalledWith('.claude/skills/deploy');
      expect(adapter.write).toHaveBeenCalledWith(
        '.claude/skills/deploy/SKILL.md',
        expect.stringContaining('Deploy the app'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.claude/skills/deploy/SKILL.md',
        expect.stringContaining('disable-model-invocation: true'),
      );
      expect(adapter.write).toHaveBeenCalledWith(
        '.claude/skills/deploy/SKILL.md',
        expect.stringContaining('user-invocable: false'),
      );
    });
  });

  describe('deleteVaultEntry', () => {
    it('deletes a command entry', async () => {
      const adapter = createMockAdapter({
        '.claude/commands/review.md': `---
description: Review
---
Review`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      await catalog.deleteVaultEntry({
        id: 'cmd-review',
        providerId: 'claude',
        kind: 'command',
        name: 'review',
        description: 'Review',
        content: 'Review',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.delete).toHaveBeenCalled();
    });

    it('deletes a skill entry', async () => {
      const adapter = createMockAdapter({
        '.claude/skills/deploy/SKILL.md': `---
description: Deploy
---
Deploy`,
      });
      const commands = new SlashCommandStorage(adapter);
      const skills = new SkillStorage(adapter);
      const catalog = new ClaudeCommandCatalog(commands, skills);

      await catalog.deleteVaultEntry({
        id: 'skill-deploy',
        providerId: 'claude',
        kind: 'skill',
        name: 'deploy',
        description: 'Deploy',
        content: 'Deploy',
        scope: 'vault',
        source: 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
      });

      expect(adapter.delete).toHaveBeenCalledWith('.claude/skills/deploy/SKILL.md');
    });
  });

  // `getDropdownConfig` was a method on this catalog and is a declaration on
  // the provider module now — `ProviderModule`'s own comment says why. The
  // module's tests cover it; a catalog test asserting it would be asserting a
  // method that no longer exists.
  describe('runtime command cache', () => {
    it('serves a cached list without probing when the fingerprint matches', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const probe = jest.fn(async () => CACHED_COMMANDS);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).not.toHaveBeenCalled();
      expect(entries.map(entry => entry.name)).toEqual(['commit']);
    });

    it('probes when the cached fingerprint no longer matches', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-stale' });
      const probe = jest.fn(async (): Promise<SlashCommand[]> => [
        { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
      ]);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(entries.map(entry => entry.name)).toEqual(['review']);
      expect(cache.write).toHaveBeenCalledWith({
        commands: [
          { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
        ],
        fingerprint: 'fp-current',
      });
    });

    it('probes exactly once on a cold start with no cache', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const probe = jest.fn(async () => CACHED_COMMANDS);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('keeps working when the cache write is rejected', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      cache.write.mockRejectedValue(new Error('disk full'));
      const probe = jest.fn(async () => CACHED_COMMANDS);
      const recordEvent = jest.fn();
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache, recordEvent },
      );

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries.map(entry => entry.name)).toEqual(['commit']);
      expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
        event: 'commandCatalog.cache.writeFailed',
        level: 'warn',
      }));
    });

    it('behaves exactly as before when no deps are supplied', async () => {
      const adapter = createMockAdapter({});
      const probe = jest.fn(async () => CACHED_COMMANDS);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
      );

      const first = await catalog.listDropdownEntries({ includeBuiltIns: false });
      const second = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(first.map(entry => entry.name)).toEqual(['commit']);
      expect(second.map(entry => entry.name)).toEqual(['commit']);
    });

    it('falls back to today behaviour when the fingerprint cannot be computed', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      cache.currentFingerprint.mockImplementation(() => { throw new Error('binary is gone'); });
      const probe = jest.fn(async (): Promise<SlashCommand[]> => [
        { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
      ]);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(entries.map(entry => entry.name)).toEqual(['review']);
    });

    it('still paces empty probes when the fingerprint cannot be computed', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      cache.currentFingerprint.mockImplementation(() => { throw new Error('binary is gone'); });
      const probe = jest.fn(async (): Promise<SlashCommand[]> => []);
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      // Without a key to record under, nothing would ever be skipped - and the
      // dropdown reopens on every keystroke, each one a billed session.
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('does not file a list under a configuration that changed while it was discovered', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const probe = jest.fn(async (): Promise<SlashCommand[]> => [
        { id: 'sdk:review', name: 'review', content: '', source: 'sdk' },
      ]);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );
      // The user edits the environment, or a CLI upgrade lands, while the
      // probe is in flight.
      cache.currentFingerprint
        .mockReturnValueOnce('fp-before')
        .mockReturnValue('fp-after');

      await catalog.listDropdownEntries({ includeBuiltIns: false });

      // Filing it under 'fp-after' would serve the previous configuration's
      // commands forever, since the record never expires.
      expect(cache.write).not.toHaveBeenCalled();
    });
    it('adds vault skills that the cached list has never seen', async () => {
      const adapter = createMockAdapter({
        '.claude/skills/fresh-skill/SKILL.md': `---
description: Made today
---
Body`,
      });
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const probe = jest.fn(async () => CACHED_COMMANDS);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).not.toHaveBeenCalled();
      expect(entries.map(entry => entry.name).sort()).toEqual(['commit', 'fresh-skill']);
    });

    it('lets the vault version win a name collision with the cached list', async () => {
      const adapter = createMockAdapter({
        '.claude/commands/commit.md': `---
description: Vault version
---
Vault body`,
      });
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        jest.fn(async () => CACHED_COMMANDS),
        { cache },
      );

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('commit');
      expect(entries[0].isEditable).toBe(true);
      expect(entries[0].scope).toBe('vault');
    });

    it('does not merge a list that came from a live session', async () => {
      const adapter = createMockAdapter({
        '.claude/skills/fresh-skill/SKILL.md': `---
description: Made today
---
Body`,
      });
      const cache = createCacheStore(null);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        jest.fn(async () => CACHED_COMMANDS),
        { cache },
      );

      catalog.setRuntimeCommands(CACHED_COMMANDS);
      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(entries.map(entry => entry.name)).toEqual(['commit']);
    });
    it('persists a list handed over by a live session', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        jest.fn(),
        { cache },
      );

      catalog.setRuntimeCommands(CACHED_COMMANDS);
      await Promise.resolve();

      expect(cache.write).toHaveBeenCalledWith({
        commands: CACHED_COMMANDS,
        fingerprint: 'fp-current',
      });
    });

    it('does not drop the cache when the runtime list is reset to empty', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const probe = jest.fn(async () => CACHED_COMMANDS);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      // TabManager clears the list on a blank tab that skips warmup.
      catalog.setRuntimeCommands([]);
      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(cache.clear).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
      expect(entries.map(entry => entry.name)).toEqual(['commit']);
    });
    it('does not repeat an empty probe within the retry window', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const probe = jest.fn(async (): Promise<SlashCommand[]> => []);
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 9 * 60 * 1000);
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('probes again once the retry window has passed', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const probe = jest.fn(async (): Promise<SlashCommand[]> => []);
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(2);
    });

    it('throttles after a probe that threw, not only after an empty one', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const probe = jest.fn(async (): Promise<SlashCommand[]> => { throw new Error('no cli'); });
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      expect(probe).toHaveBeenCalledTimes(1);
    });
    it('clears the cache and forces exactly one probe on refresh', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const probe = jest.fn(async (): Promise<SlashCommand[]> => [
        { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
      ]);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.refresh();

      expect(probe).toHaveBeenCalledTimes(1);
      // Replaced by discovery rather than destroyed first, so the persisted
      // list is the new one and never passes through empty.
      expect(cache.clear).not.toHaveBeenCalled();
      expect(cache.write).toHaveBeenCalledWith({
        commands: [
          { id: 'sdk:review', name: 'review', description: 'Review code', content: '', source: 'sdk' },
        ],
        fingerprint: 'fp-current',
      });
      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(entries.map(entry => entry.name)).toEqual(['review']);
    });

    it('keeps the working list when a refresh discovers nothing', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const probe = jest.fn(async (): Promise<SlashCommand[]> => []);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );
      await catalog.listDropdownEntries({ includeBuiltIns: false });

      await catalog.refresh();

      // A CLI that is momentarily broken or logged out must not cost the user
      // the list they had, leave the dropdown on vault entries only, and then
      // throttle every retry for ten minutes.
      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
      expect(entries.map(entry => entry.name)).toEqual(['commit']);
      expect(cache.clear).not.toHaveBeenCalled();
    });

    it('keeps a command and a skill that share a name apart', async () => {
      const adapter = createMockAdapter({
        '.claude/commands/deploy.md': '---\ndescription: Deploy it\n---\nRun the deploy.',
        '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploy skill\n---\nSteps.',
      });
      const cache = createCacheStore({ commands: CACHED_COMMANDS, fingerprint: 'fp-current' });
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        undefined,
        { cache },
      );

      const merged = await catalog.listDropdownEntries({ includeBuiltIns: false });
      const vaultOnly = await catalog.listVaultEntries();

      // Both files are real and separately editable, so the merged view must
      // not drop one of them.
      expect(merged.filter(entry => entry.name === 'deploy')).toHaveLength(
        vaultOnly.filter(entry => entry.name === 'deploy').length,
      );
    });

    it('refreshes through a throttled empty window', async () => {
      const adapter = createMockAdapter({});
      const cache = createCacheStore(null);
      const probe = jest.fn(async (): Promise<SlashCommand[]> => []);
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const catalog = new ClaudeCommandCatalog(
        new SlashCommandStorage(adapter),
        new SkillStorage(adapter),
        probe,
        { cache },
      );

      await catalog.listDropdownEntries({ includeBuiltIns: false });
      await catalog.refresh();

      expect(probe).toHaveBeenCalledTimes(2);
    });
  });
});
