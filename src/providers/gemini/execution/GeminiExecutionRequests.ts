import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedMcpServer } from '@/core/types';
import { toAcpMcpServers } from '@/providers/acp/mcp/toAcpMcpServers';
import type { AcpContentBlock } from '@/providers/acp/types';

import type { GeminiAcpDynamicConfig } from './GeminiAcpDynamicConfig';
import type { GeminiExecutionInvocation } from './GeminiExecutionBackend';

/** What one Gemini turn decides, before it becomes an opaque reference. */
export interface GeminiExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  /** The mode and model this turn runs under, applied to the session. */
  readonly dynamic?: GeminiAcpDynamicConfig;
  readonly messageId?: string;
}

/**
 * Everything ambient a launched `gemini --acp` runs under, read at dispatch.
 *
 * Shorter than every other provider's, and the launch key says why: the
 * runtime this replaces restarted on a change to the command and the
 * environment text, and on nothing else. There are no launch artifacts — no managed home,
 * no config file, no system prompt written to disk — so what a turn runs under
 * is decided by a command line rather than by a directory. The `--acp` is a
 * flag, not a subcommand, which is the wave-7 difference.
 */
export interface GeminiInvocationEnvironment {
  readonly executable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Everything the launch is keyed by; a change restarts the process. */
  readonly launchKey: string;
  readonly mcpServers: readonly ManagedMcpServer[];
}

const DEFAULT_LIMIT = 64;

/**
 * The store behind Gemini's request, startup and dynamic references.
 *
 * Three reference spaces, one object, because they are three halves of one
 * dispatch: the kernel carries `requestRef` and hands it back when the turn is
 * dispatched, the process launcher carries `startupRef` and hands it back when
 * it actually spawns, and the dynamic applier carries `dynamicRef` and hands it
 * back when the session's mode and model are set. None of them may be a copy —
 * a reference minted against one store resolves to nothing in another.
 *
 * In memory and bounded, for the reason every provider before this one is: a
 * reference that outlived a restart would promise a re-dispatch nothing can
 * make, and an unbounded map of prompts is a leak made of the most sensitive
 * thing this provider handles.
 */
export class GeminiExecutionRequests {
  private readonly pending = new Map<string, GeminiExecutionRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, GeminiAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<GeminiInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: GeminiExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<GeminiExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      // A flag rather than a subcommand, which is what separates this wave from
      // the four before it.
      arguments: ['--acp'],
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
   * The metadata session is the caller: it opens an isolated Gemini process to
   * ask what models exist, which is a launch with no prompt behind it and
   * therefore no request reference to resolve into one.
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
      throw new Error('Unknown Gemini startup reference.');
    }
    return launch;
  }

  /**
   * What the session is configured with, by the reference the turn carries.
   *
   * Shaped as the applier's resolver so the provider's own ordering — model,
   * then mode — stays where it already is.
   */
  async resolveDynamic(dynamicRef: string): Promise<GeminiAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown Gemini dynamic configuration reference.');
    }
    return dynamic;
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): GeminiExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown Gemini request reference.');
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
 * The legacy runtime's launch key, hashed: the resolved command and the
 * environment text, and nothing else — there are no artifacts to key on,
 * because this provider writes none. The composition adds the vault's MCP
 * servers, which that runtime handled by shutting the process down instead.
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
