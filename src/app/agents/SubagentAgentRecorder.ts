import { createHash, randomUUID } from 'node:crypto';

import type { AgentDefinitionSnapshot } from '@/core/agents/AgentContracts';
import type {
  AgentCoordinator,
  AgentDispatchPolicyInputs,
} from '@/core/agents/AgentCoordinator';
import {
  adoptedAgentInstanceId,
  agentResultId,
  agentRunId,
  nativeAgentAdoptionKey,
} from '@/core/agents/AgentIds';
import type { ProviderId } from '@/core/types/provider';

/**
 * Turns a provider's background subagent into an agent instance that outlives
 * the tab that saw it.
 *
 * **The one thing that knows both halves.** `SubagentManager` knows a provider
 * launched something and what it is called; the agent domain knows what a
 * durable agent is. Neither should learn the other, so this sits between them
 * and speaks only through the coordinator's commands.
 *
 * It records **observed** agents, never dispatched ones: Grimoire did not start
 * these, the provider did, and the record says so. Their root is the
 * conversation rather than another agent, which is the shape
 * `adoptNativeAgent` gained for exactly this.
 *
 * **Idempotent by construction.** A subagent's state changes many times and
 * this is called on each; the adoption key is derived from the provider's own
 * id for the agent, so the second call adopts the instance the first one made
 * rather than a second instance. The coordinator does that comparison — a
 * mismatched re-adoption is refused rather than silently accepted.
 *
 * **Nothing here cancels anything.** Recording that work exists is not the same
 * as taking ownership of stopping it, and the plan is explicit that tab close
 * keeps cancelling until the surface that shows durable work ships.
 */

export interface SubagentObservation {
  /** The provider's own id for the agent, and the only stable thing about it. */
  readonly nativeAgentRef: string;
  readonly conversationId: string;
  readonly providerId: ProviderId;
  /**
   * What it was asked to do, as the surface labels it.
   *
   * Free text, and **normalized before it is written**: a control record holds
   * a constrained identifier, and a description with a space in it is refused
   * at the write — the same shape as the dispatch rejection code the review
   * found, and the same answer. A caller crossing this boundary should not have
   * to know the record's rules.
   */
  readonly goal: string;
  readonly status: 'running' | 'completed' | 'error';
  /** What it answered, where it has answered. Never a prompt. */
  readonly resultText?: string;

}

export interface SubagentAgentRecorderOptions {
  readonly coordinator: AgentCoordinator;
  /** What this provider's agents are, as a definition the record can hold. */
  definitionFor(providerId: ProviderId): AgentDefinitionSnapshot;
  /** What an agent of this provider's is allowed to do. */
  policyFor(providerId: ProviderId): AgentDispatchPolicyInputs;
  readonly now?: () => number;
  /** Reports a recording that failed; never thrown at the caller. */
  report(error: unknown): void;
}

export class SubagentAgentRecorder {
  private readonly runs = new Map<string, ReturnType<typeof agentRunId>>();

  constructor(private readonly options: SubagentAgentRecorderOptions) {}

  /**
   * Records what a subagent is doing now.
   *
   * **Never throws.** A recording that fails must not take down the turn that
   * was drawing the subagent: the records are for surviving a tab, and a tab
   * that crashed because a record could not be written has survived nothing.
   */
  async observe(observation: SubagentObservation): Promise<void> {
    try {
      await this.record(observation);
    } catch (error) {
      this.options.report(error);
    }
  }

  private async record(observation: SubagentObservation): Promise<void> {
    const adoptionKey = nativeAgentAdoptionKey(
      `nad-${createHash('sha256').update(observation.nativeAgentRef).digest('hex').slice(0, 32)}`,
    );
    const instanceId = adoptedAgentInstanceId(adoptionKey);
    // Minted once per native agent and kept, because a result has to name the
    // run it belongs to and the provider never tells us that id.
    const runId = this.runs.get(observation.nativeAgentRef)
      ?? agentRunId(`agr-${randomUUID().replaceAll('-', '')}`);
    this.runs.set(observation.nativeAgentRef, runId);

    await this.options.coordinator.adoptNativeAgent({
      transactionId: this.transactionId(),
      terminalTransactionId: this.transactionId(),
      adoptionKey,
      agentRunId: runId,
      providerId: observation.providerId,
      definition: this.options.definitionFor(observation.providerId),
      rootOwner: { kind: 'conversation', ownerId: observation.conversationId },
      // **Detached, and that is the whole point of recording it.** An attached
      // agent is cancelled with its parent; these are the ones a person starts
      // and walks away from, and the record exists so walking away stops
      // meaning losing them.
      attachment: 'detached',
      observation: 'terminal-only',
      nativeAgentRef: observation.nativeAgentRef,
      goalRef: goalReference(observation.goal, observation.nativeAgentRef),
      policyInputs: this.options.policyFor(observation.providerId),
    });

    if (observation.status === 'running') {
      return;
    }
    const completedAt = (this.options.now ?? Date.now)();
    await this.options.coordinator.appendResult({
      agentResultId: agentResultId(`ares-${randomUUID().replaceAll('-', '')}`),
      agentInstanceId: instanceId,
      agentRunId: runId,
      status: observation.status === 'completed' ? 'succeeded' : 'failed',
      // The agent's own answer. Nothing else of what it saw: a prompt, its
      // reasoning and its raw payloads are what `.grimoire/control/**` may
      // never hold, and the payload guard on this store is what enforces it.
      ...(observation.resultText ? { finalText: observation.resultText } : {}),
      // **A code, not the message.** `AgentErrorSummary` carries a classification
      // rather than provider text, and that is the right shape for a control
      // record: the words belong in the result the surface shows, and a message
      // is where a prompt or a path would arrive in a store that may hold
      // neither. The provider's own wording, where it has any, is the result
      // text above.
      ...(observation.status === 'error'
        ? { error: { code: 'subagent-failed', retryable: true } }
        : {}),
      artifacts: [],
      changedFiles: [],
      citations: [],
      childResultIds: [],
      // The provider produced it and Grimoire watched: `provider-native`, and
      // `observedAt` rather than a claim about when the provider finished.
      provenance: {
        kind: 'provider-native',
        providerId: observation.providerId,
        observedAt: completedAt,
      },
      completedAt,
    });
    this.runs.delete(observation.nativeAgentRef);
  }

  private transactionId(): string {
    return `tx-${randomUUID().replaceAll('-', '')}`;
  }
}

/**
 * A goal a record can hold: the description slugged, and the agent's own id
 * behind it so two agents asked the same thing stay two agents.
 *
 * Not the description itself. `.grimoire/control/**` holds references, and a
 * description is free text a person wrote — which is where a path, a name or a
 * secret arrives in a store that may hold none of them.
 */
function goalReference(goal: string, nativeAgentRef: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = createHash('sha256').update(nativeAgentRef).digest('hex').slice(0, 8);
  return slug ? `${slug}-${suffix}` : `agent-${suffix}`;
}
