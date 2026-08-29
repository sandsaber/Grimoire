import type { BrowserSelectionContext } from '../../utils/browser';
import type { CanvasSelectionContext } from '../../utils/canvas';
import type { EditorSelectionContext } from '../../utils/editor';
import type { ContextSnippet, ProjectWorkspace } from '../context/types';
import type {
  ApprovalDecision,
  Conversation,
  ExitPlanModeCallback,
  ImageAttachment,
  StreamChunk,
} from '../types';

export interface ApprovalDecisionOption {
  label: string;
  description?: string;
  value: string;
  decision?: ApprovalDecision;
  /** Provider-neutral UI semantics; does not change the value returned to the provider. */
  presentation?: 'allow' | 'always' | 'reject' | 'other';
}

export interface ApprovalNetworkContext {
  host: string;
  protocol: string;
}

export interface ApprovalCallbackOptions {
  decisionReason?: string;
  blockedPath?: string;
  /** Exact resource affected by the request when it is not already represented by blockedPath. */
  target?: string;
  agentID?: string;
  decisionOptions?: ApprovalDecisionOption[];
  networkApprovalContext?: ApprovalNetworkContext;
  additionalPermissions?: unknown;
}

export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string,
  options?: ApprovalCallbackOptions,
) => Promise<ApprovalDecision>;

export type AskUserQuestionCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, string | string[]> | null>;

export interface VaultSearchTurnContext {
  query: string;
  snippets: ContextSnippet[];
}

export interface ProjectWorkspaceTurnContext {
  workspace: ProjectWorkspace;
}

export interface ChatTurnRequest {
  text: string;
  images?: ImageAttachment[];
  currentNotePath?: string;
  editorSelection?: EditorSelectionContext | null;
  browserSelection?: BrowserSelectionContext | null;
  canvasSelection?: CanvasSelectionContext | null;
  externalContextPaths?: string[];
  contextFiles?: string[];
  excludedFolders?: string[];
  vaultSearchContext?: VaultSearchTurnContext;
  projectWorkspaceContext?: ProjectWorkspaceTurnContext;
  enabledMcpServers?: Set<string>;
  orchestratorMode?: boolean;
}

export interface PreparedChatTurn {
  request: ChatTurnRequest;
  persistedContent: string;
  prompt: string;
  isCompact: boolean;
  mcpMentions: Set<string>;
}

export interface ChatRuntimeQueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
  orchestratorMode?: boolean;
}

export interface ChatRuntimeEnsureReadyOptions {
  allowSessionCreation?: boolean;
  force?: boolean;
  orchestratorMode?: boolean;
}

export type ChatRuntimeConversationState = Pick<
  Conversation,
  'sessionId' | 'providerState'
>;

export interface ChatRewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

export type ChatRewindMode = 'conversation' | 'code-and-conversation';

export interface SubagentRuntimeState {
  hasRunning: boolean;
}

export interface ChatTurnMetadata {
  userMessageId?: string;
  assistantMessageId?: string;
  wasSent?: boolean;
  planCompleted?: boolean;
}

export interface AutoTurnResult {
  chunks: StreamChunk[];
  metadata: ChatTurnMetadata;
}

export type AutoTurnCallback = (result: AutoTurnResult) => void | Promise<void>;

export type {
  ApprovalDecision,
  ExitPlanModeCallback,
};
