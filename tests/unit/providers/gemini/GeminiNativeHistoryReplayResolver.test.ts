import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { GeminiNativeHistoryReplayResolver } from '@/providers/gemini/execution/GeminiNativeHistoryReplayResolver';

const SESSION_ID = '12345678-1234-4234-8234-123456789abc';
const FIXTURE_PATH = path.resolve(
  'tests/fixtures/provider-traces/gemini-native-history.jsonl',
);
const LEGACY_FIXTURE_PATH = path.resolve(
  'tests/fixtures/provider-traces/gemini-native-history-legacy.json',
);
const MUTATIONS_FIXTURE_PATH = path.resolve(
  'tests/fixtures/provider-traces/gemini-native-history-mutations.jsonl',
);

describe('GeminiNativeHistoryReplayResolver', () => {
  let testRoot: string;
  let geminiDir: string;
  let cwd: string;
  let chatsDir: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(tmpdir(), 'grimoire-gemini-history-'));
    geminiDir = path.join(testRoot, '.gemini');
    cwd = path.join(testRoot, 'vault');
    chatsDir = path.join(geminiDir, 'tmp', 'vault', 'chats');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.writeFile(
      path.join(geminiDir, 'projects.json'),
      JSON.stringify({ projects: { [normalizeProjectPath(cwd)]: 'vault' } }),
      'utf8',
    );
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('matches the installed Gemini native streamHistory emission rule', async () => {
    const fixture = await fs.readFile(FIXTURE_PATH, 'utf8');
    await writeSession(fixture);
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(6);
  });

  it('fails closed when the native session is absent', async () => {
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).rejects.toThrow('inventory is unavailable');
  });

  it('resolves a project from its temporary-storage ownership marker', async () => {
    await fs.rm(path.join(geminiDir, 'projects.json'));
    await fs.writeFile(path.join(geminiDir, 'tmp', 'vault', '.project_root'), cwd, 'utf8');
    await writeSession(await fs.readFile(FIXTURE_PATH, 'utf8'));
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(6);
  });

  it('resolves a project from its history ownership marker', async () => {
    await fs.rm(path.join(geminiDir, 'projects.json'));
    const historyProject = path.join(geminiDir, 'history', 'vault');
    await fs.mkdir(historyProject, { recursive: true });
    await fs.writeFile(path.join(historyProject, '.project_root'), cwd, 'utf8');
    await writeSession(await fs.readFile(FIXTURE_PATH, 'utf8'));
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(6);
  });

  it('reads the legacy hash layout that the current CLI migrates on initialization', async () => {
    await fs.rm(path.join(geminiDir, 'projects.json'));
    await fs.rm(path.join(geminiDir, 'tmp', 'vault'), { recursive: true });
    const legacyChats = path.join(geminiDir, 'tmp', legacyProjectId(), 'chats');
    await fs.mkdir(legacyChats, { recursive: true });
    await writeSession(await fs.readFile(FIXTURE_PATH, 'utf8'), legacyChats);
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(6);
  });

  it('keeps the ownership-selected current layout ahead of a newer legacy duplicate', async () => {
    await writeSession(await fs.readFile(FIXTURE_PATH, 'utf8'));
    const legacyChats = path.join(geminiDir, 'tmp', legacyProjectId(), 'chats');
    await fs.mkdir(legacyChats, { recursive: true });
    await writeSession(await fs.readFile(LEGACY_FIXTURE_PATH, 'utf8'), legacyChats, '.json');
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(6);
  });

  it('mirrors rewind and metadata-reset semantics before counting replay', async () => {
    await writeSession(await fs.readFile(MUTATIONS_FIXTURE_PATH, 'utf8'));
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(3);
  });

  it('counts the legacy JSON conversation schema', async () => {
    await writeSession(await fs.readFile(LEGACY_FIXTURE_PATH, 'utf8'), chatsDir, '.json');
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).resolves.toBe(3);
  });

  it('fails closed on malformed native session metadata', async () => {
    await writeSession('{"sessionId":"12345678-1234-4234-8234-123456789abc"}\n');
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request())).rejects.toThrow('is malformed');
  });

  it('rejects native session files beyond the configured byte bound', async () => {
    const fixture = await fs.readFile(FIXTURE_PATH, 'utf8');
    await writeSession(fixture);
    const resolver = new GeminiNativeHistoryReplayResolver({
      globalGeminiDir: geminiDir,
      maxSessionBytes: 64,
    });

    await expect(resolver.count(request())).rejects.toThrow('exceeds its bound');
  });

  it('reads only limit plus one bytes when a file grows after descriptor stat', async () => {
    await writeSession('x');
    const sessionPath = path.join(
      chatsDir,
      'session-2026-08-12T10-00-00-12345678.jsonl',
    );
    const originalOpen = fs.open.bind(fs);
    const readLengths: number[] = [];
    const growingHandle = {
      stat: async () => ({ isFile: () => true, size: 1 }),
      read: async (buffer: Buffer, offset: number, length: number) => {
        readLengths.push(length);
        buffer.fill('x', offset, offset + length);
        return { buffer, bytesRead: length };
      },
      close: async () => undefined,
    } as unknown as FileHandle;
    const open = jest.spyOn(fs, 'open').mockImplementation(async (filePath, flags, mode) => {
      if (path.resolve(filePath.toString()) === path.resolve(sessionPath)) return growingHandle;
      return originalOpen(filePath, flags, mode);
    });
    try {
      const resolver = new GeminiNativeHistoryReplayResolver({
        globalGeminiDir: geminiDir,
        maxSessionBytes: 64,
      });

      await expect(resolver.count(request())).rejects.toThrow('exceeds its bound');
      expect(readLengths).toEqual([65]);
    } finally {
      open.mockRestore();
    }
  });

  it('stops directory traversal at the configured entry bound', async () => {
    await fs.rm(path.join(geminiDir, 'projects.json'));
    await fs.mkdir(path.join(geminiDir, 'tmp', 'second-project'));
    await fs.mkdir(path.join(geminiDir, 'tmp', 'third-project'));
    const resolver = new GeminiNativeHistoryReplayResolver({
      globalGeminiDir: geminiDir,
      maxProjectEntries: 2,
    });

    await expect(resolver.count(request())).rejects.toThrow('directory inventory exceeds its bound');
  });

  it('honors cancellation before native history access', async () => {
    const abort = new AbortController();
    abort.abort(new Error('provider stopped'));
    const resolver = new GeminiNativeHistoryReplayResolver({ globalGeminiDir: geminiDir });

    await expect(resolver.count(request(abort.signal))).rejects.toThrow('provider stopped');
  });

  async function writeSession(
    content: string,
    targetDirectory = chatsDir,
    extension = '.jsonl',
  ): Promise<void> {
    await fs.writeFile(
      path.join(targetDirectory, `session-2026-08-12T10-00-00-12345678${extension}`),
      content,
      'utf8',
    );
  }

  function legacyProjectId(): string {
    return createHash('sha256').update(path.resolve(cwd)).digest('hex');
  }

  function request(signal = new AbortController().signal) {
    return { sessionId: SESSION_ID, cwd, signal };
  }
});

function normalizeProjectPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
