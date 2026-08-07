import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Readable, Writable } from 'node:stream';

const KILL_TIMEOUT_MS = 3_000;
const STDERR_BUFFER_LIMIT = 8_000;

export interface AcpSubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Explicit shell requirement. When set, overrides the Windows relative-command
   * heuristic so native executables (e.g. wsl.exe) can be spawned directly. */
  shell?: boolean;
}

type CloseListener = (error?: Error) => void;

export class AcpSubprocess {
  private closeError: Error | null = null;
  private readonly closeListeners = new Set<CloseListener>();
  private notifiedClose = false;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stderrBuffer = '';

  constructor(private readonly launchSpec: AcpSubprocessLaunchSpec) {}

  get stdin(): Writable {
    return this.requireProc().stdin;
  }

  get stdout(): Readable {
    return this.requireProc().stdout;
  }

  get stderr(): Readable {
    return this.requireProc().stderr;
  }

  private requireProc(): ChildProcessWithoutNullStreams {
    if (!this.proc) {
      throw new Error('ACP subprocess is not started');
    }
    return this.proc;
  }

  start(): void {
    if (this.proc) {
      return;
    }

    const proc = spawn(this.launchSpec.command, this.launchSpec.args, {
      cwd: this.launchSpec.cwd,
      env: this.launchSpec.env,
      shell: this.launchSpec.shell ?? shouldUseShell(this.launchSpec.command),
      stdio: 'pipe',
      windowsHide: true,
    });

    proc.stderr.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-STDERR_BUFFER_LIMIT);
    });

    proc.on('error', (error) => {
      this.closeError = error;
      this.notifyClose(error);
    });

    proc.on('exit', (code, signal) => {
      const exitError = this.closeError ?? (
        code === 0 && signal === null
          ? undefined
          : new Error(`ACP subprocess exited (${formatExit(code, signal)})`)
      );
      this.notifyClose(exitError);
    });

    this.proc = proc;
  }

  isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  getStderrSnapshot(): string {
    return this.stderrBuffer.trim();
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async shutdown(): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const proc = this.proc!;
      const onClose = () => {
        cleanup();
        resolve();
      };
      const killTimer = window.setTimeout(() => {
        if (isWin32() && proc.pid !== undefined) {
          spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
        } else {
          proc.kill('SIGKILL');
        }
      }, KILL_TIMEOUT_MS);
      const cleanup = () => {
        window.clearTimeout(killTimer);
        proc.off('exit', onClose);
      };

      proc.once('exit', onClose);
      proc.kill(isWin32() ? 'SIGINT' : 'SIGTERM');
    });
  }

  private notifyClose(error?: Error): void {
    if (this.notifiedClose) {
      return;
    }

    this.notifiedClose = true;
    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // Best-effort cleanup notification.
      }
    }
  }
}

function isWin32(): boolean {
  return process.platform === 'win32';
}

function shouldUseShell(command: string): boolean {
  if (!isWin32()) {
    return false;
  }

  const lowerBasename = path.win32.basename(command).toLowerCase();
  if (lowerBasename.endsWith('.cmd') || lowerBasename.endsWith('.bat')) {
    return true;
  }

  return !path.win32.isAbsolute(command);
}

function formatExit(code: number | null, signal: string | null): string {
  if (signal) {
    return `signal ${signal}`;
  }
  if (code === null) {
    return 'unknown';
  }
  return `code ${code}`;
}
