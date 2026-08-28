import type { ProviderCapabilities, ProviderId } from '../providers/types';
import type { ChatMessage, Conversation, SlashCommand, StreamChunk, ToolCallInfo } from '../types';
import type {
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
} from './types';

export interface ChatRuntime {
  readonly providerId: ProviderId;

  getCapabilities(): Readonly<ProviderCapabilities>;
  prepareTurn(request: ChatTurnRequest): PreparedChatTurn;
  onReadyStateChange(listener: (ready: boolean) => void): () => void;
  setResumeCheckpoint(checkpointId: string | undefined): void;
  /**
   * `externalContextPaths` was a second parameter here and is deleted.
   *
   * The adapter never took it — a method with fewer parameters is assignable to
   * one with more, so three call sites passed it and it went nowhere, and the
   * member-coverage gate could not see that because names matched. It is not
   * missing on this path: a turn carries its own `externalContextPaths` in the
   * request, which is what the compositions read.
   */
  syncConversationState(conversation: ChatRuntimeConversationState | null): void;
  reloadMcpServers(): Promise<void>;
  reloadWorkspaceResources?(): Promise<void>;
  ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean>;
  query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk>;
  steer?(turn: PreparedChatTurn): Promise<boolean>;
  cancel(): void;
  resetSession(): void;
  getSessionId(): string | null;
  consumeSessionInvalidation(): boolean;
  isReady(): boolean;
  getSupportedCommands(): Promise<SlashCommand[]>;
  getAuxiliaryModel?(): string | null;
  /**
   * `void` until the seam deletion typed the tab's runtime as the adapter.
   *
   * The adapter has always been `async cleanup(): Promise<void>` — it cancels,
   * waits, then disposes — and a narrower return type is assignable to a wider
   * one, so this said `void` while eight call sites discarded a real promise.
   * Six already marked it `void` deliberately; the two that did not were doing
   * the same thing without saying so.
   */
  cleanup(): Promise<void>;
  rewind(userMessageId: string, assistantMessageId: string, mode?: ChatRewindMode): Promise<ChatRewindResult>;
  // The five interaction callbacks and the two observation hooks were declared
  // here and stored by the adapter, which is what made them a seam rather than
  // a runtime capability: nothing on this interface ever acted on one. They are
  // `ExecutionChatRuntimeAdapter.installInteractions`, in a single call the
  // surface makes once, off the frozen contract.
  setAutoTurnCallback(callback: AutoTurnCallback | null): void;
  consumeTurnMetadata(): ChatTurnMetadata;

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult;

  resolveSessionIdForFork(conversation: Conversation | null): string | null;

  loadSubagentToolCalls?(agentId: string): Promise<ToolCallInfo[]>;
  loadSubagentFinalResult?(agentId: string): Promise<string | null>;
}
