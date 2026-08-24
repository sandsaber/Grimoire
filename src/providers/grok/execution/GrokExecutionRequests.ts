import { createHash } from 'node:crypto';

import type { ManagedAcpAuxiliaryInvocation } from '@/providers/acp/execution/ManagedAcpAuxiliaryQuery';
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
 * Which auxiliary conversation a turn belongs to.
 *
 * The legacy runner is one instance per purpose, each with its own managed
 * `GROK_HOME` and its own idle process; the purpose is what keeps them apart
 * here, and it is what a `reset()` ends.
 */
export type GrokAuxiliaryPurpose = 'inline' | 'instructions' | 'title-gen';

/** What one auxiliary turn asks for, before it becomes an opaque reference. */
export interface GrokAuxiliaryRequest {
  readonly purpose: GrokAuxiliaryPurpose;
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
   * Not a per-turn field despite arriving on every call: Grok reads its system
   * prompt from a file the artifacts write into the managed home, so changing it
   * is a relaunch. It is part of the launch key for exactly that reason.
   */
  readonly systemPrompt: string;
  readonly prompt: string;
  /** The model the caller asked for, in whichever id space it had. */
  readonly model?: string;
}

/**
 * Everything ambient a launched auxiliary `grok agent … stdio` runs under.
 *
 * Built by the composition, which is the half that knows this provider: the
 * managed home for this purpose, the command line its permission policy and
 * reasoning effort ride on, and the raw model id behind whatever the caller
 * passed.
 */
export interface GrokAuxiliaryEnvironment {
  readonly executable: string;
  /** What `grok agent … stdio` is spawned with, including this purpose's policy. */
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  /** Everything the launch is keyed by; a change relaunches the process. */
  readonly launchKey: string;
  /** The raw model id to apply per turn, where one applies. */
  readonly modelId?: string;
  /**
   * Whether this purpose is launched with a filesystem delegate at all.
   *
   * An inline edit reads the note around what it is editing; a title and a
   * refinement are given everything they need in the prompt, and the legacy
   * runner handed them no `readTextFile` — which the ACP handshake carries, so
   * the agent is told there is nothing to read rather than refused per call.
   */
  readonly readsFiles: boolean;
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
  private readonly auxiliary = new Map<string, GrokAuxiliaryRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  /**
   * Which auxiliary startups were launched to read, by the reference the client
   * factory is handed.
   *
   * The factory is given a `startupRef` and nothing else, and for this provider
   * the filesystem delegate differs per purpose. Absent means no: a launch this
   * store has forgotten reads nothing, which is the safe half of the answer.
   */
  private readonly auxiliaryReads = new Map<string, boolean>();
  private readonly dynamics = new Map<string, GrokAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<GrokInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
    /**
     * Absent until this provider's auxiliary work is routed through the kernel.
     * Optional rather than throwing at construction, because the chat half of
     * this store is live and the auxiliary half is not.
     */
    private readonly auxiliaryEnvironment?: (
      request: GrokAuxiliaryRequest,
    ) => Promise<GrokAuxiliaryEnvironment>,
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

  /**
   * Holds an auxiliary turn and returns the reference the backend will carry.
   *
   * The same reference space as a chat turn, deliberately: it is the same
   * kernel carrying it, and a second space would be a second thing to keep
   * bounded and a second place for a prompt to be retained.
   */
  referenceAuxiliary(request: GrokAuxiliaryRequest): string {
    evict(this.auxiliary, this.limit);
    const reference = this.nextReference();
    this.auxiliary.set(reference, request);
    return reference;
  }

  async resolveAuxiliary(requestRef: string): Promise<ManagedAcpAuxiliaryInvocation> {
    const request = this.auxiliary.get(requestRef);
    if (!request) {
      throw new Error('Unknown Grok auxiliary request reference.');
    }
    this.auxiliary.delete(requestRef);
    if (!this.auxiliaryEnvironment) {
      throw new Error('Grok auxiliary execution has no environment.');
    }
    const environment = await this.auxiliaryEnvironment(request);
    evict(this.startups, this.limit);
    evict(this.auxiliaryReads, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      // The policy is on the command line here too: an auxiliary turn's
      // permission mode and reasoning effort are what the process was started
      // with, which is why neither can be applied to the session afterwards.
      arguments: [...environment.arguments],
      cwd: environment.cwd,
      environment: { ...environment.environment },
    });
    this.auxiliaryReads.set(startupRef, environment.readsFiles);
    return {
      startupRef,
      cwd: environment.cwd,
      prompt: [{ type: 'text', text: request.prompt }],
      mcpServers: [],
      // One retained process per conversation, relaunched when the launch it was
      // started for is no longer the launch this turn asks for — a system prompt
      // edited in settings, a CLI path changed, an effort level moved.
      retentionKey: auxiliaryRetentionKey(request.purpose, request.conversationId),
      restartFingerprint: fingerprint(environment.launchKey),
      // **Told no, not cut off.** There is no agent definition to deny a tool
      // here, so the reading profile launches in `ask` mode and its agent asks
      // about tools it can run. A cancelled outcome would end the turn; the
      // reject option is a refusal it can report and carry on from, which is
      // what the legacy runner answered with.
      permissionRefusal: 'reject',
      // Grok has ACP's dedicated setter rather than a `model` config option, so
      // the model travels as an id rather than as a configuration to apply.
      ...(environment.modelId ? { modelId: environment.modelId } : {}),
    };
  }

  /** Whether the auxiliary launch behind this startup was given a filesystem. */
  auxiliaryReadsFiles(startupRef: string): boolean {
    return this.auxiliaryReads.get(startupRef) ?? false;
  }

  /** Drops everything held for turns that will never dispatch. */
  dispose(): void {
    this.pending.clear();
    this.auxiliary.clear();
    this.startups.clear();
    this.auxiliaryReads.clear();
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

/**
 * The key one auxiliary conversation is retained under.
 *
 * Exported because the caller that ends a conversation has to name the same one
 * the store minted: `AuxQueryRunner.reset()` knows which runner it is, and the
 * runner is the conversation.
 */
export function auxiliaryRetentionKey(
  purpose: GrokAuxiliaryPurpose,
  conversationId: string,
): string {
  return `grok-auxiliary:${purpose}:${conversationId}`;
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
