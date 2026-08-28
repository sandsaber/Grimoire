import type { LocalProcessSystem } from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { LocalShellPlatform } from '@/core/execution/local/LocalShellBackend';
import type { CodexExecutionConnectionFactory } from '@/providers/codex/execution/CodexExecutionBackend';
import { NodeCodexExecutionProcess } from '@/providers/codex/execution/NodeCodexExecutionProcess';
import type {
  CodexExecutionConnection,
  CodexExecutionProcess,
} from '@/providers/codex/runtime/CodexExecutionConnection';
import { CodexJsonRpcExecutionConnection } from '@/providers/codex/runtime/CodexExecutionConnection';
import type { CodexLaunchSpec } from '@/providers/codex/runtime/codexLaunchTypes';

/**
 * The launch spec the daemon in front of us was started with.
 *
 * It answers two questions that must not be answered separately: which CLI to
 * run, and what a path means to it. A turn whose paths were expressed for one
 * target and dispatched to a daemon launched for another reads and writes
 * somewhere the user never pointed at, and the two targets Codex supports —
 * this machine and a WSL distro — disagree about every path there is.
 *
 * So it is resolved once and shared, and re-read only when **every** daemon
 * launched from it is gone. Counting matters: the backend replaces a lost
 * connection without waiting for the old process to die, so the retired one's
 * exit arrives after its replacement is already running on the same spec.
 * Retiring it there would answer the next path mapping for a target no live
 * daemon is on — the host/WSL split this type exists to prevent.
 *
 * A resolution that failed is not remembered: the settings behind it are ones
 * the user can fix, and fixing them must not need a reload.
 */
export class CodexActiveLaunchSpec {
  private spec: CodexLaunchSpec | undefined;
  private readonly daemons = new Map<CodexLaunchSpec, number>();

  constructor(private readonly resolve: () => CodexLaunchSpec) {}

  current(): CodexLaunchSpec {
    this.spec ??= this.resolve();
    return this.spec;
  }

  /**
   * Declares a daemon launched from the current spec.
   *
   * The spec comes back with the release so a caller cannot launch under one
   * and account for another. `release` is idempotent and belongs to its own
   * spec: a release for one that has already been retired changes nothing.
   */
  attach(): { readonly spec: CodexLaunchSpec; release(): void } {
    const spec = this.current();
    this.daemons.set(spec, (this.daemons.get(spec) ?? 0) + 1);
    let released = false;
    return {
      spec,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        const remaining = (this.daemons.get(spec) ?? 1) - 1;
        if (remaining > 0) {
          this.daemons.set(spec, remaining);
          return;
        }
        this.daemons.delete(spec);
        if (this.spec === spec) {
          this.spec = undefined;
        }
      },
    };
  }
}

export interface NodeCodexExecutionConnectionFactoryOptions {
  readonly activeLaunchSpec: CodexActiveLaunchSpec;
  readonly system?: LocalProcessSystem;
  readonly platform?: LocalShellPlatform;
  readonly gracefulTerminationMs?: number;
  readonly forcedTerminationMs?: number;
}

/**
 * One application-owned Codex daemon per connection.
 *
 * The launch spec is read when the process is created rather than when the
 * connection is: `create` is synchronous and the backend calls it before it has
 * anywhere to report a failure, so a launch the settings cannot describe has to
 * surface from `initialize`, where the backend already retires the connection
 * and fails the run.
 */
export class NodeCodexExecutionConnectionFactory implements CodexExecutionConnectionFactory {
  constructor(private readonly options: NodeCodexExecutionConnectionFactoryOptions) {}

  create(): CodexExecutionConnection {
    return new CodexJsonRpcExecutionConnection({
      create: () => this.createProcess(),
    });
  }

  private createProcess(): CodexExecutionProcess {
    const daemon = this.options.activeLaunchSpec.attach();
    const process = new NodeCodexExecutionProcess({
      launchSpec: daemon.spec,
      ...(this.options.system ? { system: this.options.system } : {}),
      ...(this.options.platform ? { platform: this.options.platform } : {}),
      ...(this.options.gracefulTerminationMs
        ? { gracefulTerminationMs: this.options.gracefulTerminationMs }
        : {}),
      ...(this.options.forcedTerminationMs
        ? { forcedTerminationMs: this.options.forcedTerminationMs }
        : {}),
    });
    // The daemon is what the spec described. Once the last one launched from it
    // is gone, the next is launched from settings as they are now, not as they
    // were at load.
    process.onExit(() => daemon.release());
    return process;
  }
}
