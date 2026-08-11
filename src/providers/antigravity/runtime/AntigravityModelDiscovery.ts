import { type ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { getVaultPath } from '../../../utils/path';
import {
  ANTIGRAVITY_FALLBACK_DISCOVERED_MODELS,
  normalizeAntigravityModelSelector,
} from '../models';
import type { AntigravityDiscoveredModel } from '../settings';
import { buildAntigravityProcessLaunch } from './AntigravityProcessLaunch';
import { buildAntigravityRuntimeEnv } from './AntigravityRuntimeEnvironment';

const MODEL_LIST_TIMEOUT_MS = 30_000;
const MODEL_LIST_BUFFER_LIMIT = 32_000;
const ACTIVE_MODELS_PROCESS_KEY = '__grimoireAntigravityActiveModelsProcess';

type AntigravityWindowState = Window & {
  [ACTIVE_MODELS_PROCESS_KEY]?: ChildProcess;
};

export async function discoverAntigravityModels(plugin: LegacyProviderContext): Promise<AntigravityDiscoveredModel[]> {
  const command = plugin.getResolvedProviderCliPath('antigravity') ?? 'agy';
  const cwd = getVaultPath(plugin.app) ?? process.cwd();
  plugin.recordDebugLog?.({
    data: {
      argsSummary: 'models',
      command,
      commandSource: classifyAgyCommand(command),
      cwdLabel: getCwdLabel(plugin, cwd),
      homePresent: Boolean(process.env.HOME),
      pathEntryCount: (process.env.PATH ?? '').split(':').filter(Boolean).length,
      pathHasLocalBin: (process.env.PATH ?? '').split(':').includes(`${process.env.HOME ?? ''}/.local/bin`),
      providerId: 'antigravity',
      shellPresent: Boolean(process.env.SHELL),
    },
    event: 'models.spawn',
    level: 'debug',
    scope: 'provider.antigravity',
  });
  const output = await runAgyModels({
    command,
    cwd,
    plugin,
    runtimeEnv: buildAntigravityRuntimeEnv(plugin.settings, command),
  });
  const models = output
    ? parseAntigravityModels(output)
    : [];

  plugin.recordDebugLog?.({
    data: {
      modelCount: models.length,
      providerId: 'antigravity',
      stdoutBytes: output.length,
    },
    event: models.length > 0 ? 'models.parsed' : 'models.empty',
    level: models.length > 0 ? 'info' : 'warn',
    scope: 'provider.antigravity',
  });

  return models;
}

export function parseAntigravityModels(output: string): AntigravityDiscoveredModel[] {
  const models: AntigravityDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const rawId = normalizeAntigravityModelSelector(line);
    if (!rawId || seen.has(rawId)) {
      continue;
    }
    seen.add(rawId);
    models.push({
      label: rawId,
      rawId,
    });
  }
  return models;
}

function runAgyModels(spec: {
  command: string;
  cwd: string;
  plugin: LegacyProviderContext;
  runtimeEnv: NodeJS.ProcessEnv;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelLogFilePath = createAntigravityModelsLogPath();
    const previousProcess = getActiveModelsProcess();
    if (previousProcess && !previousProcess.killed) {
      previousProcess.kill('SIGTERM');
      spec.plugin.recordDebugLog?.({
        data: {
          providerId: 'antigravity',
        },
        event: 'models.previousKilled',
        level: 'warn',
        scope: 'provider.antigravity',
      });
    }
    const launch = buildAntigravityProcessLaunch(spec.command, ['--log-file', modelLogFilePath, 'models'], spec.runtimeEnv);
    spec.plugin.recordDebugLog?.({
      data: {
        launchMode: launch.launchMode,
        providerId: 'antigravity',
      },
      event: 'models.launchMode',
      level: 'debug',
      scope: 'provider.antigravity',
    });
    const proc = spawn(launch.command, launch.args, {
      cwd: spec.cwd,
      env: spec.runtimeEnv,
      shell: launch.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    setActiveModelsProcess(proc);
    spec.plugin.recordDebugLog?.({
      data: {
        launchMode: launch.launchMode,
        pid: proc.pid ?? -1,
        providerId: 'antigravity',
        stdinMode: 'ignore',
        stdioMode: 'ignore-pipe-pipe',
      },
      event: 'models.processStarted',
      level: 'debug',
      scope: 'provider.antigravity',
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let sawStdout = false;
    let sawStderr = false;
    const startedAt = Date.now();
    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      clearActiveModelsProcess(proc);
      callback();
    };
    const timeout = window.setTimeout(() => {
      spec.plugin.recordDebugLog?.({
        data: {
          killSignal: 'SIGTERM',
          pid: proc.pid ?? -1,
          providerId: 'antigravity',
        },
        event: 'models.signalSent',
        level: 'warn',
        scope: 'provider.antigravity',
      });
      proc.kill('SIGTERM');
      window.setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          spec.plugin.recordDebugLog?.({
            data: {
              killSignal: 'SIGKILL',
              pid: proc.pid ?? -1,
              providerId: 'antigravity',
            },
            event: 'models.forceKill',
            level: 'error',
            scope: 'provider.antigravity',
          });
          proc.kill('SIGKILL');
        }
      }, 2_000);
      spec.plugin.recordDebugLog?.({
        data: {
          durationMs: Date.now() - startedAt,
          providerId: 'antigravity',
          stderrBytes: stderr.length,
          stderrPreview: summarizeCliText(stderr),
          stdoutBytes: stdout.length,
          timeoutMs: MODEL_LIST_TIMEOUT_MS,
        },
        event: 'models.timeout',
        level: 'error',
        scope: 'provider.antigravity',
      });
      settle(() => reject(new Error('Antigravity model discovery timed out.')));
    }, MODEL_LIST_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout = appendLimited(stdout, chunk);
      if (!sawStdout) {
        sawStdout = true;
        spec.plugin.recordDebugLog?.({
          data: {
            pid: proc.pid ?? -1,
            providerId: 'antigravity',
            stdoutBytes: stdout.length,
          },
          event: 'models.stdout',
          level: 'debug',
          scope: 'provider.antigravity',
        });
      }
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr = appendLimited(stderr, chunk);
      if (!sawStderr) {
        sawStderr = true;
        spec.plugin.recordDebugLog?.({
          data: {
            pid: proc.pid ?? -1,
            providerId: 'antigravity',
            stderrBytes: stderr.length,
            stderrPreview: summarizeCliText(stderr),
          },
          event: 'models.stderr',
          level: 'warn',
          scope: 'provider.antigravity',
        });
      }
    });
    proc.on('error', (error) => {
      settle(() => {
        spec.plugin.recordDebugLog?.({
          data: {
            providerId: 'antigravity',
          },
          error,
          event: 'models.spawnError',
          level: 'error',
          scope: 'provider.antigravity',
        });
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    proc.on('exit', (code, signal) => {
      settle(() => {
        void (async () => {
          const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
          spec.plugin.recordDebugLog?.({
            data: {
              durationMs: Date.now() - startedAt,
              providerId: 'antigravity',
              status,
              stderrBytes: stderr.length,
              stderrPreview: summarizeCliText(stderr),
              stdoutBytes: stdout.length,
            },
            event: code === 0 ? 'models.exit' : 'models.failed',
            level: code === 0 ? 'debug' : 'error',
            scope: 'provider.antigravity',
          });
          try {
            if (code === 0) {
              const recoveredOutput = stdout
                ? ''
                : await recoverAntigravityModelsFromSettings(modelLogFilePath, spec.runtimeEnv);
              if (recoveredOutput) {
                spec.plugin.recordDebugLog?.({
                  data: {
                    modelCount: parseAntigravityModels(recoveredOutput).length,
                    providerId: 'antigravity',
                  },
                  event: 'models.settingsRecovered',
                  level: 'info',
                  scope: 'provider.antigravity',
                });
              }
              resolve(stdout || recoveredOutput);
              return;
            }
            const details = stderr.trim();
            reject(new Error(details ? `Antigravity model discovery failed (${status})\n\n${details}` : `Antigravity model discovery failed (${status})`));
          } finally {
            await fs.unlink(modelLogFilePath).catch(() => undefined);
          }
        })().catch(reject);
      });
    });
    proc.on('close', (code, signal) => {
      const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      spec.plugin.recordDebugLog?.({
        data: {
          durationMs: Date.now() - startedAt,
          pid: proc.pid ?? -1,
          providerId: 'antigravity',
          signal: signal ?? 'none',
          status,
          stderrBytes: stderr.length,
          stdoutBytes: stdout.length,
        },
        event: 'models.close',
        level: 'debug',
        scope: 'provider.antigravity',
      });
    });
  });
}

function createAntigravityModelsLogPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return path.join(os.tmpdir(), `grimoire-antigravity-models-${suffix}.log`);
}

async function recoverAntigravityModelsFromSettings(
  logFilePath: string,
  runtimeEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const logText = await fs.readFile(logFilePath, 'utf-8').catch(() => '');
  const appDataDir = extractAntigravityAppDataDir(logText)
    ?? getDefaultAntigravityAppDataDir(runtimeEnv);
  if (!appDataDir) {
    return formatAntigravityModelsOutput(ANTIGRAVITY_FALLBACK_DISCOVERED_MODELS);
  }

  const settingsText = await fs.readFile(path.join(appDataDir, 'settings.json'), 'utf-8').catch(() => '');
  const selectedModel = extractSelectedAntigravityModel(settingsText);
  return formatAntigravityModelsOutput([
    ...(selectedModel ? [{ label: selectedModel, rawId: selectedModel }] : []),
    ...ANTIGRAVITY_FALLBACK_DISCOVERED_MODELS,
  ]);
}

function extractSelectedAntigravityModel(settingsText: string): string | null {
  if (!settingsText.trim()) {
    return null;
  }
  try {
    const settings = JSON.parse(settingsText) as Record<string, unknown>;
    return typeof settings.model === 'string' && settings.model.trim()
      ? settings.model.trim()
      : null;
  } catch {
    return null;
  }
}

function formatAntigravityModelsOutput(models: ReadonlyArray<AntigravityDiscoveredModel>): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (!model.rawId || seen.has(model.rawId)) {
      continue;
    }
    seen.add(model.rawId);
    lines.push(model.rawId);
  }
  return lines.join('\n');
}

function extractAntigravityAppDataDir(logText: string): string | null {
  const match = logText.match(/CLI app data directory:\s*(.+)$/mi);
  return match?.[1]?.trim() || null;
}

function getDefaultAntigravityAppDataDir(runtimeEnv: NodeJS.ProcessEnv): string | null {
  const home = runtimeEnv.USERPROFILE
    ?? (runtimeEnv.HOMEDRIVE && runtimeEnv.HOMEPATH ? `${runtimeEnv.HOMEDRIVE}${runtimeEnv.HOMEPATH}` : undefined)
    ?? runtimeEnv.HOME;
  return home ? path.join(home, '.gemini', 'antigravity-cli') : null;
}

function getActiveModelsProcess(): ChildProcess | null {
  return (window as AntigravityWindowState)[ACTIVE_MODELS_PROCESS_KEY] ?? null;
}

function setActiveModelsProcess(proc: ChildProcess): void {
  (window as AntigravityWindowState)[ACTIVE_MODELS_PROCESS_KEY] = proc;
}

function clearActiveModelsProcess(proc: ChildProcess): void {
  const state = window as AntigravityWindowState;
  if (state[ACTIVE_MODELS_PROCESS_KEY] === proc) {
    delete state[ACTIVE_MODELS_PROCESS_KEY];
  }
}

function appendLimited(current: string, chunk: Buffer | string): string {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  return `${current}${text}`.slice(-MODEL_LIST_BUFFER_LIMIT);
}

function getCwdLabel(plugin: LegacyProviderContext, cwd: string): string {
  return cwd === getVaultPath(plugin.app) ? 'vault' : 'process';
}

function classifyAgyCommand(command: string): string {
  if (command === 'agy') {
    return 'path';
  }
  if (command.endsWith('/.local/bin/agy')) {
    return 'homeLocalBin';
  }
  return 'absolute';
}

function summarizeCliText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 240);
}
