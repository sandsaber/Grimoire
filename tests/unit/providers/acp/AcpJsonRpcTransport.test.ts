import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

import {
  AcpJsonRpcTransport,
  JsonRpcErrorResponse,
  JsonRpcHandlerError,
} from '../../../../src/providers/acp/AcpJsonRpcTransport';

interface TransportHarness {
  close: () => void;
  closeInput: () => void;
  closeOutput: () => void;
  nextOutbound: () => Promise<Record<string, unknown>>;
  sendInbound: (message: Record<string, unknown>) => void;
  transport: AcpJsonRpcTransport;
}

function createTransportHarness(): TransportHarness {
  const input = new PassThrough();
  const output = new PassThrough();
  const reader = createInterface({ input: output });
  const queued: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];

  reader.on('line', (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    queued.push(message);
  });

  return {
    close: () => {
      reader.close();
      input.end();
      output.end();
    },
    closeInput: () => {
      input.end();
    },
    closeOutput: () => {
      output.destroy();
    },
    nextOutbound: () => {
      if (queued.length > 0) {
        return Promise.resolve(queued.shift()!);
      }
      return new Promise(resolve => waiters.push(resolve));
    },
    sendInbound: (message) => {
      input.write(`${JSON.stringify(message)}\n`);
    },
    transport: new AcpJsonRpcTransport({ input, output }),
  };
}

describe('AcpJsonRpcTransport', () => {
  let harness: TransportHarness;

  beforeEach(() => {
    harness = createTransportHarness();
  });

  afterEach(() => {
    harness.transport.dispose();
    harness.close();
  });

  it('resolves request responses', async () => {
    const requestPromise = harness.transport.request<{ sessionId: string }>('session/new', {
      cwd: '/tmp/project',
      mcpServers: [],
    });

    const outbound = await harness.nextOutbound();
    expect(outbound.method).toBe('session/new');
    expect(outbound.jsonrpc).toBe('2.0');

    harness.sendInbound({
      id: outbound.id,
      jsonrpc: '2.0',
      result: { sessionId: 'session-1' },
    });

    await expect(requestPromise).resolves.toEqual({ sessionId: 'session-1' });
  });

  it('surfaces JSON-RPC errors with codes', async () => {
    const requestPromise = harness.transport.request('session/load', {
      cwd: '/tmp/project',
      mcpServers: [],
      sessionId: 'session-1',
    });

    const outbound = await harness.nextOutbound();
    harness.sendInbound({
      error: {
        code: -32601,
        message: 'Method not found',
      },
      id: outbound.id,
      jsonrpc: '2.0',
    });

    await expect(requestPromise).rejects.toBeInstanceOf(JsonRpcErrorResponse);
    await expect(requestPromise).rejects.toMatchObject({
      code: -32601,
      message: 'Method not found',
      method: 'session/load',
    });
  });

  it('handles server-initiated requests', async () => {
    harness.transport.start();
    harness.transport.onRequest('fs/read_text_file', async (params) => {
      expect(params).toEqual({
        path: '/tmp/project/src/index.ts',
        sessionId: 'session-1',
      });
      return { content: 'export {};' };
    });

    harness.sendInbound({
      id: 7,
      jsonrpc: '2.0',
      method: 'fs/read_text_file',
      params: {
        path: '/tmp/project/src/index.ts',
        sessionId: 'session-1',
      },
    });

    await expect(harness.nextOutbound()).resolves.toEqual({
      id: 7,
      jsonrpc: '2.0',
      result: { content: 'export {};' },
    });
  });

  it('answers a failed server request in the words the handler raised', async () => {
    harness.transport.start();
    harness.transport.onRequest('fs/read_text_file', async () => {
      // What `node:fs` raises, and — under Jest — what it raises from *another
      // realm*: the message is intact and `instanceof Error` is false. The agent
      // reading this response is the reason it matters. Gemini CLI's write tool
      // asks for the file it is about to replace, and shows the client's own
      // sentence when the read fails; a wire that answered "Internal error"
      // there told a live run nothing about a file that simply did not exist.
      const error: Record<string, unknown> = {
        code: 'ENOENT',
        message: "ENOENT: no such file or directory, open '/tmp/project/new.md'",
      };
      throw error;
    });

    harness.sendInbound({
      id: 11,
      jsonrpc: '2.0',
      method: 'fs/read_text_file',
      params: { path: '/tmp/project/new.md', sessionId: 'session-1' },
    });

    await expect(harness.nextOutbound()).resolves.toEqual({
      error: {
        code: -32603,
        message: "ENOENT: no such file or directory, open '/tmp/project/new.md'",
      },
      id: 11,
      jsonrpc: '2.0',
    });
  });

  it('carries the code a handler raised, where it raised one', async () => {
    harness.transport.start();
    harness.transport.onRequest('fs/read_text_file', async () => {
      throw new JsonRpcHandlerError(-32002, 'Resource not found: /tmp/project/new.md');
    });

    harness.sendInbound({
      id: 12,
      jsonrpc: '2.0',
      method: 'fs/read_text_file',
      params: { path: '/tmp/project/new.md', sessionId: 'session-1' },
    });

    // The protocol's own code for it, rather than the internal error that every
    // other failure answers with: a file that is not there and a file the client
    // refused to reach are different answers, and read identically as -32603.
    await expect(harness.nextOutbound()).resolves.toEqual({
      error: {
        code: -32002,
        message: 'Resource not found: /tmp/project/new.md',
      },
      id: 12,
      jsonrpc: '2.0',
    });
  });

  it('still answers a rejection with nothing to say', async () => {
    harness.transport.start();
    harness.transport.onRequest('fs/read_text_file', async () => {
      throw 'no message here';
    });

    harness.sendInbound({
      id: 13,
      jsonrpc: '2.0',
      method: 'fs/read_text_file',
      params: { path: '/tmp/project/new.md', sessionId: 'session-1' },
    });

    await expect(harness.nextOutbound()).resolves.toEqual({
      error: { code: -32603, message: 'Internal error' },
      id: 13,
      jsonrpc: '2.0',
    });
  });

  it('rejects pending requests when disposed', async () => {
    const requestPromise = harness.transport.request('session/prompt', {
      prompt: [{ text: 'hi', type: 'text' }],
      sessionId: 'session-1',
    }, {
      timeoutMs: 0,
    });

    await harness.nextOutbound();
    harness.transport.dispose(new Error('transport stopped'));

    await expect(requestPromise).rejects.toThrow('transport stopped');
  });

  it('rejects with the replayed close cause when the stream closes during start', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const closeCause = new Error('subprocess failed to start');
    const transport = new AcpJsonRpcTransport({
      input,
      output,
      onClose: (listener) => {
        listener(closeCause);
        return () => {};
      },
    });

    await expect(transport.request('initialize')).rejects.toBe(closeCause);

    transport.dispose();
    input.destroy();
    output.destroy();
  });

  it('rejects pending requests when input closes', async () => {
    const requestPromise = harness.transport.request('session/prompt', {
      prompt: [{ text: 'hi', type: 'text' }],
      sessionId: 'session-1',
    }, {
      timeoutMs: 0,
    });

    await harness.nextOutbound();
    harness.closeInput();

    await expect(requestPromise).rejects.toThrow('JSON-RPC input closed');
    expect(harness.transport.isClosed).toBe(true);
  });

  it('rejects pending requests when output closes', async () => {
    const requestPromise = harness.transport.request('session/prompt', {
      prompt: [{ text: 'hi', type: 'text' }],
      sessionId: 'session-1',
    }, {
      timeoutMs: 0,
    });

    await harness.nextOutbound();
    harness.closeOutput();

    await expect(requestPromise).rejects.toThrow('JSON-RPC output closed');
    expect(harness.transport.isClosed).toBe(true);
  });
});
