import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

import type {
  AcpSessionNotification,
  JsonRpcRequestOptions,
} from '../../../../src/providers/acp';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  JsonRpcErrorResponse,
} from '../../../../src/providers/acp';

interface ConnectionHarness {
  close: () => void;
  connection: AcpClientConnection;
  nextOutbound: () => Promise<Record<string, unknown>>;
  sendInbound: (message: Record<string, unknown>) => void;
  transport: AcpJsonRpcTransport;
}

function createConnectionHarness(
  connectionFactory: (transport: AcpJsonRpcTransport) => AcpClientConnection,
): ConnectionHarness {
  const input = new PassThrough();
  const output = new PassThrough();
  const reader = createInterface({ input: output });
  const queued: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  const transport = new AcpJsonRpcTransport({ input, output });

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
    connection: connectionFactory(transport),
    nextOutbound: () => {
      if (queued.length > 0) {
        return Promise.resolve(queued.shift()!);
      }
      return new Promise(resolve => waiters.push(resolve));
    },
    sendInbound: (message) => {
      input.write(`${JSON.stringify(message)}\n`);
    },
    transport,
  };
}

describe('AcpClientConnection', () => {
  it('delivers session updates an agent sends under its own method name', async () => {
    // Grok is the first: beside `session/update` it sends its own updates on
    // `_x.ai/session_notification`, and a client subscribed only to the
    // standard method never sees the turn's usage or its stop reason.
    const seen: AcpSessionNotification[] = [];
    const harness = createConnectionHarness((transport) => new AcpClientConnection({
      transport,
      delegate: { onSessionNotification: async notification => { seen.push(notification); } },
      vendorSessionNotifications: {
        methods: ['_x.ai/session_notification'],
        parse: (_method, params) => params as AcpSessionNotification,
      },
    }));
    harness.connection.onSessionNotification(notification => {
      seen.push(notification);
    });
    harness.transport.start();

    harness.sendInbound({
      jsonrpc: '2.0',
      method: '_x.ai/session_notification',
      params: {
        sessionId: 'session-1',
        update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' },
      },
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      sessionId: 'session-1',
      update: { sessionUpdate: 'turn_completed' },
    });
    harness.close();
  });

  it('declines a vendor notification its parser does not recognize', async () => {
    const seen: AcpSessionNotification[] = [];
    const harness = createConnectionHarness((transport) => new AcpClientConnection({
      transport,
      vendorSessionNotifications: {
        methods: ['_x.ai/session_notification'],
        // A method the agent sends on the same channel that is not a session
        // notification at all: the provider says so by answering nothing.
        parse: () => null,
      },
    }));
    harness.connection.onSessionNotification(notification => {
      seen.push(notification);
    });
    harness.transport.start();

    harness.sendInbound({
      jsonrpc: '2.0',
      method: '_x.ai/session_notification',
      params: { anything: true },
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(seen).toEqual([]);
    harness.close();
  });

  it('advertises derived client capabilities and dispatches session notifications', async () => {
    const notifications: AcpSessionNotification[] = [];
    const harness = createConnectionHarness((transport) => new AcpClientConnection({
      clientInfo: { name: 'grimoire', version: '0.0.0-test' },
      delegate: {
        fileSystem: {
          readTextFile: async () => ({ content: 'hello' }),
        },
        onSessionNotification: async (notification) => {
          notifications.push(notification);
        },
      },
      transport,
    }));

    try {
      const initializePromise = harness.connection.initialize();
      const outbound = await harness.nextOutbound();

      expect(outbound.method).toBe('initialize');
      expect(outbound.params).toMatchObject({
        clientCapabilities: {
          fs: {
            readTextFile: true,
          },
        },
        clientInfo: { name: 'grimoire', version: '0.0.0-test' },
        protocolVersion: 1,
      });

      harness.sendInbound({
        id: outbound.id,
        jsonrpc: '2.0',
        result: {
          agentCapabilities: { loadSession: true },
          agentInfo: { name: 'gemini', version: '1.0.0' },
          protocolVersion: 1,
        },
      });

      await initializePromise;

      harness.sendInbound({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'session_info_update',
            title: 'Renamed Session',
          },
        },
      });

      await new Promise(resolve => setImmediate(resolve));
      expect(notifications).toEqual([{
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'session_info_update',
          title: 'Renamed Session',
        },
      }]);
    } finally {
      harness.connection.dispose();
      harness.transport.dispose();
      harness.close();
    }
  });

  it('falls back to legacy method names and caches the resolved method', async () => {
    const harness = createConnectionHarness((transport) => new AcpClientConnection({ transport }));

    try {
      const firstPromise = harness.connection.setMode({
        modeId: 'plan',
        sessionId: 'session-1',
      });

      const firstAttempt = await harness.nextOutbound();
      expect(firstAttempt.method).toBe('session/set_mode');
      harness.sendInbound({
        error: {
          code: -32601,
          message: 'Method not found',
        },
        id: firstAttempt.id,
        jsonrpc: '2.0',
      });

      const secondAttempt = await harness.nextOutbound();
      expect(secondAttempt.method).toBe('setSessionMode');
      harness.sendInbound({
        id: secondAttempt.id,
        jsonrpc: '2.0',
        result: {},
      });

      await expect(firstPromise).resolves.toEqual({});

      const cachedPromise = harness.connection.setMode({
        modeId: 'plan',
        sessionId: 'session-1',
      });

      const cachedAttempt = await harness.nextOutbound();
      expect(cachedAttempt.method).toBe('setSessionMode');
      harness.sendInbound({
        id: cachedAttempt.id,
        jsonrpc: '2.0',
        result: {},
      });

      await expect(cachedPromise).resolves.toEqual({});
    } finally {
      harness.connection.dispose();
      harness.transport.dispose();
      harness.close();
    }
  });

  it('disables request timeout for prompt turns across method fallback', async () => {
    const promptRequest = {
      prompt: [{ text: 'hi', type: 'text' as const }],
      sessionId: 'session-1',
    };
    const requests: Array<{
      method: string;
      options?: JsonRpcRequestOptions;
      params?: unknown;
    }> = [];
    const transport = {
      notify: () => undefined,
      onNotification: () => () => undefined,
      onRequest: () => () => undefined,
      request: async (method: string, params?: unknown, options?: JsonRpcRequestOptions) => {
        requests.push({ method, options, params });
        if (method === 'session/prompt') {
          throw new JsonRpcErrorResponse(method, -32601, 'Method not found');
        }
        return { stopReason: 'end_turn' };
      },
      signal: new AbortController().signal,
    } as unknown as AcpJsonRpcTransport;
    const connection = new AcpClientConnection({ transport });

    await expect(connection.prompt(promptRequest)).resolves.toEqual({
      stopReason: 'end_turn',
    });

    expect(requests).toEqual([
      {
        method: 'session/prompt',
        options: { timeoutMs: 0 },
        params: promptRequest,
      },
      {
        method: 'prompt',
        options: { timeoutMs: 0 },
        params: promptRequest,
      },
    ]);
  });

  it('handles Grok ask_user_question server requests through the delegate', async () => {
    const askUserQuestion = jest.fn().mockResolvedValue({
      annotations: {},
      answers: { 'Pick one': 'notes' },
      outcome: 'accepted',
    });
    const harness = createConnectionHarness((transport) => new AcpClientConnection({
      delegate: { askUserQuestion },
      transport,
    }));

    try {
      harness.transport.start();
      harness.sendInbound({
        id: 9,
        jsonrpc: '2.0',
        method: '_x.ai/ask_user_question',
        params: {
          questions: [{
            multiSelect: false,
            options: [{ label: 'notes' }],
            question: 'Pick one',
          }],
          sessionId: 'session-1',
          toolCallId: 'call-1',
        },
      });

      await expect(harness.nextOutbound()).resolves.toEqual({
        id: 9,
        jsonrpc: '2.0',
        result: {
          annotations: {},
          answers: { 'Pick one': 'notes' },
          outcome: 'accepted',
        },
      });
      expect(askUserQuestion).toHaveBeenCalledWith({
        questions: [{
          multiSelect: false,
          options: [{ label: 'notes' }],
          question: 'Pick one',
        }],
        sessionId: 'session-1',
        toolCallId: 'call-1',
      });
    } finally {
      harness.connection.dispose();
      harness.transport.dispose();
      harness.close();
    }
  });

  it('sends cancel notifications to all known aliases when no working method is cached', async () => {
    const harness = createConnectionHarness((transport) => new AcpClientConnection({ transport }));

    try {
      harness.connection.cancel({ sessionId: 'session-1' });

      await expect(harness.nextOutbound()).resolves.toMatchObject({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: 'session-1' },
      });
      await expect(harness.nextOutbound()).resolves.toMatchObject({
        jsonrpc: '2.0',
        method: 'cancel',
        params: { sessionId: 'session-1' },
      });
    } finally {
      harness.connection.dispose();
      harness.transport.dispose();
      harness.close();
    }
  });
});
