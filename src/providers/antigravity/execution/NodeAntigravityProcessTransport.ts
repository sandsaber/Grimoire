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
      ...(spec.stdin === 'pipe' ? { stdin: 'pipe' as const } : {}),
      terminationKind: this.platform === 'windows'
        ? 'windows-process-tree'
        : 'posix-process-group',
      ...(this.platform === 'windows'
        ? { windowsInvocationMode: spec.shell ? 'argument-array' as const : 'direct' as const }
        : {}),
    });
    return {
      started: child.started,
      ...(child.stdin
        ? {
          sendInput: async (text: string) => {
            // Written and closed in one call: the protocol sends one line and
            // then EOF, and an `agy` waiting on a stdin that never ends waits
            // for the whole run timeout.
            const stdin = child.stdin;
            if (!stdin) {
              return;
            }
            // **EOF is not conditional on the write succeeding.** Closing only
            // after the write settles makes the end of input hostage to a
            // callback that a broken pipe never delivers, and a live `agy` then
            // holds the turn open waiting for input that will never end. 1.3.2
            // closed unconditionally; verified live, an `agy` whose stdin stays
            // open answers and then never leaves.
            const written = new Promise<void>((resolve, reject) => {
              // The child can exit before draining stdin, and an unhandled
              // stream `error` would take the renderer down with it.
              stdin.once('error', reject);
              stdin.write(text, error => (error ? reject(error) : resolve()));
            });
            // Issued now rather than in a `finally`: a callback that never
            // fires never settles the promise either, so awaiting first means
            // the close never runs at all. `end` flushes what is queued.
            stdin.end();
            await written;
          },
        }
        : {}),
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
