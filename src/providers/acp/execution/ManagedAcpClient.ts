import type { Unsubscribe } from '@/core/execution/ExecutionContracts';
import type {
  AcpAskUserQuestionRequest,
  AcpAskUserQuestionResponse,
  AcpLoadSessionRequest,
  AcpLoadSessionResponse,
  AcpNewSessionRequest,
  AcpNewSessionResponse,
  AcpPromptRequest,
  AcpPromptResponse,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionNotification,
  AcpSetSessionConfigOptionRequest,
  AcpSetSessionConfigOptionResponse,
  AcpSetSessionModelRequest,
  AcpSetSessionModelResponse,
  AcpSetSessionModeRequest,
  AcpSetSessionModeResponse,
} from '@/providers/acp/types';

/** An owned protocol connection; provider execution policy stays outside this contract. */
export interface ManagedAcpClient {
  initialize(): Promise<void>;
  newSession(request: AcpNewSessionRequest): Promise<AcpNewSessionResponse>;
  loadSession(request: AcpLoadSessionRequest): Promise<AcpLoadSessionResponse>;
  prompt(request: AcpPromptRequest): Promise<AcpPromptResponse>;
  setMode?(
    request: AcpSetSessionModeRequest,
  ): Promise<AcpSetSessionModeResponse>;
  setModel?(
    request: AcpSetSessionModelRequest,
  ): Promise<AcpSetSessionModelResponse>;
  setConfigOption(
    request: AcpSetSessionConfigOptionRequest,
  ): Promise<AcpSetSessionConfigOptionResponse>;
  cancel(sessionId: string): void;
  onSessionNotification(listener: (notification: AcpSessionNotification) => void): Unsubscribe;
  onExtensionNotification?(
    methods: readonly string[],
    listener: (method: string, params: unknown) => void,
  ): Unsubscribe;
  requestExtension?(method: string, params: unknown): Promise<unknown>;
  onConnectionLost(listener: (error?: Error) => void): Unsubscribe;
  close(): Promise<'confirmed' | 'unconfirmed'>;
}

export interface ManagedAcpClientFactoryInput {
  readonly startupRef: string;
  readonly signal: AbortSignal;
  readonly requestPermission: (
    request: AcpRequestPermissionRequest,
  ) => Promise<AcpRequestPermissionResponse>;
  readonly askUserQuestion?: (
    request: AcpAskUserQuestionRequest,
  ) => Promise<AcpAskUserQuestionResponse>;
}

export interface ManagedAcpClientFactory {
  create(input: ManagedAcpClientFactoryInput): Promise<ManagedAcpClient>;
  dispose?(): Promise<'confirmed' | 'unconfirmed'>;
}

export class ManagedAcpTerminationUnconfirmedError extends Error {
  constructor(message = 'Managed ACP process termination was not confirmed.') {
    super(message);
    this.name = 'ManagedAcpTerminationUnconfirmedError';
  }
}
