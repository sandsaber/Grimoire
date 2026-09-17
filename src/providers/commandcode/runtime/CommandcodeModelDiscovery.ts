import { delayThroughWindow } from '@/app/execution/hostTimers';
import { NodeLocalShellProcessAdapter } from '@/app/execution/local/NodeLocalShellProcessAdapter';

import type { CommandcodeSettings } from '../settings';
import { commandcodeLaunchSpec } from './CommandcodeProcess';

export function parseCommandcodeModels(output: string): CommandcodeSettings['discoveredModels'] {
  const models = new Map<string, CommandcodeSettings['discoveredModels'][number]>();
  for (const line of output.split(/\r?\n/)) {
    // The observed CLI prints an id and description separated by two or more spaces.
    const match = /^([\w][\w/.:+-]*)\s{2,}(\S.*)$/.exec(line);
    if (match && !match[1].endsWith(':')) models.set(match[1], { rawId: match[1], label: match[1], description: match[2] });
  }
  return [...models.values()];
}

export async function discoverCommandcodeModels(command: string, cwd: string, environment: Record<string, string>) {
  const result = await queryCommandcodeMetadata(command, cwd, environment, ['--list-models', '--no-auto-update']);
  if (result.code !== 0) throw new Error('Command Code model discovery failed.');
  const models = parseCommandcodeModels(result.stdout);
  if (!models.length) throw new Error('Command Code returned no models.');
  return models;
}

export function parseCommandcodeEfforts(output: string): string[] | undefined {
  if (/^.+ has no adjustable reasoning effort\.$/m.test(output.trim())) return [];
  const supported = /^Unknown effort "grimoire-probe"\. Supported: ([a-z][a-z0-9_, -]*)\.$/m.exec(output.trim());
  if (!supported) return undefined;
  const values = supported[1].split(', ');
  return values.every(value => /^[a-z][a-z0-9_-]*$/.test(value)) ? [...new Set(values)] : undefined;
}

export async function discoverCommandcodeEfforts(command: string, cwd: string, environment: Record<string, string>, model: string) {
  // An invalid level exits before config writes or inference. Empty stdin also prevents a turn.
  const result = await queryCommandcodeMetadata(command, cwd, environment,
    ['--model', model, '--effort', 'grimoire-probe', '--print', '--no-auto-update', '--skip-onboarding']);
  const efforts = result.code === 1 ? parseCommandcodeEfforts(result.stderr) : undefined;
  if (!efforts) throw new Error('Command Code did not report supported reasoning efforts.');
  return efforts;
}

async function queryCommandcodeMetadata(command: string, cwd: string, environment: Record<string, string>, args: string[]) {
  const adapter = new NodeLocalShellProcessAdapter();
  const base = commandcodeLaunchSpec({ command, cwd, environment, prompt: '', permissionMode: 'normal' });
  const child = adapter.launch({ ...base, arguments: args, stdin: 'ignore' });
  const read = async (source: AsyncIterable<Uint8Array>) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of source) {
      size += chunk.byteLength;
      if (size > 1024 * 1024) throw new Error('Command Code model listing exceeded its limit.');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  let timer: number | undefined;
  const stop = async () => {
    if (await adapter.confirmTerminated(child.termination)) return;
    await adapter.terminate(child.termination, 'forced');
    await delayThroughWindow(1000);
    if (!await adapter.confirmTerminated(child.termination)) {
      throw new Error('Command Code model discovery process termination could not be confirmed.');
    }
  };
  try {
    const result = await Promise.race([
      Promise.all([child.started, child.exited, read(child.stdout), read(child.stderr)]),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Command Code model discovery timed out.')), 30_000);
      }),
    ]);
    return { code: result[1].code, stdout: result[2], stderr: result[3] };
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    await stop();
  }
}
