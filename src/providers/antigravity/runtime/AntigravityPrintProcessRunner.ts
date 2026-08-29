import { promises as fs } from 'node:fs';

import type {
  AntigravityInvocation,
  AntigravityProcessHandle,
  AntigravityProcessOutcome,
  AntigravityProcessRunner,
  AntigravityProcessRunnerHooks,
} from '../execution/AntigravityExecutionBackend';
import { buildAntigravityPrintArgs, usesAntigravityStreamJson } from './AntigravityPrintProtocol';
import { buildAntigravityProcessLaunch } from './AntigravityProcessLaunch';
import {
  type AntigravityStreamJsonParser,
  createAntigravityStreamJsonParser,
  formatAntigravityUserEvent,
} from './AntigravityStreamJson';
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
  /** `pipe` when the prompt travels on stdin rather than in argv. */
  readonly stdin?: 'pipe' | 'ignore';
}

export interface AntigravityManagedChildProcess {
  readonly started: Promise<void>;
  /**
   * Writes the whole of stdin and closes it.
   *
   * One method rather than a stream, so a provider contract learns no Node
   * vocabulary: the protocol sends exactly one line and then EOF, and anything
   * that needs more than that needs a different contract, not a wider one.
   */
  sendInput?(text: string): Promise<void>;
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

  start(
    invocation: AntigravityInvocation,
    hooks: AntigravityProcessRunnerHooks = {},
  ): AntigravityProcessHandle {
    const logFilePath = (this.options.createLogPath ?? createAntigravityPrintLogPath)();
    const spec = {
      ...(invocation.addDirPath ? { addDirPath: invocation.addDirPath } : {}),
      ...(invocation.cliCapabilities ? { capabilities: invocation.cliCapabilities } : {}),
      logFilePath,
      model: invocation.model,
      permissionMode: invocation.permissionMode,
      prompt: invocation.prompt,
    };
    const streamJson = usesAntigravityStreamJson(spec);
    const launch = buildAntigravityProcessLaunch(
      invocation.command,
      buildAntigravityPrintArgs(spec),
      { ...invocation.environment },
    );
    const child = this.options.transport.launch({
      args: launch.args,
      command: launch.command,
      cwd: invocation.cwd,
      environment: invocation.environment,
      shell: launch.shell,
      ...(streamJson ? { stdin: 'pipe' as const } : {}),
    });
    const parser = streamJson
      ? createAntigravityStreamJsonParser({
        ...(hooks.onAssistantText
          ? {
            onEvent: (event) => {
              if (event.type === 'text') {
                hooks.onAssistantText?.(event.text);
              }
            },
          }
          : {}),
      })
      : undefined;
    if (streamJson) {
      if (!child.sendInput) {
        throw new Error('Antigravity stream-json launch requires a transport that pipes stdin.');
      }
      // Not awaited: the handle is returned synchronously, and a prompt that
      // cannot be written is a failed run rather than a failed launch — the
      // process is already owned, so it has to be terminated through the
      // ordinary path rather than left behind by a throw from here.
      void child.sendInput(formatAntigravityUserEvent(invocation.prompt)).catch(() => undefined);
    }
    const outputLimit = new OutputLimitMonitor(this.options.outputByteLimit ?? 64_000);
    return {
      started: child.started,
      completed: this.observeCompletion(child, invocation, logFilePath, outputLimit, parser),
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
    parser?: AntigravityStreamJsonParser,
  ): Promise<AntigravityProcessOutcome> {
    const stdout = new LimitedBytes(outputLimit);
    const stderr = new LimitedBytes(outputLimit);
    try {
      const [exit] = await Promise.all([
        child.exited,
        parser ? consumeFrames(child.stdout, parser, outputLimit) : consume(child.stdout, stdout),
        consume(child.stderr, stderr),
      ]);
      // **The frame, not the pipe.** In stream-json the answer is one field of
      // the last `result` frame, and the frames around it are progress this
      // turn has already published. Accumulating the pipe instead would spend
      // the byte ceiling on NDJSON envelopes and lose the head of a long answer
      // to the cap.
      if (parser) {
        parser.end();
        const result = parser.getResult();
        return {
          exitCode: exit.code,
          ...(exit.signal ? { signal: exit.signal } : {}),
          stdout: result?.response ?? '',
          stderr: result?.error ? `${stderr.value()}${result.error}` : stderr.value(),
          ...(outputLimit.didExceed ? { outputLimitExceeded: true } : {}),
        };
      }
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

/**
 * Feeds NDJSON to the parser, charging the ceiling for what arrives.
 *
 * The bytes are still counted: a run that floods the pipe has to reach the
 * output limit whether or not the flood parses.
 */
async function consumeFrames(
  stream: AsyncIterable<Uint8Array>,
  parser: AntigravityStreamJsonParser,
  outputLimit: OutputLimitMonitor,
): Promise<void> {
  const decoder = new TextDecoder('utf8');
  for await (const chunk of stream) {
    if (!outputLimit.consume(chunk.byteLength)) {
      return;
    }
    parser.write(decoder.decode(chunk, { stream: true }));
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
