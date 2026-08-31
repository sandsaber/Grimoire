import { createInterface, type Interface } from 'node:readline';

import type { AcpRequestId } from './types';

const DEFAULT_TIMEOUT_MS = 30_000;

interface JsonRpcRequestMessage {
  id: AcpRequestId;
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcNotificationMessage {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcResponseMessage {
  error?: {
    code: number;
    data?: unknown;
    message: string;
  };
  id: AcpRequestId;
  jsonrpc: '2.0';
  result?: unknown;
}

type JsonRpcMessage =
  | JsonRpcRequestMessage
  | JsonRpcNotificationMessage
  | JsonRpcResponseMessage;

export interface JsonRpcMessageStreams {
  input: NodeJS.ReadableStream;
  onClose?: (listener: (error?: Error) => void) => () => void;
  output: NodeJS.WritableStream;
}

export interface JsonRpcRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type JsonRpcNotificationHandler = (params: unknown) => void | Promise<void>;
type JsonRpcRequestHandler = (params: unknown) => Promise<unknown>;

interface PendingRequest {
  cleanup: () => void;
  method: string;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
}

export class JsonRpcTransportClosedError extends Error {
  constructor(message = 'JSON-RPC transport closed') {
    super(message);
    this.name = 'JsonRpcTransportClosedError';
  }
}

export class JsonRpcErrorResponse extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcErrorResponse';
  }
}

/**
 * A JSON-RPC code a request handler chose, rather than the internal error every
 * other failure answers with.
 *
 * Raised by the client's own handlers where the protocol has a word for what
 * happened — a file that is not there is `-32002 Resource not found`, and an
 * agent that reads it can go on to create the file. Without it every refusal,
 * every missing path and every bug answer alike, and the agent has to guess.
 */
export class JsonRpcHandlerError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcHandlerError';
  }
}

/**
 * What a failed request handler answers the peer with.
 *
 * The message is read from anything that carries one rather than from
 * `instanceof Error`, which is false for an error raised in another realm — the
 * shape `node:fs` produces under Jest, and the difference between an agent
 * being told "no such file or directory" and being told "Internal error".
 */
function describeHandlerFailure(error: unknown): { code: number; message: string; data?: unknown } {
  if (error instanceof JsonRpcHandlerError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    };
  }
  const message = (error as { message?: unknown } | null)?.message;
  return {
    code: -32603,
    message: typeof message === 'string' && message.length > 0 ? message : 'Internal error',
  };
}

export class AcpJsonRpcTransport {
  private readonly abortController = new AbortController();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private disposed = false;
  /** Whether the output stream has asked us to wait before writing more. */
  private awaitingDrain = false;
  /** Lines written while it was waiting, in the order they were sent. */
  private readonly queuedWrites: string[] = [];
  private nextId = 1;
  private readonly notificationHandlers = new Map<string, Set<JsonRpcNotificationHandler>>();
  private readonly pending = new Map<number, PendingRequest>();
  private readline: Interface | null = null;
  private readonly requestHandlers = new Map<string, JsonRpcRequestHandler>();
  private readonly streamUnsubscribers: Array<() => void> = [];
  private terminalError: Error | null = null;
  private unregisterClose?: () => void;

  constructor(
    private readonly streams: JsonRpcMessageStreams,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isClosed(): boolean {
    return this.disposed;
  }

  start(): void {
    if (this.readline || this.disposed) {
      return;
    }

    this.readline = createInterface({
      crlfDelay: Infinity,
      input: this.streams.input,
    });
    this.readline.on('line', line => this.handleLine(line));
    this.readline.on('close', () => {
      if (!this.disposed) {
        this.dispose(new JsonRpcTransportClosedError('JSON-RPC input closed'));
      }
    });

    this.streamUnsubscribers.push(
      subscribeStreamEvent(this.streams.input, 'error', (error?: unknown) => {
        if (!this.disposed) {
          this.dispose(error instanceof Error
            ? error
            : new JsonRpcTransportClosedError('JSON-RPC input error'));
        }
      }),
      subscribeStreamEvent(this.streams.output, 'close', () => {
        if (!this.disposed) {
          this.dispose(new JsonRpcTransportClosedError('JSON-RPC output closed'));
        }
      }),
      subscribeStreamEvent(this.streams.output, 'error', (error?: unknown) => {
        if (!this.disposed) {
          this.dispose(error instanceof Error
            ? error
            : new JsonRpcTransportClosedError('JSON-RPC output error'));
        }
      }),
    );

    this.unregisterClose = this.streams.onClose?.((error) => {
      if (!this.disposed) {
        this.dispose(error ?? new JsonRpcTransportClosedError());
      }
    });
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  onNotification(method: string, handler: JsonRpcNotificationHandler): () => void {
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);

    return () => {
      const current = this.notificationHandlers.get(method);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.notificationHandlers.delete(method);
      }
    };
  }

  onRequest(method: string, handler: JsonRpcRequestHandler): () => void {
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method);
      }
    };
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {},
  ): Promise<T> {
    this.start();

    if (this.disposed) {
      throw this.terminalError ?? new JsonRpcTransportClosedError();
    }

    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      let timer: number | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = (): void => {
        if (timer) window.clearTimeout(timer);
        if (onAbort && options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };
      const resolvePending = (result: unknown): void => {
        resolve(result as T);
      };

      const pending: PendingRequest = {
        cleanup,
        method,
        reject,
        resolve: resolvePending,
      };

      if (timeoutMs > 0) {
        timer = window.setTimeout(() => {
          this.pending.delete(id);
          cleanup();
          reject(new Error(`Request timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs);
      }

      if (options.signal) {
        if (options.signal.aborted) {
          cleanup();
          reject(new Error(`Request aborted: ${method}`));
          return;
        }
        onAbort = () => {
          this.pending.delete(id);
          cleanup();
          reject(new Error(`Request aborted: ${method}`));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(id, pending);

      try {
        this.sendRaw({ id, jsonrpc: '2.0', method, params });
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        const transportError = error instanceof Error ? error : new Error(String(error));
        this.dispose(transportError);
        reject(transportError);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.start();
    if (this.disposed) {
      return;
    }
    this.trySendRaw({ jsonrpc: '2.0', method, params });
  }

  dispose(error: Error = new JsonRpcTransportClosedError('JSON-RPC transport disposed')): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.terminalError = error;
    this.abortController.abort();

    this.unregisterClose?.();
    this.unregisterClose = undefined;

    while (this.streamUnsubscribers.length > 0) {
      this.streamUnsubscribers.pop()?.();
    }

    if (this.readline) {
      this.readline.removeAllListeners();
      this.readline.close();
      this.readline = null;
    }

    for (const [id, pending] of this.pending) {
      pending.cleanup();
      pending.reject(error);
      this.pending.delete(id);
    }

    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // Best-effort listener dispatch.
      }
    }
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) {
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if ('id' in message && !('method' in message)) {
      this.handleResponse(message);
      return;
    }
    if ('method' in message && 'id' in message) {
      this.handleRequest(message);
      return;
    }
    if ('method' in message) {
      this.handleNotification(message);
    }
  }

  private handleResponse(message: JsonRpcResponseMessage): void {
    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    pending.cleanup();

    if (message.error) {
      pending.reject(new JsonRpcErrorResponse(
        pending.method,
        message.error.code,
        message.error.message,
        message.error.data,
      ));
      return;
    }

    pending.resolve(message.result);
  }

  private handleNotification(message: JsonRpcNotificationMessage): void {
    const handlers = this.notificationHandlers.get(message.method);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      void Promise.resolve(handler(message.params)).catch(() => {
        // Notification failures are non-fatal to the transport.
      });
    }
  }

  private handleRequest(message: JsonRpcRequestMessage): void {
    const handler = this.requestHandlers.get(message.method);
    if (!handler) {
      this.trySendRaw({
        error: {
          code: -32601,
          message: `Unhandled server request: ${message.method}`,
        },
        id: message.id,
        jsonrpc: '2.0',
      });
      return;
    }

    void Promise.resolve(handler(message.params)).then(
      (result) => {
        this.trySendRaw({ id: message.id, jsonrpc: '2.0', result });
      },
      (error) => {
        this.trySendRaw({
          error: describeHandlerFailure(error),
          id: message.id,
          jsonrpc: '2.0',
        });
      },
    );
  }

  private sendRaw(message: JsonRpcMessage): void {
    if (this.disposed) {
      throw new JsonRpcTransportClosedError();
    }
    // `write` answers whether the buffer took it. A `false` means the stream
    // asked us to wait for `drain`, and ignoring it is how a transport ends up
    // buffering without bound — not a problem at the sizes an ACP turn sends,
    // which is why it went unnoticed, but a large image attachment is the shape
    // that changes that.
    //
    // Held rather than merely noted. The first version of this recorded the
    // backpressure in a field nothing read and wrote anyway, which is the same
    // unbounded buffering with a flag beside it. Queueing keeps the order the
    // protocol requires — a response that overtook its request would be a reply
    // to nothing — and hands the bound back to the stream that asked for it.
    const line = `${JSON.stringify(message)}\n`;
    if (this.awaitingDrain) {
      this.queuedWrites.push(line);
      return;
    }
    if (!this.streams.output.write(line)) {
      this.beginDrainWait();
    }
  }

  /**
   * Stops writing until the stream asks for more, then sends what waited.
   *
   * Re-entrant by design: a flush can fill the buffer again on any line, and
   * the rest go back into the queue behind the next `drain` rather than through
   * it.
   */
  private beginDrainWait(): void {
    this.awaitingDrain = true;
    this.streams.output.once('drain', () => {
      this.awaitingDrain = false;
      while (this.queuedWrites.length > 0) {
        if (this.disposed) {
          // Nothing left to write to. Dropped rather than thrown: this runs on
          // a stream event with no caller to report to.
          this.queuedWrites.length = 0;
          return;
        }
        const line = this.queuedWrites.shift() as string;
        if (!this.streams.output.write(line)) {
          this.beginDrainWait();
          return;
        }
      }
    });
  }

  private trySendRaw(message: JsonRpcMessage): void {
    try {
      this.sendRaw(message);
    } catch (error) {
      const transportError = error instanceof Error ? error : new Error(String(error));
      this.dispose(transportError);
    }
  }
}

type StreamWithEvents = {
  off?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  on?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (eventName: string, listener: (...args: unknown[]) => void) => void;
};

function subscribeStreamEvent(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream,
  eventName: string,
  listener: (...args: unknown[]) => void,
): () => void {
  const evented = stream as StreamWithEvents;
  evented.on?.(eventName, listener);
  return () => {
    if (typeof evented.off === 'function') {
      evented.off(eventName, listener);
      return;
    }
    evented.removeListener?.(eventName, listener);
  };
}
