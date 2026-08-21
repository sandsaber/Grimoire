import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '../../../app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedMcpServer } from '../../../core/types';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import type { AcpContentBlock } from '../../acp/types';
import type { MimocodeAcpDynamicConfig } from './MimocodeAcpDynamicConfig';
import type { MimocodeExecutionInvocation } from './MimocodeExecutionBackend';

/** What one MiMoCode turn decides, before it becomes an opaque reference. */
export interface MimocodeExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  /** The mode, model and effort this turn runs under, applied to the session. */
  readonly dynamic?: MimocodeAcpDynamicConfig;
  readonly messageId?: string;
  /**
   * The MiMoCode database this conversation's session lives in.
   *
   * Carried per turn because it belongs to the conversation, not to the vault:
   * a session created against one database cannot be loaded from another, so a
   * turn launched without its conversation's path resumes nothing and starts a
   * new session with the history left behind.
   */
  readonly databasePath?: string;
  /**
   * Told what the launch actually resolved to, so the conversation can be saved
   * pointing at it. The environment decides — `MIMOCODE_DB`, or the default the
   * artifacts compute — and only it knows the answer.
   */
  readonly onLaunchResolved?: (databasePath: string | null) => void;
}



/**
 * Everything ambient a launched `mimo acp` runs under, read at dispatch.
 *
 * The artifacts are the part a command line does not carry: MiMoCode, like the
 * OpenCode CLI it forked from, is configured by files Grimoire writes before
 * the process starts — a config and a system prompt — so what a turn runs under
 * is decided by a directory as much as by the one subcommand it is spoken to
 * through.
 */
export interface MimocodeInvocationEnvironment {
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
 * The store behind MiMoCode's request, startup and dynamic references.
 *
 * Three reference spaces, one object, because they are three halves of one
 * dispatch: the kernel carries `requestRef` and hands it back when the turn is
 * dispatched, the process launcher carries `startupRef` and hands it back when
 * it actually spawns, and the dynamic applier carries `dynamicRef` and hands it
 * back when the session's mode and model are set. None of them may be a copy —
 * a reference minted against one store resolves to nothing in another, which is
 * the defect wave 1's end-to-end turn found on its first run.
 *
 * In memory and bounded, for the reason every provider before this one is: a
 * reference that outlived a restart would promise a re-dispatch nothing can
 * make, and an unbounded map of prompts is a leak made of the most sensitive
 * thing this provider handles.
 */
export class MimocodeExecutionRequests {
  private readonly pending = new Map<string, MimocodeExecutionRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, MimocodeAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: (
      databasePath?: string,
    ) => Promise<MimocodeInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: MimocodeExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<MimocodeExecutionInvocation> {
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
   * The metadata session is the caller: it opens an isolated MiMoCode process
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
      throw new Error('Unknown MiMoCode startup reference.');
    }
    return launch;
  }

  /**
   * What the session is configured with, by the reference the turn carries.
   *
   * Shaped as the applier's resolver so the provider's own ordering — mode,
   * then model, then effort — stays where it already is.
   */
  async resolveDynamic(dynamicRef: string): Promise<MimocodeAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown MiMoCode dynamic configuration reference.');
    }
    return dynamic;
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): MimocodeExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown MiMoCode request reference.');
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
 * The legacy runtime's launch key, hashed. `MimocodeChatRuntime` restarts on a
 * change to the command, the config path, the environment text, the system
 * prompt key, or the artifacts' own key — everything the process cannot be told
 * about after it has started — and the composition builds the same five in.
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
