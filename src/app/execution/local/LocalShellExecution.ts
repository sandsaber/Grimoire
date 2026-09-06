import { randomUUID } from 'node:crypto';

import type { ExecutionBackend } from '@/core/execution/ExecutionContracts';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import type { ExecutionSessionId, RunId } from '@/core/execution/ExecutionIds';
import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import {
  LocalShellBackend,
  type LocalShellInvocation,
  type LocalShellPlatform,
  type LocalShellProcessLauncher,
  type LocalShellProcessSupervisor,
  type LocalShellScheduler,
} from '@/core/execution/local/LocalShellBackend';

import { NodeLocalShellProcessAdapter } from './NodeLocalShellProcessAdapter';

export interface LocalShellExecutionOptions {
  readonly platform?: LocalShellPlatform;
  /** Substituted in tests; production uses the Node adapter. */
  readonly processes?: LocalShellProcessLauncher & LocalShellProcessSupervisor;
  readonly scheduler?: LocalShellScheduler;
}

/** What a finished shell command left behind. */
export interface LocalShellCommandOutcome {
  readonly stdout: string;
  readonly stderr: string;
  /** Whether the command ended any way other than a clean exit. */
  readonly failed: boolean;
  /**
   * Why it failed, when the reason is not in the output.
   *
   * A timeout, an output limit, or a process that could not be started leave
   * nothing on stdout to explain themselves. A non-zero exit does, so it has
   * no message.
   */
  readonly error?: string;
}

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * The application's owner of shell execution.
 *
 * Bang-bash mode used to spawn its own child process from the chat feature —
 * the last direct `child_process` import under `src/features/`, and the reason
 * the composition-boundary gate carried an exemption for it. Its process is a
 * run on the kernel now, which means it is cancelled at shutdown with
 * everything else rather than outliving the plugin that started it.
 *
 * One session for the plugin load, owned by an internal service rather than a
 * conversation: a shell command belongs to the application, not to a chat, and
 * closing the tab that typed it does not make the process someone else's
 * problem.
 */
export class LocalShellExecution {
  private readonly invocations = new Map<string, LocalShellInvocation>();
  private readonly outputs = new Map<string, { stdout: string[]; stderr: string[] }>();
  private session: ExecutionSessionId | null = null;
  private backend: LocalShellBackend | null = null;

  private disposed = false;

  constructor(
    private readonly registry: ExecutionLifecycleRegistry,
    private readonly options: LocalShellExecutionOptions = {},
  ) {}

  createBackend(): ExecutionBackend {
    const decoders = new Map<string, TextDecoder>();
    const decode = (key: string, chunk: Uint8Array): string => {
      const decoder = decoders.get(key) ?? new TextDecoder();
      decoders.set(key, decoder);
      // Streaming, because a multi-byte character split across two reads is
      // otherwise two replacement characters.
      return decoder.decode(chunk, { stream: true });
    };

    const processes = this.options.processes ?? new NodeLocalShellProcessAdapter();
    this.backend = new LocalShellBackend({
      platform: this.options.platform ?? (process.platform === 'win32' ? 'windows' : 'posix'),
      launcher: processes,
      supervisor: processes,
      requestResolver: {
        resolve: async requestRef => {
          const invocation = this.invocations.get(requestRef);
          if (!invocation) {
            throw new Error('This shell command is no longer available to run.');
          }
          this.invocations.delete(requestRef);
          return invocation;
        },
      },
      outputObserver: {
        onStdout: async (id, chunk) => {
          this.outputs.get(id)?.stdout.push(decode(`${id}:out`, chunk));
        },
        onStderr: async (id, chunk) => {
          this.outputs.get(id)?.stderr.push(decode(`${id}:err`, chunk));
        },
        onOutputLimit: async () => {},
      },
      scheduler: this.options.scheduler ?? {
        setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle: unknown) => window.clearTimeout(
          handle as ReturnType<typeof setTimeout>,
        ),
      },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      timeoutMs: TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    return this.backend;
  }

  /** Runs one command and answers with everything it produced. */
  async run(invocation: LocalShellInvocation): Promise<LocalShellCommandOutcome> {
    if (this.disposed) {
      throw new Error('Shell execution has been shut down.');
    }
    const session = await this.ensureSession();
    const id = runId(opaqueId('run'));
    const requestRef = opaqueId('lsreq');
    this.invocations.set(requestRef, invocation);
    this.outputs.set(id, { stdout: [], stderr: [] });

    try {
      return await this.awaitTerminal(session, id, requestRef);
    } finally {
      this.invocations.delete(requestRef);
      this.outputs.delete(id);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const session = this.session;
    this.session = null;
    this.invocations.clear();
    this.outputs.clear();
    if (session) {
      await this.registry.disposeSession(session).catch(() => {
        // Shutdown cancels the runs anyway; a session that cannot be closed
        // here is not a reason to stop unloading.
      });
    }
  }

  private async ensureSession(): Promise<ExecutionSessionId> {
    if (this.session) {
      return this.session;
    }
    const backend = this.backend;
    if (!backend) {
      throw new Error('The local shell backend has not been registered.');
    }
    const id = executionSessionId(opaqueId('es'));
    await this.registry.createSession({
      backendId: backend.descriptor.backendId,
      executionSessionId: id,
      owner: { kind: 'internal-service', ownerId: 'local-shell' },
    });
    this.session = id;
    return id;
  }

  private awaitTerminal(
    session: ExecutionSessionId,
    id: RunId,
    requestRef: string,
  ): Promise<LocalShellCommandOutcome> {
    return new Promise<LocalShellCommandOutcome>((resolve, reject) => {
      const unsubscribe = this.registry.observe(session, (envelope: ExecutionEventEnvelope) => {
        if (envelope.scope.kind !== 'run' || envelope.scope.runId !== id) {
          return;
        }
        if (envelope.event.kind !== 'terminal') {
          return;
        }
        unsubscribe();
        resolve(this.readOutcome(id, envelope.event.terminal, envelope.event.reason));
      });

      // `resultExpectation: 'none'` because a shell command's result is its
      // output and its exit status; asking for a provider result would fail
      // every command that exits cleanly.
      this.registry.startRun(session, {
        runId: id,
        owner: { kind: 'internal-service', ownerId: 'local-shell' },
        resultExpectation: 'none',
        requestRef,
      }).catch(error => {
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private readOutcome(
    id: string,
    terminal: string,
    reason: string,
  ): LocalShellCommandOutcome {
    const collected = this.outputs.get(id) ?? { stdout: [], stderr: [] };
    return {
      stdout: collected.stdout.join(''),
      stderr: collected.stderr.join(''),
      failed: terminal !== 'succeeded',
      ...(FAILURE_MESSAGES[reason] ? { error: FAILURE_MESSAGES[reason] } : {}),
    };
  }
}

/**
 * The failures whose reason is not already on stdout.
 *
 * A non-zero exit explains itself in the command's own output, so it is absent
 * here on purpose: adding a message for it would put Grimoire's words in front
 * of the shell's.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  timeout: `Command timed out after ${TIMEOUT_MS / 1000}s`,
  'output-limit': `Output exceeded maximum buffer size (${MAX_OUTPUT_BYTES / 1024 / 1024}MB)`,
  'spawn-failed': 'The command could not be started',
  'cancellation-confirmed': 'Command cancelled',
  'cancellation-unknown': 'Command cancelled, and the process could not be confirmed gone',
  'effects-unknown': 'The command stopped and its process could not be confirmed gone',
};

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
