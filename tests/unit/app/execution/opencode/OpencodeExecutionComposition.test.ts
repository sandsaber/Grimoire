import '@/providers';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { OpencodeExecution } from '@/app/execution/opencode/OpencodeExecutionComposition';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import { executionSessionId, runId } from '@/core/execution/ExecutionIds';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionNotification } from '@/providers/acp/types';
import { OPENCODE_EXECUTION_DESCRIPTOR } from '@/providers/opencode/execution/OpencodeExecutionBackend';
import { updateOpencodeProviderSettings } from '@/providers/opencode/settings';

/**
 * The half of the OpenCode flip that only exists in production.
 *
 * The backend takes three opaque references — the turn, the process to spawn,
 * the session config to apply — and knows what is inside none of them. This
 * module is the only place that knows all three, and wave 1 proved that a seam
 * both sides stub is a seam nobody tests.
 *
 * So this drives a whole turn with a fake ACP client as the only stand-in, and
 * asserts the thing the three reference spaces exist for: that the process the
 * launcher would spawn is `opencode acp`, under the config the artifacts just
 * wrote, resolved from the reference the turn minted.
 */
describe('OpenCode execution composition', () => {
  const SESSION_ID = executionSessionId(`es-${'2'.repeat(32)}`);
  const RUN_ID = runId(`run-${'2'.repeat(32)}`);
  const OWNER = { kind: 'conversation' as const, ownerId: 'opencode-tab' };

  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  function createPlugin(): any {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-opencode-composition-'));
    vaults.push(vault);
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      systemPrompt: '',
      userName: 'Michael',
      mediaFolder: 'media',
    };
    updateOpencodeProviderSettings(settings, { enabled: true });
    return {
      settings,
      manifest: { version: '1.2.3' },
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/opencode',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
    };
  }

  /** One ACP agent, without an agent. */
  function createFakeAcp(): {
    factory: ManagedAcpClientFactory;
    startupRefs: string[];
    prompts: unknown[];
  } {
    const startupRefs: string[] = [];
    const prompts: unknown[] = [];
    const factory: ManagedAcpClientFactory = {
      create: async (input: ManagedAcpClientFactoryInput) => {
        startupRefs.push(input.startupRef);
        let notify: ((notification: AcpSessionNotification) => void) | undefined;
        const client: ManagedAcpClient = {
          initialize: async () => undefined,
          newSession: async () => ({ sessionId: 'acp-session-1' }),
          loadSession: async () => ({ sessionId: 'acp-session-1' }),
          prompt: async request => {
            prompts.push(request);
            // The answer arrives as a session update, the way an ACP agent
            // says anything at all, and the stop reason ends the turn.
            notify?.({
              sessionId: 'acp-session-1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'the answer' },
              },
            });
            return { stopReason: 'end_turn' };
          },
          setConfigOption: async () => ({ configOptions: [] }),
          cancel: () => undefined,
          onSessionNotification: listener => {
            notify = listener;
            return () => { notify = undefined; };
          },
          onConnectionLost: () => () => undefined,
          close: async () => 'confirmed' as const,
        };
        return client;
      },
    };
    return { factory, startupRefs, prompts };
  }

  async function createHarness(): Promise<{
    execution: OpencodeExecution;
    host: ExecutionKernelHost;
    startupRefs: string[];
    prompts: unknown[];
    events: ExecutionEventEnvelope[];
  }> {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new OpencodeExecution(createPlugin(), host.registry);
    const { factory, startupRefs, prompts } = createFakeAcp();
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    await host.registry.createSession({
      backendId: OPENCODE_EXECUTION_DESCRIPTOR.backendId,
      executionSessionId: SESSION_ID,
      owner: OWNER,
    });
    const events: ExecutionEventEnvelope[] = [];
    host.registry.observe(SESSION_ID, envelope => events.push(envelope));
    return { execution, host, startupRefs, prompts, events };
  }

  async function settle(
    host: ExecutionKernelHost,
    events: ExecutionEventEnvelope[],
  ): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await host.registry.waitForIdle();
      if (events.some(envelope => envelope.event.kind === 'terminal')) {
        return;
      }
      await new Promise(resolve => { setTimeout(resolve, 5); });
    }
    throw new Error(`The run never reached a terminal: ${JSON.stringify(
      events.map(envelope => envelope.event.kind),
    )}`);
  }

  it('carries a whole turn from the reference to the ACP prompt and back', async () => {
    const { execution, host, prompts, events } = await createHarness();

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(prompts).toHaveLength(1);
    const kinds = events.map(envelope => envelope.event.kind);
    expect(kinds).toContain('run-started');
    const terminal = events.find(envelope => envelope.event.kind === 'terminal');
    expect(terminal?.event).toMatchObject({ terminal: 'succeeded' });
    execution.dispose();
    await host.dispose();
  });

  it('resolves the startup reference into the process a launcher would spawn', async () => {
    // The three reference spaces are the point of this composition, and this is
    // where they meet: the turn mints a startup reference, and what it stands
    // for is `opencode acp` under the config file the artifacts wrote for that
    // same turn. A launch built anywhere else would run the previous turn's
    // configuration.
    const { execution, host, startupRefs, events } = await createHarness();

    const requestRef = execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    });
    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef,
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(startupRefs).toHaveLength(1);
    const launch = await execution.turnRequests.resolveLaunch(startupRefs[0]);
    expect(launch).toMatchObject({
      executable: '/usr/local/bin/opencode',
      arguments: ['acp'],
    });
    expect(launch.environment.OPENCODE_CONFIG).toContain('.grimoire');
    expect(launch.environment.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
    execution.dispose();
    await host.dispose();
  });

  it('refuses a reference it did not mint', async () => {
    // One store, or the reference resolves to nothing: the seam wave 1's
    // end-to-end turn failed on, asserted here before a flip can meet it.
    const { execution, host, events } = await createHarness();

    await host.registry.startRun(SESSION_ID, {
      runId: RUN_ID,
      owner: OWNER,
      requestRef: 'ocreq-0000000000000000000000000000000f',
      resultExpectation: 'required',
    });
    await settle(host, events);

    expect(host.registry.getRun(RUN_ID)).toMatchObject({ state: 'invalidated' });
    execution.dispose();
    await host.dispose();
  });
});
