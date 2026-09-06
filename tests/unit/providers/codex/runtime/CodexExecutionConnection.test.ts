import { PassThrough, Writable } from 'stream';

import {
  type CodexExecutionProcess,
  CodexJsonRpcExecutionConnection,
} from '@/providers/codex/runtime/CodexExecutionConnection';

class FakeExecutionProcess implements CodexExecutionProcess {
  readonly stdout = new PassThrough();
  readonly written: Array<Record<string, unknown>> = [];
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      if (this.nextWriteError) {
        const error = this.nextWriteError;
        this.nextWriteError = undefined;
        callback(error);
        return;
      }
      this.written.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      callback();
    },
  });
  readonly exits = new Set<(
    code: number | null,
    signal: string | null,
    error?: Error,
  ) => void>();
  startCount = 0;
  shutdownCount = 0;
  nextWriteError: Error | undefined;

  start(): void {
    this.startCount += 1;
  }

  onExit(callback: (
    code: number | null,
    signal: string | null,
    error?: Error,
  ) => void): void {
    this.exits.add(callback);
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1;
  }

  respond(id: unknown, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }

  receive(method: string, params: unknown, id?: string | number): void {
    this.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      ...(id === undefined ? {} : { id }),
      method,
      params,
    })}\n`);
  }
}

describe('CodexJsonRpcExecutionConnection', () => {
  it('starts once and performs initialize followed by initialized', async () => {
    const process = new FakeExecutionProcess();
    const connection = new CodexJsonRpcExecutionConnection({ create: () => process });

    const initialization = connection.initialize();
    const initialize = process.written[0];
    expect(initialize).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: { experimentalApi: true },
      },
    });
    process.respond(initialize.id, {
      userAgent: 'codex-test',
      platformFamily: 'unix',
      platformOs: 'macos',
    });

    await expect(initialization).resolves.toMatchObject({ userAgent: 'codex-test' });
    expect(process.startCount).toBe(1);
    expect(process.written.at(-1)).toMatchObject({ method: 'initialized' });
    expect(connection.initialize()).toBe(initialization);

    await connection.dispose();
    await connection.dispose();
    expect(process.shutdownCount).toBe(1);
  });

  it('routes execution notifications, server requests, and connection loss', async () => {
    const process = new FakeExecutionProcess();
    const connection = new CodexJsonRpcExecutionConnection({ create: () => process });
    const initialization = connection.initialize();
    process.respond(process.written[0].id, {
      userAgent: 'codex-test',
      platformFamily: 'windows',
      platformOs: 'windows',
    });
    await initialization;

    const notifications: Array<[string, unknown]> = [];
    connection.onNotification((method, params) => notifications.push([method, params]));
    connection.onServerRequest(async (requestId, method, params) => ({
      requestId,
      method,
      params,
      decision: 'accept',
    }));
    const losses: Array<Error | undefined> = [];
    connection.onConnectionLost(error => losses.push(error));

    process.receive('turn/started', { threadId: 'thread-1' });
    process.receive(
      'item/commandExecution/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-1' },
      'approval-1',
    );
    await flushPromises();

    expect(notifications).toEqual([['turn/started', { threadId: 'thread-1' }]]);
    expect(process.written.at(-1)).toMatchObject({
      id: 'approval-1',
      result: {
        requestId: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        decision: 'accept',
      },
    });

    const error = new Error('app-server exited');
    for (const listener of process.exits) {
      listener(1, null, error);
    }
    expect(losses).toEqual([error]);
  });

  it('turns a stdin close/write race into one connection-loss signal', async () => {
    const process = new FakeExecutionProcess();
    const connection = new CodexJsonRpcExecutionConnection({ create: () => process });
    const initialization = connection.initialize();
    process.respond(process.written[0].id, {
      userAgent: 'codex-test',
      platformFamily: 'unix',
      platformOs: 'linux',
    });
    await initialization;
    const losses: Error[] = [];
    connection.onConnectionLost(error => {
      if (error) {
        losses.push(error);
      }
    });
    const pipeError = Object.assign(new Error('broken daemon pipe'), { code: 'EPIPE' });
    process.nextWriteError = pipeError;

    await expect(connection.request('thread/read', { threadId: 'thread-1' }))
      .rejects.toBe(pipeError);
    await flushPromises();
    for (const listener of process.exits) {
      listener(1, null, new Error('later process exit'));
    }
    expect(losses).toEqual([pipeError]);
  });
});

async function flushPromises(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}
