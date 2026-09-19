import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodexAppServerProcess } from '@/providers/codex/runtime/CodexAppServerProcess';
import { CodexRpcTransport } from '@/providers/codex/runtime/CodexRpcTransport';

// Opt-in: a successful start opens a billable realtime session. No microphone is used.
const live = process.env.GRIMOIRE_CODEX_VOICE_LIVE === '1' ? describe : describe.skip;

live('Codex voice startup (#189)', () => {
  jest.setTimeout(60_000);

  it('receives realtime readiness rather than accepting only the RPC acknowledgement', async () => {
    const version = process.env.GRIMOIRE_CODEX_VOICE_VERSION ?? 'v1';
    if (!['v1', 'v2', 'v3'].includes(version)) {
      throw new Error('GRIMOIRE_CODEX_VOICE_VERSION must be v1, v2, or v3.');
    }

    const workspace = await mkdtemp(join(tmpdir(), 'grimoire-codex-voice-'));
    const server = new CodexAppServerProcess({
      command: process.env.GRIMOIRE_CODEX_CLI ?? 'codex',
      args: ['app-server'],
      spawnCwd: workspace,
      env: Object.fromEntries(Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )),
    });
    let transport: CodexRpcTransport | undefined;
    let threadId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      server.start();
      server.stderr.resume();
      transport = new CodexRpcTransport(server);
      transport.start();
      await transport.request('initialize', {
        clientInfo: { name: 'grimoire_voice_probe', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      transport.notify('initialized');
      const result = await transport.request<{ thread: { id: string } }>('thread/start', {
        cwd: workspace,
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        environments: [],
        baseInstructions: 'This is a voice startup test. Do not use tools or read files.',
      });
      threadId = result.thread.id;

      // The server can acknowledge start and then asynchronously reject authentication.
      // Install listeners first; resolve errors as values to avoid unhandled rejections
      // while the start request is still pending.
      const ready = new Promise<string | null>(resolve => {
        transport!.onNotification('thread/realtime/started', params => {
          const event = params as { threadId?: string };
          if (event.threadId === threadId) resolve(null);
        });
        transport!.onNotification('thread/realtime/error', params => {
          const event = params as { threadId?: string; message?: string };
          if (event.threadId === threadId) resolve(event.message ?? 'Realtime startup failed.');
        });
        transport!.onNotification('thread/realtime/closed', params => {
          const event = params as { threadId?: string };
          if (event.threadId === threadId) resolve('Realtime closed before becoming ready.');
        });
        transport!.onConnectionLost(error => resolve(error.message));
        timer = setTimeout(() => resolve('Timed out waiting for realtime readiness.'), 15_000);
      });

      await transport.request('thread/realtime/start', {
        threadId,
        version,
        outputModality: 'audio',
        transport: { type: 'websocket' },
        includeStartupContext: false,
        clientManagedHandoffs: true,
        prompt: 'This is a voice startup test. Wait silently. Do not delegate or use tools.',
      });
      const failure = await ready;
      if (failure) throw new Error(`Codex realtime ${version}: ${failure}`);
      expect(failure).toBeNull();
    } finally {
      if (timer) clearTimeout(timer);
      if (threadId && transport) {
        await transport.request('thread/realtime/stop', { threadId }, 2_000).catch(() => undefined);
      }
      transport?.dispose();
      await server.shutdown();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
