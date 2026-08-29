import { promises as fs } from 'node:fs';

import type {
  AntigravityInvocation,
  AntigravityProcessHandle,
  AntigravityProcessOutcome,
  AntigravityProcessRunner,
} from '../execution/AntigravityExecutionBackend';
import { buildAntigravityPrintArgs } from './AntigravityPrintProtocol';
import { buildAntigravityProcessLaunch } from './AntigravityProcessLaunch';
import {
  type AntigravityTranscriptRecoveryResult,
  createAntigravityPrintLogPath,
  recoverAntigravityPrintTranscriptBounded,
} from './AntigravityTranscriptRecovery';

export interface AntigravityProcessTransportSpec {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly shell: boolean;
}

export interface AntigravityManagedChildProcess {
  readonly started: Promise<void>;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<{ readonly code: number | null; readonly signal?: string }>;
  confirmTerminated(): Promise<boolean>;
  terminate(mode: 'graceful' | 'forced'): Promise<'confirmed' | 'unconfirmed'>;
}

export interface AntigravityProcessTransport {
  /** Acquires complete process-tree ownership before returning. */
  launch(spec: AntigravityProcessTransportSpec): AntigravityManagedChildProcess;
}

export interface AntigravityPrintProcessRunnerOptions {
  readonly transport: AntigravityProcessTransport;
  /** Combined stdout, stderr, and recovered-result byte ceiling. */
  readonly outputByteLimit?: number;
  readonly createLogPath?: () => string;
  readonly recoverTranscript?: (
    logFilePath: string,
    environment: Readonly<Record<string, string | undefined>>,
    outputByteLimit: number,
  ) => Promise<AntigravityTranscriptRecoveryResult>;
  readonly removeLog?: (logFilePath: string) => Promise<void>;
}

/** Provider protocol runner; lifecycle and terminal classification stay in the backend. */
export class AntigravityPrintProcessRunner implements AntigravityProcessRunner {
  constructor(private readonly options: AntigravityPrintProcessRunnerOptions) {
    requirePositive(options.outputByteLimit ?? 64_000, 'Antigravity output limit');
  }

  start(invocation: AntigravityInvocation): AntigravityProcessHandle {
    const logFilePath = (this.options.createLogPath ?? createAntigravityPrintLogPath)();
    const args = buildAntigravityPrintArgs({
      ...(invocation.addDirPath ? { addDirPath: invocation.addDirPath } : {}),
      ...(invocation.cliCapabilities ? { capabilities: invocation.cliCapabilities } : {}),
      logFilePath,
      model: invocation.model,
      permissionMode: invocation.permissionMode,
      prompt: invocation.prompt,
    });
    const launch = buildAntigravityProcessLaunch(
      invocation.command,
      args,
      { ...invocation.environment },
    );
    const child = this.options.transport.launch({
      args: launch.args,
      command: launch.command,
      cwd: invocation.cwd,
      environment: invocation.environment,
      shell: launch.shell,
    });
    const outputLimit = new OutputLimitMonitor(this.options.outputByteLimit ?? 64_000);
    return {
      started: child.started,
      completed: this.observeCompletion(child, invocation, logFilePath, outputLimit),
      outputLimitExceeded: outputLimit.exceeded,
      confirmTerminated: () => child.confirmTerminated(),
      terminate: mode => child.terminate(mode),
    };
  }

  private async observeCompletion(
    child: AntigravityManagedChildProcess,
    invocation: AntigravityInvocation,
    logFilePath: string,
    outputLimit: OutputLimitMonitor,
  ): Promise<AntigravityProcessOutcome> {
    const stdout = new LimitedBytes(outputLimit);
    const stderr = new LimitedBytes(outputLimit);
    try {
      const [exit] = await Promise.all([
        child.exited,
        consume(child.stdout, stdout),
        consume(child.stderr, stderr),
      ]);
      const stdoutText = stdout.value();
      const transcript = exit.code === 0 && !stdoutText && !outputLimit.didExceed
        ? await (this.options.recoverTranscript ?? recoverAntigravityPrintTranscriptBounded)(
          logFilePath,
          invocation.environment,
          outputLimit.remaining,
        )
        : { output: '', outputLimitExceeded: false };
      if (transcript.outputLimitExceeded
        || Buffer.byteLength(transcript.output, 'utf8') > outputLimit.remaining) {
        outputLimit.markExceeded();
      } else {
        outputLimit.consume(Buffer.byteLength(transcript.output, 'utf8'));
      }
      return {
        exitCode: exit.code,
        ...(exit.signal ? { signal: exit.signal } : {}),
        stdout: stdoutText,
        stderr: stderr.value(),
        ...(transcript.output ? { transcriptOutput: transcript.output } : {}),
        ...(outputLimit.didExceed ? { outputLimitExceeded: true } : {}),
      };
    } finally {
      await (this.options.removeLog ?? removeLog)(logFilePath).catch(() => undefined);
    }
  }
}

class OutputLimitMonitor {
  private consumedBytes = 0;
  private exceededValue = false;
  private resolveExceeded!: () => void;
  readonly exceeded = new Promise<void>(resolve => { this.resolveExceeded = resolve; });

  constructor(private readonly limit: number) {}

  get didExceed(): boolean {
    return this.exceededValue;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.consumedBytes);
  }

  consume(bytes: number): boolean {
    if (this.exceededValue) {
      return false;
    }
    if (bytes > this.remaining) {
      this.markExceeded();
      return false;
    }
    this.consumedBytes += bytes;
    return true;
  }

  markExceeded(): void {
    if (this.exceededValue) {
      return;
    }
    this.exceededValue = true;
    this.resolveExceeded();
  }
}

class LimitedBytes {
  private readonly chunks: Buffer[] = [];

  constructor(private readonly outputLimit: OutputLimitMonitor) {}

  append(chunk: Uint8Array): void {
    if (this.outputLimit.consume(chunk.byteLength)) {
      this.chunks.push(Buffer.from(chunk));
    }
  }

  value(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

async function consume(stream: AsyncIterable<Uint8Array>, output: LimitedBytes): Promise<void> {
  for await (const chunk of stream) {
    output.append(chunk);
  }
}

function removeLog(logFilePath: string): Promise<void> {
  return fs.unlink(logFilePath);
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}
