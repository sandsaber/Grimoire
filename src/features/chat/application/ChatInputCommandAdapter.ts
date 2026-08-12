import type { ExecutionBackendId } from '../../../core/execution/ExecutionBackendDescriptor';
import type { ResultExpectation } from '../../../core/execution/ExecutionContracts';
import type { ChatMessage } from '../../../core/types';
import type {
  ChatExecutionCoordinator,
  ChatTurnTicket,
} from './ChatExecutionCoordinator';

export interface ChatInputCommand {
  readonly conversationId: string;
  readonly backendId: ExecutionBackendId;
  readonly requestRef: string;
  readonly resultExpectation: ResultExpectation;
  readonly userMessage: ChatMessage;
}

export class ChatInputCommandAdapter {
  constructor(
    private readonly coordinator: Pick<ChatExecutionCoordinator, 'submitTurn'>,
    private readonly nextCommandId: () => string,
  ) {}

  submit(command: ChatInputCommand): Promise<ChatTurnTicket> {
    return this.coordinator.submitTurn({
      ...command,
      commandId: this.nextCommandId(),
    });
  }
}
