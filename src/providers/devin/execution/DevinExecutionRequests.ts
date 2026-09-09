import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedMcpServer } from '@/core/types';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import type { AcpContentBlock } from '@/providers/acp/types';

import type { DevinAcpDynamicConfig } from './DevinAcpDynamicConfig';
import type { DevinExecutionInvocation } from './DevinExecutionBackend';

/** The subcommand that turns the CLI into a JSON-RPC server over stdio. */
export const DEVIN_ACP_ARGUMENTS: readonly string[] = Object.freeze(['acp']);

/** What one Devin turn decides, before it becomes an opaque reference. */
export interface DevinExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  /** The mode and model this turn runs under, applied to the session. */
  readonly dynamic?: DevinAcpDynamicConfig;
  readonly messageId?: string;
}

/**
 * Everything ambient a launched `devin acp` runs under, read at dispatch.
 *
 * There are no launch artifacts — no managed home, no config file, no system
 * prompt written to disk — so what a turn runs under is decided by a command
 * line rather than by a directory.
 */
export interface DevinInvocationEnvironment {
  readonly executable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Everything the launch is keyed by; a change restarts the process. */
  readonly launchKey: string;
  readonly mcpServers: readonly ManagedMcpServer[];
}

const DEFAULT_LIMIT = 64;

/**
 * The store behind Devin's request, startup and dynamic references.
 *
 * Three reference spaces, one object, because they are three halves of one
 * dispatch: the kernel carries `requestRef`, the process launcher carries
 * `startupRef`, and the dynamic applier carries `dynamicRef`. In memory and
 * bounded: a reference that outlived a restart would promise a re-dispatch
 * nothing can make, and an unbounded map of prompts is a leak.
 */
export class DevinExecutionRequests {
  private readonly pending = new Map<string, DevinExecutionRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, DevinAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<DevinInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: DevinExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<DevinExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      arguments: [...DEVIN_ACP_ARGUMENTS],
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
   * The metadata session is the caller.
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
      throw new Error('Unknown Devin startup reference.');
    }
    return launch;
  }

  /** What the session is configured with, by the reference the turn carries. */
  async resolveDynamic(dynamicRef: string): Promise<DevinAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown Devin dynamic configuration reference.');
    }
    return dynamic;
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): DevinExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown Devin request reference.');
    }
    this.pending.delete(requestRef);
    return request;
  }
}

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
