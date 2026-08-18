import { NodeCodexExecutionProcess } from '@/app/execution/codex/NodeCodexExecutionProcess';
import type { LocalProcessSystem } from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { LocalShellPlatform } from '@/core/execution/local/LocalShellBackend';
import type { CodexExecutionConnectionFactory } from '@/providers/codex/execution/CodexExecutionBackend';
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
 * So it is resolved once and shared, and re-read only when the daemon it
 * described is gone. A resolution that failed is not remembered: the settings
 * behind it are ones the user can fix, and fixing them must not need a reload.
 */
export class CodexActiveLaunchSpec {
  private spec: CodexLaunchSpec | undefined;

  constructor(private readonly resolve: () => CodexLaunchSpec) {}

  current(): CodexLaunchSpec {
    this.spec ??= this.resolve();
    return this.spec;
  }

  invalidate(): void {
    this.spec = undefined;
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
    const process = new NodeCodexExecutionProcess({
      launchSpec: this.options.activeLaunchSpec.current(),
      ...(this.options.system ? { system: this.options.system } : {}),
      ...(this.options.platform ? { platform: this.options.platform } : {}),
      ...(this.options.gracefulTerminationMs
        ? { gracefulTerminationMs: this.options.gracefulTerminationMs }
        : {}),
      ...(this.options.forcedTerminationMs
        ? { forcedTerminationMs: this.options.forcedTerminationMs }
        : {}),
    });
    // The daemon is what the spec described. Once it is gone the next one is
    // launched from settings as they are now, not as they were at load.
    process.onExit(() => this.options.activeLaunchSpec.invalidate());
    return process;
  }
}
