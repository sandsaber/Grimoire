import '@/providers';

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { StreamChunk } from '@/core/types';
import { setLocale } from '@/i18n/i18n';
import {
  AntigravityChatRuntime,
  buildAntigravityPrintArgs,
} from '@/providers/antigravity/runtime/AntigravityChatRuntime';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const mockedSpawn = spawn as jest.Mock;

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  const settings: Record<string, unknown> = { permissionMode: 'full_access' };
  updateAntigravityProviderSettings(settings, { enabled: true });

  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grimoire-antigravity-test-vault',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/agy'),
    manifest: { version: '0.0.0-test' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings,
    ...overrides,
  };
}

async function collect(generator: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

function createMockChildProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = null;
  proc.kill = jest.fn();
  proc.pid = 1234;
  proc.exitCode = null;
  proc.signalCode = null;
  return proc;
}

function getSpawnedAgyArgs(): string[] {
  const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
  if (args[0] === '-lc' && args[1] === 'exec "$0" "$@"') {
    return args.slice(3);
  }
  return args;
}

describe('AntigravityChatRuntime', () => {
  afterEach(() => {
    setLocale('en');
    jest.restoreAllMocks();
    mockedSpawn.mockReset();
  });

  it('does not start when the provider is disabled', async () => {
    const settings: Record<string, unknown> = {};
    updateAntigravityProviderSettings(settings, { enabled: false });
    const runtime = new AntigravityChatRuntime(createMockPlugin({ settings }));

    await expect(runtime.ensureReady()).resolves.toBe(false);
    expect(runtime.isReady()).toBe(false);
  });

  it('localizes the disabled-provider query error', async () => {
    setLocale('ru');
    const settings: Record<string, unknown> = {};
    updateAntigravityProviderSettings(settings, { enabled: false });
    const runtime = new AntigravityChatRuntime(createMockPlugin({ settings }));

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(chunks).toContainEqual({
      type: 'error',
      content: 'Antigravity отключён. Включите его в настройках провайдера.',
    });
  });

  it('runs agy in print mode and streams stdout as a chat response', async () => {
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('Hi from Antigravity\n');

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect((runtime as any).runPrint).toHaveBeenCalledWith(expect.objectContaining({
      command: '/usr/local/bin/agy',
      prompt: 'Hello',
    }));
    expect(chunks).toContainEqual({ content: 'Hi from Antigravity', type: 'text' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('uses the explicit query model instead of the saved provider default', async () => {
    const plugin = createMockPlugin();
    plugin.settings.savedProviderModel = { antigravity: 'antigravity:gemini-2.5-pro' };
    const runtime = new AntigravityChatRuntime(plugin);
    const runPrint = jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('Hi\n');

    await collect(runtime.query(
      runtime.prepareTurn({ text: 'Hello' }),
      undefined,
      { model: 'antigravity:gemini-2.5-flash' },
    ));

    expect(runPrint).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash',
    }));
  });

  it('repairs a tab-separated model selection saved by older discovery code', async () => {
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    const runPrint = jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('Hi\n');

    await collect(runtime.query(
      runtime.prepareTurn({ text: 'Hello' }),
      undefined,
      { model: 'antigravity:gemini-3.6-flash-high\tGemini 3.6 Flash (High)' },
    ));

    expect(runPrint).toHaveBeenCalledWith(expect.objectContaining({
      model: 'Gemini 3.6 Flash (High)',
    }));
  });

  it('emits a startup status before waiting for agy print output', async () => {
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('Hi from Antigravity\n');

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(chunks[0]).toEqual({ content: 'Starting Antigravity...', type: 'status' });
  });

  it('reports an empty agy print response instead of finishing silently', async () => {
    setLocale('ru');
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('');

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(chunks).toContainEqual({
      type: 'error',
      content: expect.stringContaining('Antigravity завершил работу без ответа'),
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('includes Grimoire note and selection context in the persisted and print prompts', async () => {
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    const runPrint = jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('Context received\n');

    const turn = runtime.prepareTurn({
      browserSelection: {
        selectedText: 'Browser quote',
        source: 'browser:https://example.com',
        title: 'Example',
        url: 'https://example.com',
      },
      canvasSelection: {
        canvasPath: 'board.canvas',
        nodeIds: ['node-1', 'node-2'],
      },
      contextFiles: ['notes/instructions.md'],
      currentNotePath: 'notes/today.md',
      excludedFolders: ['Climate'],
      editorSelection: {
        mode: 'selection',
        notePath: 'notes/today.md',
        selectedText: 'Selected text',
        startLine: 4,
        lineCount: 2,
      },
      text: 'Summarize this',
    });

    expect(turn.persistedContent).toContain('<current_note>');
    expect(turn.persistedContent).toContain('notes/today.md');
    expect(turn.persistedContent).toContain('<context_files>');
    expect(turn.persistedContent).toContain('notes/instructions.md');
    expect(turn.persistedContent).toContain('<excluded_folders>');
    expect(turn.persistedContent).toContain('<folder>Climate</folder>');
    expect(turn.persistedContent).toContain('<editor_selection path="notes/today.md" lines="4-5">');
    expect(turn.persistedContent).toContain('Selected text');
    expect(turn.persistedContent).toContain('<browser_selection source="browser:https://example.com" title="Example" url="https://example.com">');
    expect(turn.persistedContent).toContain('<canvas_selection path="board.canvas">');

    await collect(runtime.query(turn));

    expect(runPrint).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('<current_note>'),
    }));
    const prompt = (runPrint.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain('<editor_selection path="notes/today.md" lines="4-5">');
    expect(prompt).toContain('notes/instructions.md');
    expect(prompt).toContain('<folder>Climate</folder>');
    expect(prompt).toContain('<browser_selection source="browser:https://example.com" title="Example" url="https://example.com">');
    expect(prompt).toContain('<canvas_selection path="board.canvas">');
  });

  it('rebuilds prior current-note context from conversation history metadata', async () => {
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    const runPrint = jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('Follow-up\n');
    const turn = runtime.prepareTurn({ text: 'Continue' });

    await collect(runtime.query(turn, [
      {
        content: 'Earlier request',
        currentNote: 'notes/prior.md',
        id: 'user-1',
        role: 'user',
        timestamp: 1,
      },
    ]));

    const prompt = (runPrint.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain('User:');
    expect(prompt).toContain('<current_note>');
    expect(prompt).toContain('notes/prior.md');
    expect(prompt).toContain('Earlier request');
    expect(prompt).toContain('User: Continue');
  });

  it('blocks safe mode because agy print cannot enforce file edit approvals', async () => {
    setLocale('ru');
    const settings: Record<string, unknown> = { permissionMode: 'normal' };
    updateAntigravityProviderSettings(settings, { enabled: true });
    const runtime = new AntigravityChatRuntime(createMockPlugin({ settings }));
    const runPrint = jest.spyOn(runtime as any, 'runPrint').mockResolvedValue('safe\n');

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(runPrint).not.toHaveBeenCalled();
    expect(chunks).toContainEqual({
      type: 'error',
      content: expect.stringContaining('Безопасный режим Antigravity недоступен'),
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('localizes non-Error request failures', async () => {
    setLocale('ru');
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    jest.spyOn(runtime as any, 'runPrint').mockRejectedValue('transport failed');

    const chunks = await collect(runtime.query(runtime.prepareTurn({ text: 'Hello' })));

    expect(chunks).toContainEqual({
      type: 'error',
      content: 'Сбой запроса к Antigravity',
    });
  });

  it('recovers agy print output from the Antigravity transcript when Windows stdout is empty', async () => {
    const runtime = new AntigravityChatRuntime(createMockPlugin());
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-antigravity-test-'));
    const conversationId = '28b04652-35c4-46ca-8231-3e9f904bb0dd';
    const appDataDir = path.join(tempRoot, 'antigravity-cli');
    const transcriptDir = path.join(
      appDataDir,
      'brain',
      conversationId,
      '.system_generated',
      'logs',
    );

    try {
      const result = (runtime as any).runPrint({
        command: 'agy',
        cwd: '/tmp/grimoire-antigravity-test-vault',
        model: null,
        permissionMode: 'full_access',
        prompt: 'Hello from transcript',
        runtimeEnv: process.env,
      });
      const spawnArgs = mockedSpawn.mock.calls[0][1] as string[];
      const logFileArgIndex = spawnArgs.indexOf('--log-file');
      expect(logFileArgIndex).toBeGreaterThanOrEqual(0);
      const logFilePath = spawnArgs[logFileArgIndex + 1];
      expect(logFilePath).toBeTruthy();
      await fs.mkdir(transcriptDir, { recursive: true });
      await fs.writeFile(logFilePath, [
        `I0620 common.go:156] CLI app data directory: ${appDataDir}`,
        `I0620 printmode.go:156] Print mode: conversation=${conversationId}, sending message`,
      ].join('\n'));
      await fs.writeFile(path.join(transcriptDir, 'transcript.jsonl'), [
        JSON.stringify({
          content: '<USER_REQUEST>\nHello from transcript\n</USER_REQUEST>',
          source: 'USER_EXPLICIT',
          status: 'DONE',
          type: 'USER_INPUT',
        }),
        JSON.stringify({
          content: 'Recovered from transcript.\n',
          source: 'MODEL',
          status: 'DONE',
          type: 'PLANNER_RESPONSE',
        }),
      ].join('\n'));
      proc.emit('exit', 0, null);

      await expect(result).resolves.toBe('Recovered from transcript.\n');
      expect(getSpawnedAgyArgs()).toEqual(expect.arrayContaining([
        '--dangerously-skip-permissions',
        '--log-file',
        logFilePath,
        '--print',
        'Hello from transcript',
      ]));
      expect(mockedSpawn.mock.calls[0][2]).toEqual(expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });

  it('maps permission modes to agy print flags', () => {
    expect(buildAntigravityPrintArgs({
      model: 'Gemini 3.5 Flash (High)',
      permissionMode: 'normal',
      prompt: 'Hello',
    })).toEqual([
      '--sandbox',
      '--model',
      'Gemini 3.5 Flash (High)',
      '--print',
      'Hello',
    ]);

    expect(buildAntigravityPrintArgs({
      model: null,
      permissionMode: 'full_access',
      prompt: 'Hello',
    })).toEqual([
      '--dangerously-skip-permissions',
      '--print',
      'Hello',
    ]);
  });
});
