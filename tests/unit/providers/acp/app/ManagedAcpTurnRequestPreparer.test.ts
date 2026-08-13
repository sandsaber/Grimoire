import { MANAGED_ACP_LAUNCH_REQUEST_KIND } from '@/app/execution/acp/ManagedAcpLaunchResolverAdapter';
import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ManagedAcpCliUnavailableError,
  ManagedAcpTurnRequestPreparer,
} from '@/providers/acp/app/ManagedAcpTurnRequestPreparer';
import { OPENCODE_EXECUTION_REQUEST_KIND } from '@/providers/opencode/app/OpencodeApplicationContextFactory';

const BACKEND_ID = executionBackendId('provider-opencode');

function createPreparer(overrides: {
  cliPath?: string | null;
  launchKey?: string;
} = {}) {
  const store = new EphemeralExecutionRequestStore();
  let sequence = 0;
  const broker = new ApplicationExecutionRequestBroker(store, {
    // The store enforces opaque 32-hex request identifiers.
    nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
  });
  const preparer = new ManagedAcpTurnRequestPreparer({
    providerId: 'opencode',
    displayName: 'OpenCode',
    executableName: 'opencode',
    requestKind: OPENCODE_EXECUTION_REQUEST_KIND,
    configEnvVar: 'OPENCODE_CONFIG',
    launchArguments: ['acp'],
    backendId: BACKEND_ID,
    requests: broker,
    cliResolver: {
      resolveFromSettings: () => (
        overrides.cliPath === undefined ? '/usr/local/bin/opencode' : overrides.cliPath
      ),
    },
    prepareLaunchArtifacts: async () => ({
      configPath: '/vault/.grimoire/opencode/opencode.json',
      configContent: '{}',
      databasePath: '/vault/.grimoire/opencode/db.sqlite',
      launchKey: overrides.launchKey ?? 'launch-key-1',
      systemPromptPath: '/vault/.grimoire/opencode/system.md',
    }),
    buildRuntimeEnv: () => ({ XDG_DATA_HOME: '/data', UNSET: undefined }),
  });
  return { broker, store, preparer };
}

const input = {
  conversationId: 'conv-1',
  prompt: 'hello',
  cwd: '/vault',
  settings: {},
};

describe('ManagedAcpTurnRequestPreparer', () => {
  it('registers a resolvable managed-ACP launch specification', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<{ startupRef: string }>(
      prepared.requestRef,
      OPENCODE_EXECUTION_REQUEST_KIND,
    );
    const launch = broker.take<Record<string, unknown>>(
      invocation.startupRef,
      MANAGED_ACP_LAUNCH_REQUEST_KIND,
    );

    expect(launch).toMatchObject({
      executable: '/usr/local/bin/opencode',
      arguments: ['acp'],
      cwd: '/vault',
    });
    expect(prepared.backendId).toBe(BACKEND_ID);
  });

  it('supplies the invocation fields the backend requires', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<Record<string, unknown>>(
      prepared.requestRef,
      OPENCODE_EXECUTION_REQUEST_KIND,
    );

    // cwd and mcpServers are required; omitting them made the backend reject
    // the invocation after the Phase 9 cutover.
    expect(invocation).toMatchObject({
      cwd: '/vault',
      mcpServers: [],
      prompt: [{ type: 'text', text: 'hello' }],
    });
  });

  it('points the config environment at the generated launch artifacts', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<{ startupRef: string }>(
      prepared.requestRef,
      OPENCODE_EXECUTION_REQUEST_KIND,
    );
    const launch = broker.take<{ environment: Record<string, string> }>(
      invocation.startupRef,
      MANAGED_ACP_LAUNCH_REQUEST_KIND,
    );

    expect(launch.environment.OPENCODE_CONFIG).toBe('/vault/.grimoire/opencode/opencode.json');
    expect(launch.environment.XDG_DATA_HOME).toBe('/data');
    // Undefined process-env entries are dropped, not coerced to "undefined".
    expect(Object.keys(launch.environment)).not.toContain('UNSET');
  });

  it('keeps the restart fingerprint stable across turns with unchanged launch inputs', async () => {
    const { preparer } = createPreparer({ launchKey: 'stable-key' });

    const first = await preparer.prepare(input);
    const second = await preparer.prepare(input);

    // A clock-derived fingerprint made every turn look like a configuration
    // change, which would tear down and relaunch the managed client.
    expect(first.restartFingerprint).toBe('stable-key');
    expect(second.restartFingerprint).toBe(first.restartFingerprint);
  });

  it('changes the restart fingerprint when the launch inputs change', async () => {
    const first = await createPreparer({ launchKey: 'key-a' }).preparer.prepare(input);
    const second = await createPreparer({ launchKey: 'key-b' }).preparer.prepare(input);

    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
  });

  it('fails closed with an actionable error when the CLI cannot be resolved', async () => {
    const { store, preparer } = createPreparer({ cliPath: null });

    await expect(preparer.prepare(input)).rejects.toThrow(ManagedAcpCliUnavailableError);
    // Nothing is registered, so a failed preparation cannot leave a dangling
    // launch reference behind.
    expect(store.size).toBe(0);
  });

  it('derives a stable fingerprint for providers without launch artifacts', async () => {
    // Gemini and Qwen generate no config file, so there is no launchKey to
    // reuse. The fingerprint must still be stable across identical turns.
    const build = () => {
      let sequence = 0;
      const store = new EphemeralExecutionRequestStore();
      return new ManagedAcpTurnRequestPreparer({
        providerId: 'gemini',
        displayName: 'Gemini CLI',
        executableName: 'gemini',
        requestKind: 'gemini-turn',
        launchArguments: ['--acp'],
        backendId: BACKEND_ID,
        requests: new ApplicationExecutionRequestBroker(store, {
          nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
        }),
        cliResolver: { resolveFromSettings: () => '/usr/local/bin/gemini' },
        buildRuntimeEnv: () => ({ GEMINI_API_KEY: 'k' }),
      });
    };

    const first = await build().prepare(input);
    const second = await build().prepare(input);

    expect(first.restartFingerprint).toBe(second.restartFingerprint);
    expect(first.restartFingerprint).toContain('/usr/local/bin/gemini');
  });

  it('changes the derived fingerprint when the environment changes', async () => {
    const build = (apiKey: string) => {
      let sequence = 0;
      return new ManagedAcpTurnRequestPreparer({
        providerId: 'gemini',
        displayName: 'Gemini CLI',
        executableName: 'gemini',
        requestKind: 'gemini-turn',
        launchArguments: ['--acp'],
        backendId: BACKEND_ID,
        requests: new ApplicationExecutionRequestBroker(new EphemeralExecutionRequestStore(), {
          nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
        }),
        cliResolver: { resolveFromSettings: () => '/usr/local/bin/gemini' },
        buildRuntimeEnv: () => ({ GEMINI_API_KEY: apiKey }),
      });
    };

    const first = await build('key-a').prepare(input);
    const second = await build('key-b').prepare(input);

    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
  });
});
