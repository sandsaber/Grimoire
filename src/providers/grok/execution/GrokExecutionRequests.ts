import { createHash } from 'node:crypto';

import type { ManagedAcpExecutionInvocation } from '@/providers/acp/execution/ManagedAcpExecutionBackend';

import type { ManagedAcpLaunchInvocation } from '../../../app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedMcpServer } from '../../../core/types';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import type { AcpContentBlock } from '../../acp/types';
import type { GrokAcpDynamicConfig } from './GrokAcpDynamicConfig';

/** What one Grok turn decides, before it becomes an opaque reference. */
export interface GrokExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  /** The mode, model and effort this turn runs under, applied to the session. */
  readonly dynamic?: GrokAcpDynamicConfig;
  readonly messageId?: string;
  /**
   * The Grok database this conversation's session lives in.
   *
   * Carried per turn because it belongs to the conversation, not to the vault:
   * a session created against one database cannot be loaded from another, so a
   * turn launched without its conversation's path resumes nothing and starts a
   * new session with the history left behind.
   */
}



/**
 * Everything ambient a launched `grok agent … stdio` runs under, read at
 * dispatch.
 *
 * What makes this provider different is that the launch carries the policy:
 * permission mode and reasoning effort are process arguments, so changing
 * either restarts the process rather than reconfiguring an open session. The
 * artifacts are a managed home Grok reads its config and system prompt from,
 * which is why what a turn runs under is decided by a directory as much as by
 * a command line.
 */
export interface GrokInvocationEnvironment {
  readonly executable: string;
  /** What `grok agent … stdio` is spawned with, decided by the settings. */
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Everything the launch is keyed by; a change restarts the process. */
  readonly launchKey: string;
  readonly mcpServers: readonly ManagedMcpServer[];
  /** The Grimoire-owned home the launched process reads its config from. */
  readonly grokHomePath: string;
}

const DEFAULT_LIMIT = 64;

/**
 * The store behind Grok's request, startup and dynamic references.
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
export class GrokExecutionRequests {
  private readonly pending = new Map<string, GrokExecutionRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, GrokAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<GrokInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: GrokExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<ManagedAcpExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      // Grok's flags are the launch, not the session: the permission policy
      // and the reasoning effort are process arguments, which is why a change
      // to either restarts it rather than being set on an open session.
      arguments: [...environment.arguments],
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
   * The metadata session is the caller: it opens an isolated Grok process
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
      throw new Error('Unknown Grok startup reference.');
    }
    return launch;
  }

  /**
   * What the session is configured with, by the reference the turn carries.
   *
   * Shaped as the applier's resolver so the provider's own ordering — mode,
   * then model, then effort — stays where it already is.
   */
  async resolveDynamic(dynamicRef: string): Promise<GrokAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown Grok dynamic configuration reference.');
    }
    return dynamic;
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): GrokExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown Grok request reference.');
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
