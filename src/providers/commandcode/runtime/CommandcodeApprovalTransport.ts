import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveExecutableFromPath } from '@/utils/resolveCliExecutable';

import { COMMANDCODE_APPROVAL_GUARD } from './CommandcodeApprovalGuard';
import type { CommandcodeInvocation } from './CommandcodeProcess';
import { isRecord } from './CommandcodeStream';

export interface CommandcodeApproval {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}
export type CommandcodeApprovalHandler = (request: CommandcodeApproval, signal: AbortSignal) => Promise<boolean>;

/** Private, per-run IPC. No prompt, tool input or approval is written to disk. */
export function createCommandcodeApprovalTransport(invocation: CommandcodeInvocation, approve: CommandcodeApprovalHandler) {
  const { node, entry } = resolveNodeInstallation(invocation);
  const directory = mkdtempSync(join(tmpdir(), 'gcc-safe-'));
  const token = randomBytes(32).toString('hex');
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\grimoire-${randomBytes(16).toString('hex')}`
    : join(directory, 'approval.sock');
  const guardPath = join(directory, 'guard.mjs');
  const wrapperPath = join(directory, 'launch.mjs');
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    const abort = new AbortController();
    let buffer = '', received = false;
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { sockets.delete(socket); abort.abort(); });
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      if (received) { socket.destroy(); return; }
      buffer += chunk.toString();
      if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      received = true;
      let frame: unknown;
      try { frame = JSON.parse(buffer.trim()); } catch { socket.destroy(); return; }
      if (!isRecord(frame) || frame.token !== token || typeof frame.toolCallId !== 'string'
        || typeof frame.toolName !== 'string' || !isRecord(frame.input)) { socket.destroy(); return; }
      const request = { toolCallId: frame.toolCallId, toolName: frame.toolName, input: frame.input };
      void Promise.resolve().then(() => approve(request, abort.signal)).catch(() => false).then(allow => {
        if (!socket.destroyed) socket.end(JSON.stringify({ allow: allow === true && !abort.signal.aborted }) + '\n');
      });
    });
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const socket of sockets) socket.destroy();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    writeFileSync(guardPath, COMMANDCODE_APPROVAL_GUARD, { mode: 0o600 });
    writeFileSync(wrapperPath, `import { install } from './guard.mjs';\n`
      + `install(${JSON.stringify({ address, token, effort: invocation.effort })});\n`
      + `process.argv = [process.execPath, ${JSON.stringify(entry)}, ...process.argv.slice(2)];\n`
      + `await import(${JSON.stringify(pathToFileURL(entry).href)});\n`, { mode: 0o600 });
    const ready = new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => { if (disposed) server.close(); resolve(); });
    });
    return { node, wrapperPath, guardPath, ready, dispose };
  } catch (error) { dispose(); throw error; }
}

function resolveNodeInstallation(invocation: CommandcodeInvocation): { node: string; entry: string } {
  const command = existsSync(invocation.command) ? invocation.command
    : resolveExecutableFromPath(invocation.command, invocation.environment.PATH);
  if (!command) throw new Error('Command Code CLI was not found.');
  const resolved = realpathSync(command);
  const candidates = [resolved, join(dirname(command), 'node_modules/command-code/dist/index.mjs')];
  const entry = candidates.find(path => {
    try {
      const manifest = JSON.parse(readFileSync(join(dirname(path), '..', 'package.json'), 'utf8')) as Record<string, unknown>;
      return path.endsWith('index.mjs') && manifest.name === 'command-code' && manifest.version === '1.53.0';
    } catch { return false; }
  });
  const node = resolveExecutableFromPath('node', invocation.environment.PATH);
  if (!entry || !node) throw new Error('Safe mode requires the verified command-code 1.53.0 npm installation and Node.js on PATH.');
  return { node, entry };
}
