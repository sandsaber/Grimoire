import type { Readable, Writable } from 'node:stream';
import { setTimeout as setNodeTimeout } from 'node:timers';

import {
  type LocalProcessSystem,
  localShellPlatformForNode,
  NodeLocalProcessSystem,
  NodeLocalShellProcessAdapter,
  type SpawnedLocalProcess,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { LocalShellPlatform } from '@/core/execution/local/LocalShellBackend';
import type {
  CodexExecutionProcess,
  CodexExecutionProcessFactory,
} from '@/providers/codex/runtime/CodexExecutionConnection';
import type { CodexLaunchSpec } from '@/providers/codex/runtime/codexLaunchTypes';

type ExitCallback = (
  code: number | null,
  signal: string | null,
  error?: Error,
) => void;

export interface NodeCodexExecutionProcessOptions {
  readonly launchSpec: Pick<CodexLaunchSpec, 'command' | 'args' | 'spawnCwd' | 'env'>;
  readonly system?: LocalProcessSystem;
  readonly platform?: LocalShellPlatform;
  readonly gracefulTerminationMs?: number;
  readonly forcedTerminationMs?: number;
}

/** Creates one application-owned persistent process per backend generation. */
export class NodeCodexExecutionProcessFactory implements CodexExecutionProcessFactory {
  constructor(private readonly options: NodeCodexExecutionProcessOptions) {}

  create(): CodexExecutionProcess {
    return new NodeCodexExecutionProcess(this.options);
  }
}

/**
 * Application boundary for Codex process-tree ownership. Provider code sees
 * only stdio JSON-RPC and never Node process or platform primitives.
 */
export class NodeCodexExecutionProcess implements CodexExecutionProcess {
  private readonly adapter: NodeLocalShellProcessAdapter;
  private readonly platform: LocalShellPlatform;
  private readonly callbacks = new Set<ExitCallback>();
  private child: SpawnedLocalProcess | undefined;
  private exit: { code: number | null; signal: string | null; error?: Error } | undefined;
  private shutdownTask: Promise<void> | undefined;

  constructor(private readonly options: NodeCodexExecutionProcessOptions) {
    this.platform = options.platform ?? localShellPlatformForNode(process.platform);
    this.adapter = new NodeLocalShellProcessAdapter(options.system ?? new NodeLocalProcessSystem());
    requirePositive(options.gracefulTerminationMs ?? 1_000, 'Codex graceful termination timeout');
    requirePositive(options.forcedTerminationMs ?? 2_000, 'Codex forced termination timeout');
  }

  get stdin(): Writable {
    const stdin = this.child?.stdin;
    if (!stdin) {
      throw new Error('Codex execution process stdin is not available.');
    }
    return stdin;
  }

  get stdout(): Readable {
    const stdout = this.child?.stdoutReadable;
    if (!stdout) {
      throw new Error('Codex execution process stdout is not available.');
    }
    return stdout;
  }

  start(): void {
    if (this.child) {
      throw new Error('Codex execution process was already started.');
    }
    const child = this.adapter.launch({
      executable: this.options.launchSpec.command,
      arguments: [...this.options.launchSpec.args],
      cwd: this.options.launchSpec.spawnCwd,
      environment: { ...this.options.launchSpec.env },
      terminationKind: this.platform === 'windows'
        ? 'windows-process-tree'
        : 'posix-process-group',
      stdin: 'pipe',
      ...(this.platform === 'windows'
        ? {
          windowsInvocationMode: requiresWindowsCommandShim(this.options.launchSpec.command)
            ? 'argument-array' as const
            : 'direct' as const,
        }
        : {}),
    });
    if (!child.stdin || !child.stdoutReadable || !child.stderrReadable) {
      void this.adapter.terminate(child.termination, 'forced');
      throw new Error('Codex owned process did not expose all required stdio pipes.');
    }
    child.stdin.on('error', error => {
      this.notifyExit(null, null, asError(error));
    });
    this.child = child;
    void drain(child.stderr);
    void child.started.catch(error => {
      this.notifyExit(null, null, asError(error));
    });
    void child.exited.then(observed => {
      this.notifyExit(observed.code, null);
    });
  }

  onExit(callback: ExitCallback): void {
    if (this.exit) {
      callback(this.exit.code, this.exit.signal, this.exit.error);
      return;
    }
    this.callbacks.add(callback);
  }

  shutdown(): Promise<void> {
    this.shutdownTask ??= this.stopOwnedTree();
    return this.shutdownTask;
  }

  private async stopOwnedTree(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    if (await this.adapter.confirmTerminated(child.termination)) {
      return;
    }
    const graceful = await this.adapter.terminate(child.termination, 'graceful');
    if (graceful === 'confirmed') {
      return;
    }
    await delay(this.options.gracefulTerminationMs ?? 1_000);
    const forced = await this.adapter.terminate(child.termination, 'forced');
    if (forced === 'confirmed') {
      return;
    }
    await delay(this.options.forcedTerminationMs ?? 2_000);
    if (!await this.adapter.confirmTerminated(child.termination)) {
      throw new Error('Codex process-tree termination could not be confirmed.');
    }
  }

  private notifyExit(
    code: number | null,
    signal: string | null,
    error?: Error,
  ): void {
    if (this.exit) {
      return;
    }
    this.exit = { code, signal, ...(error ? { error } : {}) };
    for (const callback of this.callbacks) {
      callback(code, signal, error);
    }
    this.callbacks.clear();
  }
}

async function drain(stream: AsyncIterable<Uint8Array>): Promise<void> {
  try {
    const iterator = stream[Symbol.asyncIterator]();
    while (!(await iterator.next()).done) {
      // Stderr is intentionally ephemeral here; sanitized diagnostics are a separate port.
    }
  } catch {
    // Process exit is reported through the owned process lifecycle.
  }
}

function delay(delayMs: number): Promise<void> {
  return new Promise(resolve => setNodeTimeout(resolve, delayMs));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function requiresWindowsCommandShim(command: string): boolean {
  return /\.(?:cmd|bat)$/iu.test(command.trim());
}
