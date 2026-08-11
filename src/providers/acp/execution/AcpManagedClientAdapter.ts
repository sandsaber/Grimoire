import {
  AcpClientConnection,
  type AcpClientConnectionDelegate,
} from '../AcpClientConnection';
import { AcpJsonRpcTransport } from '../AcpJsonRpcTransport';
import type { AcpImplementation } from '../types';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from './ManagedAcpClient';

export interface AcpManagedOwnedProcess {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  onClose(listener: (error?: Error) => void): () => void;
  terminate(): Promise<'confirmed' | 'unconfirmed'>;
}

export interface AcpManagedProcessLauncher {
  launch(startupRef: string, signal: AbortSignal): Promise<AcpManagedOwnedProcess>;
  dispose?(): Promise<'confirmed' | 'unconfirmed'>;
}

export interface AcpManagedClientAdapterOptions {
  readonly clientInfo: AcpImplementation;
  readonly delegate?: Omit<AcpClientConnectionDelegate, 'requestPermission'>;
  readonly processLauncher: AcpManagedProcessLauncher;
}

/**
 * Protocol-generic composition of an owned process, JSON-RPC transport, and
 * ACP client. Provider launch specs remain behind the opaque startupRef.
 */
export class AcpManagedClientAdapterFactory implements ManagedAcpClientFactory {
  constructor(private readonly options: AcpManagedClientAdapterOptions) {}

  async create(input: ManagedAcpClientFactoryInput): Promise<ManagedAcpClient> {
    const process = await this.options.processLauncher.launch(input.startupRef, input.signal);
    try {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error('Managed ACP startup aborted.');
      }
      const transport = new AcpJsonRpcTransport({
        input: process.input,
        output: process.output,
        onClose: listener => process.onClose(listener),
      });
      const connection = new AcpClientConnection({
        clientInfo: this.options.clientInfo,
        delegate: {
          ...this.options.delegate,
          ...(input.askUserQuestion ? { askUserQuestion: input.askUserQuestion } : {}),
          requestPermission: input.requestPermission,
        },
        transport,
      });
      transport.start();
      return new AcpManagedClientAdapter(process, transport, connection);
    } catch (error) {
      await process.terminate();
      throw error;
    }
  }

  dispose(): Promise<'confirmed' | 'unconfirmed'> {
    return this.options.processLauncher.dispose?.() ?? Promise.resolve('confirmed');
  }
}

class AcpManagedClientAdapter implements ManagedAcpClient {
  private closeTask?: Promise<'confirmed' | 'unconfirmed'>;

  constructor(
    private readonly process: AcpManagedOwnedProcess,
    private readonly transport: AcpJsonRpcTransport,
    private readonly connection: AcpClientConnection,
  ) {}

  async initialize(): Promise<void> {
    await this.connection.initialize();
  }

  newSession(request: Parameters<ManagedAcpClient['newSession']>[0]) {
    return this.connection.newSession(request);
  }

  loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    return this.connection.loadSession(request);
  }

  prompt(request: Parameters<ManagedAcpClient['prompt']>[0]) {
    return this.connection.prompt(request);
  }

  setMode(request: Parameters<NonNullable<ManagedAcpClient['setMode']>>[0]) {
    return this.connection.setMode(request);
  }

  setModel(request: Parameters<NonNullable<ManagedAcpClient['setModel']>>[0]) {
    return this.connection.setModel(request);
  }

  setConfigOption(request: Parameters<ManagedAcpClient['setConfigOption']>[0]) {
    return this.connection.setConfigOption(request);
  }

  cancel(sessionId: string): void {
    this.connection.cancel({ sessionId });
  }

  onSessionNotification(listener: Parameters<ManagedAcpClient['onSessionNotification']>[0]) {
    return this.connection.onSessionNotification(listener);
  }

  onExtensionNotification(
    methods: readonly string[],
    listener: (method: string, params: unknown) => void,
  ) {
    const unsubscribe = methods.map(method => this.transport.onNotification(
      method,
      params => listener(method, params),
    ));
    return () => unsubscribe.splice(0).forEach(remove => remove());
  }

  requestExtension(method: string, params: unknown): Promise<unknown> {
    return this.transport.request(method, params);
  }

  onConnectionLost(listener: Parameters<ManagedAcpClient['onConnectionLost']>[0]) {
    return this.transport.onClose(listener);
  }

  close(): Promise<'confirmed' | 'unconfirmed'> {
    if (this.closeTask) return this.closeTask;
    this.connection.dispose();
    this.transport.dispose();
    const task = this.process.terminate();
    this.closeTask = task;
    void task.then((outcome) => {
      if (outcome === 'unconfirmed' && this.closeTask === task) {
        this.closeTask = undefined;
      }
    });
    return this.closeTask;
  }
}
