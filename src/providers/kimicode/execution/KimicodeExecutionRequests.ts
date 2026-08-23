import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '../../../app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedMcpServer } from '../../../core/types';
import type { ManagedAcpAuxiliaryInvocation } from '../../acp/execution/ManagedAcpAuxiliaryQuery';
import { toAcpMcpServers } from '../../acp/mcp/toAcpMcpServers';
import type { AcpContentBlock } from '../../acp/types';
import type { KimicodeAcpDynamicConfig } from './KimicodeAcpDynamicConfig';
import type { KimicodeExecutionInvocation } from './KimicodeExecutionBackend';

/** What one Kimi Code turn decides, before it becomes an opaque reference. */
export interface KimicodeExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  /** The mode, model and effort this turn runs under, applied to the session. */
  readonly dynamic?: KimicodeAcpDynamicConfig;
  readonly messageId?: string;
  /**
   * The Kimi Code database this conversation's session lives in.
   *
   * Carried per turn because it belongs to the conversation, not to the vault:
   * a session created against one database cannot be loaded from another, so a
   * turn launched without its conversation's path resumes nothing and starts a
   * new session with the history left behind.
   */
  readonly databasePath?: string;
  /**
   * Told what the launch actually resolved to, so the conversation can be saved
   * pointing at it. The environment decides — `KIMICODE_DB`, or the default the
   * artifacts compute — and only it knows the answer.
   */
  readonly onLaunchResolved?: (databasePath: string | null) => void;
}



/**
 * Which auxiliary conversation a turn belongs to.
 *
 * The legacy runners are one instance per purpose, each with its own artifacts
 * directory and its own idle process; the purpose is what keeps them apart here,
 * and it is what a `reset()` ends.
 */
export type KimicodeAuxiliaryPurpose = 'inline' | 'instructions' | 'title-gen';

/** What one auxiliary turn asks for, before it becomes an opaque reference. */
export interface KimicodeAuxiliaryRequest {
  readonly purpose: KimicodeAuxiliaryPurpose;
  /**
   * Which auxiliary conversation this turn belongs to — one per runner.
   *
   * The runner is the conversation, not the purpose, and the consumer is what
   * says so: `QueryBackedTitleGenerationService` builds a **runner per title**
   * and resets it when the title is done, while inline edit holds one for as
   * long as the edit lasts. Keying retention by purpose alone would put two
   * titles generated at once in one session, and let either one's `reset()`
   * close the process the other was using.
   */
  readonly conversationId: string;
  /**
   * The instructions the process is launched under.
   *
   * Not a per-turn field despite arriving on every call: Kimi Code reads its
   * system prompt from a file the artifacts write, so changing it is a
   * relaunch. It is part of the launch key for exactly that reason.
   */
  readonly systemPrompt: string;
  readonly prompt: string;
  /** The model the caller asked for, in whichever id space it had. */
  readonly model?: string;
}

/**
 * Everything ambient a launched auxiliary `kimicode acp` runs under.
 *
 * Built by the composition, which is the half that knows this provider: the
 * artifacts for this purpose's agent, the runtime environment, and the raw model
 * id behind whatever the caller passed.
 */
export interface KimicodeAuxiliaryEnvironment {
  readonly executable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Everything the launch is keyed by; a change relaunches the process. */
  readonly launchKey: string;
  /** The Grimoire-managed agent this purpose runs as, set on the session. */
  readonly agentId: string;
  /** The raw model id to apply per turn, where one applies. */
  readonly modelId?: string;
}

/**
 * Everything ambient a launched `kimi acp` runs under, read at dispatch.
 *
 * The artifacts are the part a command line does not carry: Kimi Code, like the
 * OpenCode CLI it forked from, is configured by files Grimoire writes before
 * the process starts — a config and a system prompt — so what a turn runs under
 * is decided by a directory as much as by the one subcommand it is spoken to
 * through.
 */
export interface KimicodeInvocationEnvironment {
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
 * The store behind Kimi Code's request, startup and dynamic references.
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
export class KimicodeExecutionRequests {
  private readonly pending = new Map<string, KimicodeExecutionRequest>();
  private readonly auxiliary = new Map<string, KimicodeAuxiliaryRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, KimicodeAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: (
      databasePath?: string,
    ) => Promise<KimicodeInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
    /**
     * Absent until this provider's auxiliary work is routed through the kernel.
     * Optional rather than throwing at construction, because the chat half of
     * this store is live and the auxiliary half is not.
     */
    private readonly auxiliaryEnvironment?: (
      request: KimicodeAuxiliaryRequest,
    ) => Promise<KimicodeAuxiliaryEnvironment>,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: KimicodeExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<KimicodeExecutionInvocation> {
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
   * The metadata session is the caller: it opens an isolated Kimi Code process
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
      throw new Error('Unknown Kimi Code startup reference.');
    }
    return launch;
  }

  /**
   * What the session is configured with, by the reference the turn carries.
   *
   * Shaped as the applier's resolver so the provider's own ordering — mode,
   * then model, then effort — stays where it already is.
   */
  async resolveDynamic(dynamicRef: string): Promise<KimicodeAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown Kimi Code dynamic configuration reference.');
    }
    return dynamic;
  }

  /**
   * Holds an auxiliary turn and returns the reference the backend will carry.
   *
   * The same reference space as a chat turn, deliberately: it is the same
   * kernel carrying it, and a second space would be a second thing to keep
   * bounded and a second place for a prompt to be retained.
   */
  referenceAuxiliary(request: KimicodeAuxiliaryRequest): string {
    evict(this.auxiliary, this.limit);
    const reference = this.nextReference();
    this.auxiliary.set(reference, request);
    return reference;
  }

  async resolveAuxiliary(requestRef: string): Promise<ManagedAcpAuxiliaryInvocation> {
    const request = this.auxiliary.get(requestRef);
    if (!request) {
      throw new Error('Unknown Kimi Code auxiliary request reference.');
    }
    this.auxiliary.delete(requestRef);
    if (!this.auxiliaryEnvironment) {
      throw new Error('Kimi Code auxiliary execution has no environment.');
    }
    const environment = await this.auxiliaryEnvironment(request);
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      arguments: ['acp'],
      cwd: environment.cwd,
      environment: { ...environment.environment },
    });
    return {
      startupRef,
      cwd: environment.cwd,
      prompt: [{ type: 'text', text: request.prompt }],
      mcpServers: [],
      // One retained process per purpose, relaunched when the launch it was
      // started for is no longer the launch this turn asks for — a system
      // prompt edited in settings, a CLI path changed, an environment rewritten.
      retentionKey: auxiliaryRetentionKey(request.purpose, request.conversationId),
      restartFingerprint: fingerprint(environment.launchKey),
      // The agent, when the session opens: it is what the permissions in the
      // generated config are attached to, and an auxiliary turn that ran as the
      // default agent would run with the vault's own tool permissions.
      sessionConfiguration: [{ configId: 'mode', value: environment.agentId }],
      ...(environment.modelId
        ? { turnConfiguration: [{ configId: 'model', value: environment.modelId }] }
        : {}),
    };
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.auxiliary.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): KimicodeExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown Kimi Code request reference.');
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
 * The legacy runtime's launch key, hashed. `KimicodeChatRuntime` restarts on a
 * change to the command, the config path, the environment text, the system
 * prompt key, or the artifacts' own key — everything the process cannot be told
 * about after it has started — and the composition builds the same five in.
 */
function fingerprint(launchKey: string): string {
  return createHash('sha256').update(launchKey).digest('hex');
}

/**
 * The key one auxiliary conversation is retained under.
 *
 * Exported because the caller that ends a conversation has to name the same one
 * the store minted: `AuxQueryRunner.reset()` knows which runner it is, and the
 * runner is the conversation.
 */
export function auxiliaryRetentionKey(
  purpose: KimicodeAuxiliaryPurpose,
  conversationId: string,
): string {
  return `kimicode-auxiliary:${purpose}:${conversationId}`;
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
