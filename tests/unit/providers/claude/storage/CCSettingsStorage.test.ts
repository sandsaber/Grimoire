
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { CC_SETTINGS_PATH, CCSettingsStorage } from '@/providers/claude/storage/CCSettingsStorage';
import { createPermissionRule } from '@/providers/claude/types/settings';

const mockAdapter = {
    exists: jest.fn(),
    read: jest.fn(),
    write: jest.fn(),
} as unknown as jest.Mocked<VaultFileAdapter>;

describe('CCSettingsStorage', () => {
    let storage: CCSettingsStorage;

    beforeEach(() => {
        jest.clearAllMocks();
        storage = new CCSettingsStorage(mockAdapter);
    });

    describe('load', () => {
        it('should return defaults if file does not exist', async () => {
            mockAdapter.exists.mockResolvedValue(false);
            const result = await storage.load();
            expect(result.permissions).toBeDefined();
        });

        it('should load and parse allowed permissions', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: {
                    allow: ['tool1'],
                    deny: [],
                    ask: []
                }
            }));

            const result = await storage.load();
            expect(result.permissions?.allow).toContain('tool1');
        });

        it('should throw on read error', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockRejectedValue(new Error('Read failed'));

            await expect(storage.load()).rejects.toThrow('Read failed');
        });
    });

    describe('addAllowRule', () => {
        it('should add rule to allow list and save', async () => {
            // Setup initial state
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: [], deny: [], ask: [] }
            }));

            await storage.addAllowRule(createPermissionRule('new-rule'));

            const writeCall = mockAdapter.write.mock.calls[0];
            const writtenContent = JSON.parse(writeCall[1]);
            expect(writtenContent.permissions.allow).toContain('new-rule');
        });

        it('should not duplicate existing rule', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: ['existing'], deny: [], ask: [] }
            }));

            await storage.addAllowRule(createPermissionRule('existing'));

            expect(mockAdapter.write).not.toHaveBeenCalled();
        });
    });

    describe('removeRule', () => {
        it('should remove rule from all lists', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: {
                    allow: ['rule1'],
                    deny: ['rule1'],
                    ask: ['rule1']
                }
            }));

            await storage.removeRule(createPermissionRule('rule1'));

            expect(mockAdapter.write).toHaveBeenCalledWith(
                CC_SETTINGS_PATH,
                expect.stringContaining('"allow": []')
            );
        });
    });

    describe('addDenyRule', () => {
        it('should add rule to deny list and save', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: [], deny: [], ask: [] }
            }));

            await storage.addDenyRule(createPermissionRule('dangerous-rule'));

            const writeCall = mockAdapter.write.mock.calls[0];
            const writtenContent = JSON.parse(writeCall[1]);
            expect(writtenContent.permissions.deny).toContain('dangerous-rule');
        });

        it('should not duplicate existing deny rule', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: [], deny: ['existing'], ask: [] }
            }));

            await storage.addDenyRule(createPermissionRule('existing'));

            expect(mockAdapter.write).not.toHaveBeenCalled();
        });
    });

    describe('addAskRule', () => {
        it('should add rule to ask list and save', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: [], deny: [], ask: [] }
            }));

            await storage.addAskRule(createPermissionRule('ask-rule'));

            const writeCall = mockAdapter.write.mock.calls[0];
            const writtenContent = JSON.parse(writeCall[1]);
            expect(writtenContent.permissions.ask).toContain('ask-rule');
        });

        it('should not duplicate existing ask rule', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: [], deny: [], ask: ['existing'] }
            }));

            await storage.addAskRule(createPermissionRule('existing'));

            expect(mockAdapter.write).not.toHaveBeenCalled();
        });
    });

    describe('save', () => {
        it('refuses to write over a file it could not read back', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue('invalid json{{{');

            // The merge is a read-modify-write, and everything this build does
            // not model — hooks, env, model, statusLine — survives only by
            // being read back. It could not be, so nothing is written: writing
            // would rewrite the user's file, and Claude Code's, down to two
            // keys on one "Always allow" click.
            await expect(storage.save({
                permissions: { allow: [], deny: [], ask: [] }
            })).rejects.toThrow('not valid JSON');

            expect(mockAdapter.write).not.toHaveBeenCalled();
        });

        it('still answers a permission read when the file cannot be parsed', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue('invalid json{{{');

            // The read degrades and the write refuses, which is the asymmetry:
            // one stray character must not break the approval surface, and it
            // must not be allowed to destroy the file either.
            await expect(storage.getPermissions()).resolves.toEqual(
                expect.objectContaining({ allow: expect.any(Array) }),
            );
        });

        it('should not write enabledPlugins from settings argument', async () => {
            mockAdapter.exists.mockResolvedValue(false);

            await storage.save({
                permissions: { allow: [], deny: [], ask: [] },
                enabledPlugins: { 'my-plugin': true },
            });

            const writeCall = mockAdapter.write.mock.calls[0];
            const writtenContent = JSON.parse(writeCall[1]);
            expect(writtenContent.enabledPlugins).toBeUndefined();
        });
    });

    describe('load edge cases', () => {
        it('should normalize invalid permissions to defaults', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: 'not-an-object',
            }));

            const result = await storage.load();
            expect(result.permissions?.allow).toEqual([]);
            expect(result.permissions?.deny).toEqual([]);
            expect(result.permissions?.ask).toEqual([]);
        });

        it('should filter non-string values from permission arrays', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: {
                    allow: ['valid', 123, null, 'also-valid'],
                    deny: [true, 'deny-rule'],
                    ask: [],
                },
            }));

            const result = await storage.load();
            expect(result.permissions?.allow).toEqual(['valid', 'also-valid']);
            expect(result.permissions?.deny).toEqual(['deny-rule']);
        });

        it('should preserve additionalDirectories and defaultMode', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: {
                    allow: [],
                    deny: [],
                    ask: [],
                    defaultMode: 'bypassPermissions',
                    additionalDirectories: ['/extra/dir'],
                },
            }));

            const result = await storage.load();
            expect(result.permissions?.defaultMode).toBe('bypassPermissions');
            expect(result.permissions?.additionalDirectories).toEqual(['/extra/dir']);
        });
    });

    describe('isLegacyPermissionsFormat edge cases', () => {
        it('should return false for null data', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: null,
            }));

            const result = await storage.load();
            // null permissions normalized to defaults
            expect(result.permissions?.allow).toEqual([]);
        });

        it('should return false for non-object permissions', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: 42,
            }));

            const result = await storage.load();
            expect(result.permissions?.allow).toEqual([]);
            expect(result.permissions?.deny).toEqual([]);
        });

        it('should return false for empty array permissions', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: [],
            }));

            const result = await storage.load();
            // Empty array is legacy format but length === 0, so falls through
            expect(result.permissions?.allow).toEqual([]);
        });
    });

    describe('normalizePermissions edge cases', () => {
        it('should handle non-array allow/deny/ask values', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: {
                    allow: 'not-an-array',
                    deny: 123,
                    ask: null,
                },
            }));

            const result = await storage.load();
            expect(result.permissions?.allow).toEqual([]);
            expect(result.permissions?.deny).toEqual([]);
            expect(result.permissions?.ask).toEqual([]);
        });
    });

    describe('save edge cases', () => {
        it('should use default permissions when settings.permissions is undefined', async () => {
            mockAdapter.exists.mockResolvedValue(false);

            await storage.save({});

            const writeCall = mockAdapter.write.mock.calls[0];
            const writtenContent = JSON.parse(writeCall[1]);
            expect(writtenContent.permissions).toEqual({
                allow: [],
                deny: [],
                ask: [],
            });
        });
    });

    describe('getPermissions edge cases', () => {
        it('should return default permissions when settings has no permissions field', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({}));

            const result = await storage.getPermissions();
            expect(result.allow).toEqual([]);
            expect(result.deny).toEqual([]);
            expect(result.ask).toEqual([]);
        });
    });

    describe('enabledPlugins preservation', () => {
        it('does not expose plugin enablement writer helpers', () => {
            expect('setPluginEnabled' in storage).toBe(false);
            expect('getExplicitlyEnabledPluginIds' in storage).toBe(false);
            expect('isPluginDisabled' in storage).toBe(false);
        });

        it('should preserve enabledPlugins when saving other settings', async () => {
            mockAdapter.exists.mockResolvedValue(true);
            mockAdapter.read.mockResolvedValue(JSON.stringify({
                permissions: { allow: ['rule1'], deny: [], ask: [] },
                enabledPlugins: { 'plugin-a': false }
            }));

            // Add a permission rule (different operation)
            await storage.addAllowRule(createPermissionRule('new-rule'));

            const writeCall = mockAdapter.write.mock.calls[0];
            const writtenContent = JSON.parse(writeCall[1]);
            // enabledPlugins should be preserved from existing file
            expect(writtenContent.enabledPlugins).toEqual({ 'plugin-a': false });
        });
    });
  it('does not lose one save to another that overlapped it', async () => {
    // The merge is a read-modify-write, and nothing serialized it: two saves
    // overlapping meant the second read the file before the first wrote it, and
    // whichever finished last silently won — dropping the other's permissions.
    const files = new Map<string, string>();
    const adapter = createSlowAdapter(files);
    const storage = new CCSettingsStorage(adapter);

    await Promise.all([
      storage.save({ permissions: { allow: ['Read(a)'], deny: [], ask: [] } } as never),
      storage.save({ permissions: { allow: ['Read(b)'], deny: [], ask: [] } } as never),
    ]);

    // The second write wins, which is what "last one wins" should mean — but it
    // read the first one's file, so nothing was lost on the way.
    const saved = JSON.parse(files.get('.claude/settings.json') as string);
    expect(saved.permissions.allow).toEqual(['Read(b)']);
    expect(files.has('.claude/settings.json.grimoire-pending')).toBe(false);
  });

  it('leaves the previous file whole when the replacement cannot land', async () => {
    const files = new Map<string, string>([['.claude/settings.json', '{"permissions":{"allow":["Read(old)"]}}']]);
    const adapter = createSlowAdapter(files);
    adapter.rename = jest.fn(async () => {
      throw new Error('rename failed');
    });
    const storage = new CCSettingsStorage(adapter);

    await expect(storage.save({ permissions: { allow: ['Read(new)'], deny: [], ask: [] } } as never))
      .rejects.toThrow('rename failed');

    // Whole, and no staged copy left beside it for the next reader — Claude
    // Code reads this directory too.
    expect(JSON.parse(files.get('.claude/settings.json') as string).permissions.allow)
      .toEqual(['Read(old)']);
    expect(files.has('.claude/settings.json.grimoire-pending')).toBe(false);
  });

});

/** An adapter whose reads and writes take a turn, so overlaps are real. */
function createSlowAdapter(files: Map<string, string>): any {
  const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));
  return {
    exists: async (path: string) => {
      await yieldTurn();
      return files.has(path);
    },
    read: async (path: string) => {
      await yieldTurn();
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    write: async (path: string, content: string) => {
      await yieldTurn();
      files.set(path, content);
    },
    rename: jest.fn(async (from: string, to: string) => {
      await yieldTurn();
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, content);
    }),
    delete: async (path: string) => {
      files.delete(path);
    },
  };
}
