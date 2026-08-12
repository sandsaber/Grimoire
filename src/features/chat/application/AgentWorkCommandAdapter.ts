import type { AgentInstanceId } from '../../../core/agents/AgentIds';
import type {
  ExecutionOwner,
  InteractionResolution,
} from '../../../core/execution/ExecutionContracts';
import { interactionId } from '../../../core/execution/ExecutionIds';
import type {
  AgentWorkCardAction,
  AgentWorkCardProjection,
} from '../projections/AgentProjection';
import type { AgentProjectionCoordinator } from './AgentProjectionCoordinator';

export interface AgentWorkActionPort {
  cancel(agentInstanceId: AgentInstanceId): Promise<void>;
  retry(agentInstanceId: AgentInstanceId): Promise<void>;
  focus(agentInstanceId: AgentInstanceId): void;
  inspectResults(agentInstanceId: AgentInstanceId): void;
  resolveInteraction(resolution: InteractionResolution): Promise<void>;
}

export interface AgentWorkActionCommand {
  readonly owner: ExecutionOwner;
  readonly agentInstanceId: AgentInstanceId;
  readonly action: AgentWorkCardAction;
}

export interface AgentInteractionResponseCommand {
  readonly owner: ExecutionOwner;
  readonly agentInstanceId: AgentInstanceId;
  readonly agentRunId: string;
  readonly interactionId: string;
  readonly responseId: string;
}

export class AgentWorkCommandAdapter {
  constructor(
    private readonly projections: Pick<AgentProjectionCoordinator, 'load' | 'setExpanded'>,
    private readonly actions: AgentWorkActionPort,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(command: AgentWorkActionCommand): Promise<void> {
    const view = await this.projections.load(command.owner);
    const card = findCard(view.agentCards, command.agentInstanceId);
    if (!card || !card.actions.includes(command.action)) {
      throw new Error('Agent work action is unavailable for the current durable state.');
    }
    switch (command.action) {
      case 'cancel':
        await this.actions.cancel(command.agentInstanceId);
        return;
      case 'retry':
        await this.actions.retry(command.agentInstanceId);
        return;
      case 'focus':
        this.actions.focus(command.agentInstanceId);
        return;
      case 'inspect-results':
        this.actions.inspectResults(command.agentInstanceId);
        return;
      case 'expand-children':
        this.projections.setExpanded(command.owner, command.agentInstanceId, true);
        return;
      case 'collapse-children':
        this.projections.setExpanded(command.owner, command.agentInstanceId, false);
        return;
    }
  }

  async resolveInteraction(command: AgentInteractionResponseCommand): Promise<void> {
    const view = await this.projections.load(command.owner);
    const card = findCard(view.agentCards, command.agentInstanceId);
    const attempt = card?.attempts.find(candidate => candidate.agentRunId === command.agentRunId);
    const interaction = attempt?.interactions.find(candidate => (
      candidate.interactionId === command.interactionId
    ));
    if (!interaction
      || interaction.status !== 'open'
      || !interaction.responseIds.includes(command.responseId)) {
      throw new Error('Agent interaction response is unavailable for the current durable state.');
    }
    await this.actions.resolveInteraction({
      interactionId: interactionId(command.interactionId),
      responseId: command.responseId,
      resolvedAt: this.now(),
    });
  }
}

function findCard(
  cards: readonly AgentWorkCardProjection[],
  agentInstanceId: AgentInstanceId,
): AgentWorkCardProjection | undefined {
  for (const card of cards) {
    if (card.agentInstanceId === agentInstanceId) return card;
    const child = findCard(card.children, agentInstanceId);
    if (child) return child;
  }
  return undefined;
}
