import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { toAgyArgs } from '@test/helpers/antigravityLaunchShape';

import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { createAntigravityWorkspaceServices } from '@/providers/antigravity/app/AntigravityWorkspaceServices';
import {
  discoverAntigravityModels,
  parseAntigravityModels,
} from '@/providers/antigravity/runtime/AntigravityModelDiscovery';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

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
  return toAgyArgs(args);
}

describe('AntigravityModelDiscovery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockedSpawn.mockReset();
  });

  it('uses CLI slugs for selection and labels for display', () => {
    expect(parseAntigravityModels([
      'Fetching available models...',
      'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      'Gemini 3.6 Flash (High)',
    ].join('\r\n'))).toEqual([
      {
        label: 'Gemini 3.6 Flash (High)',
        rawId: 'gemini-3.6-flash-high',
      },
      {
        label: 'Claude Sonnet 4.6 (Thinking)',
        rawId: 'claude-sonnet-4-6',
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
      const spawnArgs = getSpawnedAgyArgs();
      const logFileArgIndex = spawnArgs.indexOf('--log-file');
      // Without the log file the recovery falls back to the real Antigravity
      // app-data directory of whoever runs the suite, so a missing path has to
      // fail here rather than silently turn this into a test of the host's own
      // settings.json.
      expect(logFileArgIndex).toBeGreaterThanOrEqual(0);
      const logFilePath = spawnArgs[logFileArgIndex + 1];
      await fs.mkdir(appDataDir, { recursive: true });
      await fs.writeFile(logFilePath, `I0620 common.go:156] CLI app data directory: ${appDataDir}`);
      await fs.writeFile(path.join(appDataDir, 'settings.json'), JSON.stringify({
        model: 'Claude 4.5 Sonnet',
      }));
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

  it('keeps multibyte model labels intact across stdout chunk boundaries', async () => {
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const plugin = createMockPlugin();

    const resultPromise = discoverAntigravityModels(plugin);
    const output = Buffer.from('gemini-3.6-flash-high\t文心模型 (High)\n', 'utf8');
    proc.stdout.write(output.subarray(0, 23));
    proc.stdout.write(output.subarray(23));
    await new Promise(resolve => setImmediate(resolve));
    proc.emit('exit', 0, null);

    await expect(resultPromise).resolves.toEqual([
      { label: '文心模型 (High)', rawId: 'gemini-3.6-flash-high' },
    ]);
  });

  it('refreshes an expired saved catalog on demand and persists the new IDs', async () => {
    const plugin = createMockPlugin();
    plugin.saveSettings = jest.fn().mockResolvedValue(undefined);
    const label = 'Gemini 4 Hydrogen (High)';
    const rawId = 'gemini-4-hydrogen-high';
    updateAntigravityProviderSettings(plugin.settings, {
      discoveredModels: [{ label, rawId: label }],
      visibleModels: [label],
      modelAliases: { [label]: 'Hydrogen' },
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const { modelCatalog } = await createAntigravityWorkspaceServices(plugin, {} as VaultFileAdapter);
    const request = { plugin, settings: plugin.settings };
    await expect(modelCatalog.refreshModels(request)).resolves.toBe('skipped');
    expect(mockedSpawn).not.toHaveBeenCalled();

    clock.mockReturnValue(1_000 + 10 * 60 * 1000);
    const proc = createMockChildProcess();
    mockedSpawn.mockReturnValue(proc);
    const refresh = modelCatalog.refreshModels(request);
    proc.stdout.write(`${rawId}\t${label}\n`);
    proc.emit('exit', 0, null);

    await expect(refresh).resolves.toBe('refreshed');
    expect(getAntigravityProviderSettings(plugin.settings)).toMatchObject({
      discoveredModels: [{ rawId, label }],
      modelAliases: { [rawId]: 'Hydrogen' },
    });
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    await expect(modelCatalog.refreshModels(request)).resolves.toBe('skipped');
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });
});
