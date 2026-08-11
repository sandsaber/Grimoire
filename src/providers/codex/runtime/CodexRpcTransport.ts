import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';

import type { JsonRpcError } from './codexAppServerTypes';

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: number | null;
}

type NotificationHandler = (params: unknown) => void;
type ServerRequestHandler = (requestId: string | number, params: unknown) => Promise<unknown>;
type ConnectionLostHandler = (error: Error) => void;

export interface CodexRpcProcessPort {
  readonly stdin: Writable;
  readonly stdout: Readable;
  onExit(callback: (code: number | null, signal: string | null, error?: Error) => void): void;
}

export class CodexRpcTransport {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private connectionLostHandlers = new Set<ConnectionLostHandler>();
  private disposed = false;
  private disposeError: Error | null = null;

  constructor(private readonly proc: CodexRpcProcessPort) {}

  start(): void {
    const rl = createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this.handleLine(line));
    this.proc.stdin.on('error', this.handleStdinError);

    this.proc.onExit((_code, _signal, error) => {
      this.fail(error ?? new Error('App-server process exited'));
    });
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    // Fail fast rather than queueing a request the dead process can never
    // answer — otherwise the caller waits out the full timeout.
    if (this.disposed) {
      return Promise.reject(
        this.disposeError ?? new Error('App-server transport is closed'),
      );
    }

    const id = this.nextId++;
    const msg = { jsonrpc: '2.0' as const, id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? window.setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs)
        : null;

      const resolvePending = (result: unknown): void => {
        resolve(result as T);
      };

      this.pending.set(id, {
        resolve: resolvePending,
        reject,
        timer,
      });

      this.sendRaw(msg);
    });
  }

  notify(method: string, params?: unknown): void {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    this.sendRaw(msg);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  onServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }

  onConnectionLost(handler: ConnectionLostHandler): () => void {
    this.connectionLostHandlers.add(handler);
    return () => this.connectionLostHandlers.delete(handler);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeError = new Error('Transport disposed');
    this.rejectAllPending(this.disposeError);
    this.connectionLostHandlers.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private sendRaw(msg: unknown): void {
    if (this.disposed) return;
    try {
      this.proc.stdin.write(JSON.stringify(msg) + '\n', error => {
        if (error) {
          this.fail(error);
        }
      });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private readonly handleStdinError = (error: Error): void => {
    this.fail(error);
  };

  private fail(error: Error): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeError = error;
    this.rejectAllPending(error);
    for (const handler of this.connectionLostHandlers) {
      handler(error);
    }
    this.connectionLostHandlers.clear();
  }

  private handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // malformed line
    }

    const id = msg.id as string | number | undefined;
    const method = msg.method as string | undefined;

    // Server response to our request
    if (typeof id === 'number' && !method) {
      this.handleResponse(id, msg);
      return;
    }

    // Server notification (no id, has method)
    if (method && id === undefined) {
      this.handleNotification(method, msg.params);
      return;
    }

    // Server-initiated request (has both id and method)
    if (method && id !== undefined) {
      this.handleServerRequest(id, method, msg.params);
      return;
    }
  }

  private handleResponse(id: number, msg: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    if (pending.timer) window.clearTimeout(pending.timer);

    if (msg.error) {
      const err = msg.error as JsonRpcError;
      pending.reject(new Error(err.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const handler = this.notificationHandlers.get(method);
    if (handler) handler(params);
  }

  private handleServerRequest(id: string | number, method: string, params: unknown): void {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) {
      this.sendRaw({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unhandled server request: ${method}` },
      });
      return;
    }

    handler(id, params).then(
      (result) => {
        this.sendRaw({ jsonrpc: '2.0', id, result });
      },
      (err) => {
        this.sendRaw({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
        });
      },
    );
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
