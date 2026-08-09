import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  discoverAntigravityModels,
  parseAntigravityModels,
} from '@/providers/antigravity/runtime/AntigravityModelDiscovery';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const mockedSpawn = spawn as jest.Mock;

function createMockPlugin(): any {
  const settings: Record<string, unknown> = {};
  updateAntigravityProviderSettings(settings, { enabled: true });
  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grimoire-antigravity-test-vault',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('agy'),
    recordDebugLog: jest.fn(),
    settings,
  };
}

function createMockChildProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = jest.fn();
  proc.pid = 2345;
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

describe('AntigravityModelDiscovery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockedSpawn.mockReset();
  });

  it('uses the CLI display name from tab-separated model output', () => {
    expect(parseAntigravityModels([
      'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      'Gemini 3.6 Flash (High)',
    ].join('\r\n'))).toEqual([
      {
        label: 'Gemini 3.6 Flash (High)',
        rawId: 'Gemini 3.6 Flash (High)',
      },
      {
        label: 'Claude Sonnet 4.6 (Thinking)',
        rawId: 'Claude Sonnet 4.6 (Thinking)',
      },
    ]);
  });

  it('recovers models from Antigravity settings when agy models stdout is empty', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const plugin = createMockPlugin();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grimoire-antigravity-models-test-'));
    const appDataDir = path.join(tempRoot, 'antigravity-cli');

    try {
      const resultPromise = discoverAntigravityModels(plugin);
      const spawnArgs = mockedSpawn.mock.calls[0][1] as string[];
      const logFileArgIndex = spawnArgs.indexOf('--log-file');
      const logFilePath = logFileArgIndex >= 0 ? spawnArgs[logFileArgIndex + 1] : '';
      if (logFilePath) {
        await fs.mkdir(appDataDir, { recursive: true });
        await fs.writeFile(logFilePath, `I0620 common.go:156] CLI app data directory: ${appDataDir}`);
        await fs.writeFile(path.join(appDataDir, 'settings.json'), JSON.stringify({
          model: 'Claude 4.5 Sonnet',
        }));
      }
      proc.emit('exit', 0, null);

      await expect(resultPromise).resolves.toEqual([
        { label: 'Claude 4.5 Sonnet', rawId: 'Claude 4.5 Sonnet' },
        { label: 'Gemini 3.5 Flash (Medium)', rawId: 'Gemini 3.5 Flash (Medium)' },
        { label: 'Gemini 3.5 Flash (High)', rawId: 'Gemini 3.5 Flash (High)' },
        { label: 'Gemini 3.5 Flash (Low)', rawId: 'Gemini 3.5 Flash (Low)' },
        { label: 'Gemini 3.1 Pro (Low)', rawId: 'Gemini 3.1 Pro (Low)' },
        { label: 'Gemini 3.1 Pro (High)', rawId: 'Gemini 3.1 Pro (High)' },
        { label: 'Claude Sonnet 4.6 (Thinking)', rawId: 'Claude Sonnet 4.6 (Thinking)' },
        { label: 'Claude Opus 4.6 (Thinking)', rawId: 'Claude Opus 4.6 (Thinking)' },
        { label: 'GPT-OSS 120B (Medium)', rawId: 'GPT-OSS 120B (Medium)' },
      ]);
      expect(logFileArgIndex).toBeGreaterThanOrEqual(0);
      expect(logFilePath).toBeTruthy();
      expect(getSpawnedAgyArgs()).toEqual(expect.arrayContaining([
        '--log-file',
        logFilePath,
        'models',
      ]));
      expect(mockedSpawn.mock.calls[0][2]).toEqual(expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
      expect(plugin.recordDebugLog).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          modelCount: 9,
          providerId: 'antigravity',
        }),
        event: 'models.parsed',
        level: 'info',
        scope: 'provider.antigravity',
      }));
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });
});
