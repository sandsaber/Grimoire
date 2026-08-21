import type { BoundConversation } from '../../../core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { ChatMessage } from '../../../core/types';
import { buildContextFromHistory } from '../../../utils/session';
import type {
  SkillInput,
  SkillMetadata,
  ThreadResumeParams,
  ThreadStartParams,
  UserInput,
} from '../runtime/codexAppServerTypes';
import type { CodexLaunchSpec } from '../runtime/codexLaunchTypes';
import {
  extractExplicitCodexSkillNames,
  findPreferredCodexSkillByName,
} from '../skills/CodexSkillListingService';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../types/models';
import {
  type CodexConversationBinding,
  readCodexConversationBinding,
  toCodexThreadIntent,
} from './CodexConversationBinding';
import type {
  CodexExecutionInvocation,
  CodexExecutionRequestResolver,
} from './CodexExecutionBackend';
import {
  buildCodexTurnInput,
  buildCodexTurnParameters,
  type CodexAttachmentScratch,
  type CodexTurnImageAttachment,
  type CodexTurnInputBundle,
  resolveCodexServiceTier,
} from './CodexTurnInput';
import {
  buildCodexTurnSandboxPolicy,
  resolveCodexPermissionMode,
} from './CodexTurnSandboxPolicy';

/**
 * What one turn decided, held while the kernel carries a reference to it.
 *
 * Only the turn's own choices live here. Everything ambient at dispatch — the
 * thread the conversation is bound to, the settings, the target the daemon runs
 * on — is read when the run is resolved, because a turn queued before any of
 * those changed must still be the turn the user would recognise.
 */
export interface CodexExecutionRequest {
  readonly prompt: string;
  readonly text: string;
  readonly images?: readonly CodexTurnImageAttachment[];
  readonly isCompact: boolean;
  readonly externalContextPaths: readonly string[];
  readonly orchestratorMode: boolean;
  /** The model the send-time selector named, if it named one. */
  readonly model?: string;
  /** Replayed into the prompt only where the thread cannot have it already. */
  readonly history?: readonly ChatMessage[];
  /**
   * The conversation this turn belongs to, read at dispatch.
   *
   * A getter and not a value, because one store serves every tab: the binding
   * belongs to the tab that queued the turn, and it can be bound to a thread
   * between the send and the dispatch by the turn before it.
   */
  readonly conversation?: () => BoundConversation | null;
  /**
   * The tab this turn belongs to.
   *
   * One store serves every tab, and a turn's scratch directory is freed when
   * *that tab* starts its next turn — never when another tab starts one, whose
   * daemon is still reading the pictures this one was given.
   */
  readonly scope?: string;
}

export interface CodexInvocationEnvironment {
  /** The provider-projected settings snapshot, read at dispatch. */
  readonly settings: Record<string, unknown>;
  readonly launchSpec: CodexLaunchSpec;
  /**
   * The thread's system prompt.
   *
   * A function of the turn's mode, because the orchestrator rules belong in the
   * base instructions of a thread started for an orchestrator turn.
   */
  baseInstructions(orchestratorMode: boolean): string;
  listSkills(): Promise<readonly SkillMetadata[]>;
  readonly transcriptRootTarget?: string | null;
  readonly memoriesDirTarget?: string | null;
  readonly scratch?: CodexAttachmentScratch;
}

/** How many un-dispatched turns may accumulate before the oldest is dropped. */
const DEFAULT_LIMIT = 64;

/** How many unread refusals to keep; each is read by the terminal after it. */
const REFUSAL_LIMIT = 8;

/**
 * References the kernel can carry, and the turns behind them.
 *
 * A reference is a minted identifier and nothing else: core carries references,
 * not provider payloads, and the registry refuses anything that is not a
 * constrained identifier. In memory on purpose — a reference that outlived a
 * restart would promise a re-dispatch nobody can honour, and an unresolvable one
 * becomes `pre-dispatch-rejected`, which is the honest answer.
 */
export class CodexExecutionRequests implements CodexExecutionRequestResolver {
  private readonly pending = new Map<string, CodexExecutionRequest>();
  /**
   * The scratch directories of turns already dispatched, per tab.
   *
   * Freed when that tab dispatches its next turn, because the daemon reads the
   * images while the turn runs and nothing here observes when it ends — the
   * same rule the legacy runtime followed, which cleared its bundles at the
   * start of each query. Steering adds to the set instead of replacing it: it
   * joins a turn that is still being answered from those files.
   */
  private readonly liveBundles = new Map<string, CodexTurnInputBundle[]>();
  /**
   * Why a turn was refused before it was dispatched, by the reference it was
   * refused under.
   *
   * The kernel classifies a rejection rather than carrying a provider's string,
   * which is right — but it leaves the only sentence a user can act on inside
   * the throw that caused it. This is where the tab reads it back, and it is
   * kept per reference so the tab that asks gets the refusal of the turn it
   * queued. Bounded, and small: a refusal not read by the terminal that follows
   * it will never be read.
   */
  private readonly refusals = new Map<string, string>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<CodexInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  /** Holds a turn and returns the reference the kernel will carry. */
  reference(request: CodexExecutionRequest): string {
    // Bounded because a turn rejected before dispatch never comes back for its
    // request, and an unbounded map of prompts is a leak made of the most
    // sensitive thing this provider handles.
    while (this.pending.size >= this.limit) {
      const oldest = this.pending.keys().next();
      if (oldest.done) {
        break;
      }
      this.pending.delete(oldest.value);
    }
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<CodexExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    const binding = readCodexConversationBinding(request.conversation?.() ?? null);
    const settings = environment.settings;
    const model = request.model
      ?? (typeof settings.model === 'string' ? settings.model : undefined);
    const permission = resolveCodexPermissionMode(settings.permissionMode);
    const serviceTier = resolveCodexServiceTier(
      settings.serviceTier,
      model ?? DEFAULT_CODEX_PRIMARY_MODEL,
    );
    const launchParams = {
      model: model ?? DEFAULT_CODEX_PRIMARY_MODEL,
      approvalPolicy: permission.approvalPolicy,
      sandbox: permission.sandbox,
      serviceTier,
      baseInstructions: environment.baseInstructions(request.orchestratorMode),
      experimentalRawEvents: true,
      persistExtendedHistory: true,
    };
    const start: ThreadStartParams = { ...launchParams, cwd: environment.launchSpec.targetCwd };
    const resume: Omit<ThreadResumeParams, 'threadId'> = launchParams;
    const thread = toCodexThreadIntent(binding, { start, resume });

    if (request.isCompact) {
      // The legacy runtime refused this locally rather than sending it: the
      // daemon compacts a thread, it does not read an argument, so `/compact
      // please` would silently compact and lose the instruction.
      if (request.text.trim() !== '/compact') {
        throw this.refuse(requestRef, '/compact does not accept arguments');
      }
      return { thread, turn: { kind: 'compact' } };
    }

    const bundle = buildCodexTurnInput({
      text: replayedPrompt(request, binding),
      images: request.images,
      skills: await resolveSkillInputs(request.text, environment),
      toTargetPath: hostPath => environment.launchSpec.pathMapper.toTargetPath(hostPath),
      ...(environment.scratch ? { scratch: environment.scratch } : {}),
    });
    this.retainBundle(request, bundle, 'replaces-the-previous-turn');

    const parameters = buildCodexTurnParameters({
      settings,
      model,
      orchestratorMode: request.orchestratorMode,
      // The backend decides for itself whether a bound thread still needs
      // resuming, so this cannot know whether base instructions went out with
      // it. It answers "not yet" on purpose: the cost of being wrong is the
      // worker-plan rules stated twice, and the cost the other way is a turn
      // that never states them at all.
      baseInstructionsAlreadySent: false,
    });

    // Computed once. Called twice it was also *decided* twice, which for a
    // sandbox policy is a question that must have one answer per turn.
    const sandboxPolicy = sandboxPolicyFor(request, environment, permission.sandbox);
    return {
      thread,
      turn: {
        kind: 'start',
        params: {
          input: bundle.input,
          approvalPolicy: permission.approvalPolicy,
          model: parameters.model,
          serviceTier: parameters.serviceTier,
          effort: parameters.effort,
          summary: parameters.summary,
          collaborationMode: parameters.collaborationMode,
          ...(sandboxPolicy ? { sandboxPolicy } : {}),
        },
      },
    };
  }

  /**
   * Input for a turn that is already running.
   *
   * No thread, no parameters: the turn was launched with those, and the user is
   * adding to it rather than starting it again.
   */
  async resolveSteer(requestRef: string): Promise<readonly UserInput[]> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    const bundle = buildCodexTurnInput({
      text: request.prompt,
      images: request.images,
      skills: await resolveSkillInputs(request.text, environment),
      toTargetPath: hostPath => environment.launchSpec.pathMapper.toTargetPath(hostPath),
      ...(environment.scratch ? { scratch: environment.scratch } : {}),
    });
    this.retainBundle(request, bundle, 'joins-the-running-turn');
    return bundle.input;
  }

  /**
   * Discards what a tab was holding, when that tab is gone.
   *
   * The legacy runtime freed a turn's images when the tab's runtime cleaned up;
   * without this they wait for the tab's next turn, which a closed tab never
   * has, or for unload.
   */
  releaseScope(scope: string): void {
    for (const bundle of this.liveBundles.get(scope) ?? []) {
      bundle.cleanup();
    }
    this.liveBundles.delete(scope);
  }

  /** Discards every scratch directory still held; the plugin's unload calls it. */
  dispose(): void {
    for (const bundles of this.liveBundles.values()) {
      for (const bundle of bundles) {
        bundle.cleanup();
      }
    }
    this.liveBundles.clear();
    this.pending.clear();
  }

  /** Test and diagnostic view of how many turns are still waiting. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * The wording a refused turn was refused with, if this reference has one.
   *
   * Read once: the terminal it explains happens once, and holding the sentence
   * afterwards would let the next rejection of any kind inherit it.
   */
  refusalFor(requestRef: string | undefined): string | undefined {
    if (requestRef === undefined) {
      return undefined;
    }
    const refusal = this.refusals.get(requestRef);
    this.refusals.delete(requestRef);
    return refusal;
  }

  private refuse(requestRef: string, message: string): Error {
    while (this.refusals.size >= REFUSAL_LIMIT) {
      const oldest = this.refusals.keys().next();
      if (oldest.done) {
        break;
      }
      this.refusals.delete(oldest.value);
    }
    this.refusals.set(requestRef, message);
    return new Error(message);
  }

  private take(requestRef: string): CodexExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Codex request reference is unknown.');
    }
    this.pending.delete(requestRef);
    return request;
  }

  private retainBundle(
    request: CodexExecutionRequest,
    bundle: CodexTurnInputBundle,
    retention: 'replaces-the-previous-turn' | 'joins-the-running-turn',
  ): void {
    // Turns without a tab share one slot, which is what a caller that does not
    // say which tab it is asking for has told us it wants.
    const scope = request.scope ?? '';
    const held = this.liveBundles.get(scope) ?? [];
    if (retention === 'replaces-the-previous-turn') {
      for (const previous of held.splice(0)) {
        previous.cleanup();
      }
    }
    held.push(bundle);
    this.liveBundles.set(scope, held);
  }
}

function sandboxPolicyFor(
  request: CodexExecutionRequest,
  environment: CodexInvocationEnvironment,
  sandboxMode: string,
): ReturnType<typeof buildCodexTurnSandboxPolicy> {
  const launchSpec = environment.launchSpec;
  return buildCodexTurnSandboxPolicy({
    sandboxMode,
    externalContextPaths: [...new Set(request.externalContextPaths
      .filter(value => typeof value === 'string' && value.trim().length > 0))],
    transcriptRootTarget: environment.transcriptRootTarget,
    target: {
      workspaceRoot: launchSpec.targetCwd,
      toTargetPath: hostPath => (hostPath ? launchSpec.pathMapper.toTargetPath(hostPath) : null),
      posixTarget: launchSpec.target.platformFamily === 'unix',
      remoteTarget: launchSpec.target.method === 'wsl',
      memoriesDirTarget: environment.memoriesDirTarget,
    },
  });
}

/**
 * The prompt, with whatever the thread cannot already know.
 *
 * A thread that is being started has read nothing, and a fork has read only up
 * to its checkpoint; a thread that is merely being resumed holds the whole
 * conversation, and replaying it there would hand the model everything twice.
 */
function replayedPrompt(
  request: CodexExecutionRequest,
  binding: CodexConversationBinding,
): string {
  const history = [...(request.history ?? [])];
  if (binding.kind === 'thread' || history.length === 0) {
    return request.prompt;
  }

  const replayed = binding.kind === 'fork'
    ? history.slice(forkCheckpointIndex(history, binding.resumeAtTurnId) + 1)
    : history;
  if (replayed.length === 0) {
    return request.prompt;
  }

  const context = buildContextFromHistory(replayed);
  return context.trim() ? `${context}\n\nUser: ${request.prompt}` : request.prompt;
}

function forkCheckpointIndex(history: readonly ChatMessage[], resumeAtTurnId: string): number {
  // `-1` where the checkpoint is not in this history: everything after "nothing"
  // is the whole of it, which is the honest reading of a fork whose point the
  // conversation no longer shows.
  return history.findIndex(message => message.assistantMessageId === resumeAtTurnId);
}

async function resolveSkillInputs(
  text: string,
  environment: CodexInvocationEnvironment,
): Promise<SkillInput[]> {
  const names = extractExplicitCodexSkillNames(text);
  if (names.length === 0) {
    return [];
  }

  try {
    const skills = await environment.listSkills();
    const resolved: SkillInput[] = [];
    for (const name of names) {
      const skill = findPreferredCodexSkillByName([...skills], name);
      if (skill) {
        resolved.push({ type: 'skill', name: skill.name, path: skill.path });
      }
    }
    return resolved;
  } catch {
    // A skill listing that failed is not a turn that should fail: the legacy
    // runtime sent the prompt without them, and the mention stays in the text.
    return [];
  }
}
