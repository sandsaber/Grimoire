import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '../../../app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedMcpServer } from '../../../core/types';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import type { AcpContentBlock } from '../../acp/types';
import type { OpencodeAcpDynamicConfig } from './OpencodeAcpDynamicConfig';
import type { OpencodeExecutionInvocation } from './OpencodeExecutionBackend';

/** What one OpenCode turn decides, before it becomes an opaque reference. */
export interface OpencodeExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  /** The mode, model and effort this turn runs under, applied to the session. */
  readonly dynamic?: OpencodeAcpDynamicConfig;
  readonly messageId?: string;
  /**
   * The OpenCode database this conversation's session lives in.
   *
   * Carried per turn because it belongs to the conversation, not to the vault:
   * a session created against one database cannot be loaded from another, so a
   * turn launched without its conversation's path resumes nothing and starts a
   * new session with the history left behind.
   */
  readonly databasePath?: string;
  /**
   * Told what the launch actually resolved to, so the conversation can be saved
   * pointing at it. The environment decides — `OPENCODE_DB`, or the default the
   * artifacts compute — and only it knows the answer.
   */
  readonly onLaunchResolved?: (databasePath: string | null) => void;
}



/**
 * Everything ambient a launched `opencode acp` runs under, read at dispatch.
 *
 * The artifacts are the part that makes this provider different from the other
 * two: OpenCode is configured by files Grimoire writes before the process
 * starts — a config and a system prompt — so what a turn runs under is decided
 * by a directory as much as by a command line.
 */
export interface OpencodeInvocationEnvironment {
  readonly executable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Everything the launch is keyed by; a change restarts the process. */
  readonly launchKey: string;
  readonly mcpServers: readonly ManagedMcpServer[];
  /** Where the launched process keeps its sessions, as the launch resolved it. */
  readonly databasePath: string | null;
}

const DEFAULT_LIMIT = 64;

/**
 * The store behind OpenCode's request, startup and dynamic references.
 *
 * Three reference spaces, one object, because they are three halves of one
 * dispatch: the kernel carries `requestRef` and hands it back when the turn is
 * dispatched, the process launcher carries `startupRef` and hands it back when
 * it actually spawns, and the dynamic applier carries `dynamicRef` and hands it
 * back when the session's mode and model are set. None of them may be a copy —
 * a reference minted against one store resolves to nothing in another, which is
 * the defect wave 1's end-to-end turn found on its first run.
 *
 * In memory and bounded, for the same reason as the other two providers: a
 * reference that outlived a restart would promise a re-dispatch nothing can
 * make, and an unbounded map of prompts is a leak made of the most sensitive
 * thing this provider handles.
 */
export class OpencodeExecutionRequests {
  private readonly pending = new Map<string, OpencodeExecutionRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, OpencodeAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: (
      databasePath?: string,
    ) => Promise<OpencodeInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: OpencodeExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<OpencodeExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment(request.databasePath);
    request.onLaunchResolved?.(environment.databasePath);
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      // The one subcommand this provider is spoken to through; everything else
      // about the launch is the config file the artifacts wrote.
      arguments: ['acp'],
      cwd: environment.cwd,
      environment: { ...environment.environment },
    });
    let dynamicRef: string | undefined;
    if (request.dynamic) {
      evict(this.dynamics, this.limit);
      dynamicRef = this.nextReference();
      this.dynamics.set(dynamicRef, request.dynamic);
    }
    return {
      startupRef,
      restartFingerprint: fingerprint(environment.launchKey),
      cwd: environment.cwd,
      prompt: [...request.prompt],
      mcpServers: toAcpMcpServers([...environment.mcpServers]),
      ...(request.messageId ? { messageId: request.messageId } : {}),
      ...(dynamicRef ? { dynamicRef } : {}),
    };
  }

  /**
   * Holds a launch that belongs to no turn, and returns its startup reference.
   *
   * The metadata session is the caller: it opens an isolated OpenCode process
   * to ask what models and commands exist, which is a launch with no prompt
   * behind it and therefore no request reference to resolve into one.
   */
  referenceLaunch(launch: ManagedAcpLaunchInvocation): string {
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, launch);
    return startupRef;
  }

  /** What the launcher spawns, by the reference the startup carries. */
  async resolveLaunch(startupRef: string): Promise<ManagedAcpLaunchInvocation> {
    const launch = this.startups.get(startupRef);
    if (!launch) {
      throw new Error('Unknown OpenCode startup reference.');
    }
    return launch;
  }

  /**
   * What the session is configured with, by the reference the turn carries.
   *
   * Shaped as the applier's resolver so the provider's own ordering — mode,
   * then model, then effort — stays where it already is.
   */
  async resolveDynamic(dynamicRef: string): Promise<OpencodeAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown OpenCode dynamic configuration reference.');
    }
    return dynamic;
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): OpencodeExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown OpenCode request reference.');
    }
    // Removed on resolve: holding a prompt after its run dispatched is
    // retention nobody asked for.
    this.pending.delete(requestRef);
    return request;
  }
}

/**
 * What makes the backend restart the process rather than reuse the one it has.
 *
 * The legacy runtime's launch key, hashed: the command, the config the
 * artifacts wrote, the environment text, and the system prompt. Everything the
 * process cannot be told about after it has started.
 */
function fingerprint(launchKey: string): string {
  return createHash('sha256').update(launchKey).digest('hex');
}

function evict(store: Map<string, unknown>, limit: number): void {
  while (store.size >= limit) {
    const oldest = store.keys().next();
    if (oldest.done) {
      return;
    }
    store.delete(oldest.value);
  }
}
