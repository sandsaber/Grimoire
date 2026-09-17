import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { NodeLocalShellProcessAdapter } from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { LocalShellLaunchSpec } from '@/core/execution/local/LocalShellBackend';

import { type CommandcodeApprovalHandler, createCommandcodeApprovalTransport } from './CommandcodeApprovalTransport';
import { CommandcodeOutputLimitError,type CommandcodeResult, CommandcodeStream } from './CommandcodeStream';

export interface CommandcodeInvocation {
  command: string;
  cwd: string;
  environment: Record<string, string>;
  prompt: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  permissionMode: string;
}

export interface CommandcodeProcessHandle {
  started: Promise<void>;
  completed: Promise<{ code: number | null; result?: CommandcodeResult }>;
  confirmTerminated(): Promise<boolean>;
  terminate(mode: 'graceful' | 'forced'): Promise<'confirmed' | 'unconfirmed'>;
}

export interface CommandcodeProcessRunner {
  start(invocation: CommandcodeInvocation, onEvent: (event: Record<string, unknown>) => void,
    onSession: (id: string) => void, approve?: CommandcodeApprovalHandler): CommandcodeProcessHandle;
}

export function commandcodeLaunchSpec(invocation: CommandcodeInvocation, effortModPath?: string): LocalShellLaunchSpec {
  const args = ['--print', '--output-format', 'json', '--skip-onboarding', '--no-auto-update'];
  if (invocation.model) args.push('--model', invocation.model);
  if (invocation.sessionId) args.push('--resume', invocation.sessionId);
  if (invocation.effort) {
    if (!effortModPath) throw new Error('Command Code effort requires a session mod.');
    args.push('--mod', effortModPath);
  }
  if (invocation.permissionMode === 'full_access') args.push('--yolo');
  else args.push('--permission-mode', 'standard');
  return {
    executable: invocation.command,
    arguments: args,
    cwd: invocation.cwd,
    environment: invocation.environment,
    stdin: 'pipe',
    terminationKind: process.platform === 'win32' ? 'windows-process-tree' : 'posix-process-group',
    ...(process.platform === 'win32' ? { windowsInvocationMode: 'argument-array' as const } : {}),
  };
}

/** Owns the entire process tree; prompts never enter a shell command or argv. */
export class NodeCommandcodeProcessRunner implements CommandcodeProcessRunner {
  constructor(private readonly adapter = new NodeLocalShellProcessAdapter()) {}

  start(invocation: CommandcodeInvocation, onEvent: (event: Record<string, unknown>) => void,
    onSession: (id: string) => void, approve: CommandcodeApprovalHandler = async () => false): CommandcodeProcessHandle {
    const approval = invocation.permissionMode === 'full_access' ? undefined : createCommandcodeApprovalTransport(invocation, approve);
    const mod = !approval && invocation.effort ? createCommandcodeEffortMod(invocation.effort) : undefined;
    const cleanup = () => { mod?.dispose(); approval?.dispose(); };
    let child;
    try {
      const spec = approval ? commandcodeLaunchSpec({ ...invocation, effort: undefined, permissionMode: 'full_access' })
        : commandcodeLaunchSpec(invocation, mod?.path);
      child = this.adapter.launch(approval ? { ...spec, executable: approval.node,
        arguments: [approval.wrapperPath, ...spec.arguments, '--mod', approval.guardPath] } : spec);
    }
    catch (error) { cleanup(); throw error; }
    const stream = new CommandcodeStream(event => {
      if (invocation.effort && event.type === 'model_request_end' && event.effort !== invocation.effort) {
        throw new Error('Command Code did not apply the selected reasoning effort.');
      }
      onEvent(event);
    });
    let reportedSession: string | undefined;
    const started = Promise.all([child.started, approval?.ready]).then(() => {
      if (!child.stdin) throw new Error('Command Code stdin is unavailable.');
      child.stdin.on('error', () => undefined);
      child.stdin.end(invocation.prompt);
    });
    const read = async (source: AsyncIterable<Uint8Array>, parse: boolean) => {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      let bytes = 0;
      const accept = (line: string) => {
        stream.accept(line);
        if (stream.sessionId && stream.sessionId !== reportedSession) {
          reportedSession = stream.sessionId;
          onSession(stream.sessionId);
        }
      };
      for await (const chunk of source) {
        bytes += chunk.byteLength;
        if (bytes > 16 * 1024 * 1024) throw new CommandcodeOutputLimitError('Command Code output limit exceeded.');
        if (!parse) continue;
        pending += decoder.write(Buffer.from(chunk));
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          accept(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
        }
      }
      if (parse) accept(pending + decoder.end());
    };
    const completed = Promise.all([started, child.exited, read(child.stdout, true), read(child.stderr, false)])
      .then(([, exit]) => ({ code: exit.code, result: stream.result })).finally(cleanup);
    // The backend awaits readiness first; early pipe failures still have an observer.
    void completed.catch(() => undefined);
    return {
      started,
      completed,
      confirmTerminated: () => this.adapter.confirmTerminated(child.termination),
      terminate: mode => { approval?.dispose(); return this.adapter.terminate(child.termination, mode); },
    };
  }
}

export function createCommandcodeEffortMod(effort: string): { path: string; dispose(): void } {
  if (!/^[a-z][a-z0-9_-]*$/.test(effort)) throw new Error('Invalid Command Code reasoning effort.');
  const directory = mkdtempSync(join(tmpdir(), 'grimoire-commandcode-effort-'));
  const path = join(directory, 'effort.mjs');
  const dispose = () => rmSync(directory, { recursive: true, force: true });
  try {
    // --effort persists global config; the native mod API changes only this session.
    writeFileSync(path, `export default function(cmd) { cmd.setEffort(${JSON.stringify(effort)}); }\n`, { mode: 0o600 });
    return { path, dispose };
  } catch (error) { dispose(); throw error; }
}
