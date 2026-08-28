import {
  type LocalProcessSystem,
  localShellPlatformForNode,
  NodeLocalProcessSystem,
  NodeLocalShellProcessAdapter,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { LocalShellPlatform } from '@/core/execution/local/LocalShellBackend';
import type {
  AntigravityManagedChildProcess,
  AntigravityProcessTransport,
  AntigravityProcessTransportSpec,
} from '@/providers/antigravity/runtime/AntigravityPrintProcessRunner';

/** Application-owned OS process-tree adapter for the Antigravity provider protocol. */
export class NodeAntigravityProcessTransport implements AntigravityProcessTransport {
  private readonly adapter: NodeLocalShellProcessAdapter;

  constructor(
    system: LocalProcessSystem = new NodeLocalProcessSystem(),
    private readonly platform: LocalShellPlatform = localShellPlatformForNode(process.platform),
  ) {
    this.adapter = new NodeLocalShellProcessAdapter(system);
  }

  launch(spec: AntigravityProcessTransportSpec): AntigravityManagedChildProcess {
    const child = this.adapter.launch({
      executable: spec.command,
      arguments: [...spec.args],
      cwd: spec.cwd,
      environment: definedEnvironment(spec.environment),
      terminationKind: this.platform === 'windows'
        ? 'windows-process-tree'
        : 'posix-process-group',
      ...(this.platform === 'windows'
        ? { windowsInvocationMode: spec.shell ? 'argument-array' as const : 'direct' as const }
        : {}),
    });
    return {
      started: child.started,
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited.then(exit => ({ code: exit.code })),
      confirmTerminated: () => this.adapter.confirmTerminated(child.termination),
      terminate: mode => this.adapter.terminate(child.termination, mode),
    };
  }
}

function definedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}
