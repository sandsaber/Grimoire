import type { Unsubscribe } from '@/core/execution/ExecutionContracts';
import type {
  AcpListSessionsRequest,
  AcpListSessionsResponse,
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
  setConfigOption(
    request: AcpSetSessionConfigOptionRequest,
  ): Promise<AcpSetSessionConfigOptionResponse>;
  /**
   * The two dedicated setters, where the agent has them.
   *
   * ACP defines both beside `session/set_config_option`, and which one an agent
   * answers is a property of its release rather than of the protocol — Grok has
   * them and refuses the mode on a build that carries its policy on the command
   * line. A provider that only uses config options never calls these.
   */
  setMode(request: AcpSetSessionModeRequest): Promise<AcpSetSessionModeResponse>;
  setModel(request: AcpSetSessionModelRequest): Promise<AcpSetSessionModelResponse>;
  /**
   * A request under the agent's own method name, where it has one.
   *
   * The outbound half of `vendorSessionNotifications`: some agents answer
   * questions ACP has no method for — Grok's account billing is one — and the
   * alternative is launching a second process to ask. Optional, because most
   * agents have nothing to ask.
   */
  vendorRequest?(method: string, params: unknown): Promise<unknown>;
  /**
   * The sessions the agent still has, where it answers the question.
   *
   * Asked only after a `session/load` has already failed, to tell a session the
   * agent has forgotten from a load that failed for some other reason. Optional
   * because not every agent has the method — Gemini CLI does not — and an agent
   * that cannot answer leaves the failure classified by its error text alone.
   */
  listSessions?(request?: AcpListSessionsRequest): Promise<AcpListSessionsResponse>;
  cancel(sessionId: string): void;
  onSessionNotification(listener: (notification: AcpSessionNotification) => void): Unsubscribe;
  onConnectionLost(listener: (error?: Error) => void): Unsubscribe;
  close(): Promise<'confirmed' | 'unconfirmed'>;
}

export interface ManagedAcpClientFactoryInput {
  readonly startupRef: string;
  readonly signal: AbortSignal;
  readonly requestPermission: (
    request: AcpRequestPermissionRequest,
  ) => Promise<AcpRequestPermissionResponse>;
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
