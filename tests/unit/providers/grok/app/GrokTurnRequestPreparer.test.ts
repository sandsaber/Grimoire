import { MANAGED_ACP_LAUNCH_REQUEST_KIND } from '@/app/execution/acp/ManagedAcpLaunchResolverAdapter';
import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import { ManagedAcpCliUnavailableError } from '@/providers/acp/app/ManagedAcpTurnRequestPreparer';
import { GrokTurnRequestPreparer } from '@/providers/grok/app/GrokTurnRequestPreparer';

const BACKEND_ID = executionBackendId('provider-grok');
const REQUEST_KIND = 'grok-turn';

function createPreparer(overrides: { cliPath?: string | null } = {}) {
  const store = new EphemeralExecutionRequestStore();
  let sequence = 0;
  const broker = new ApplicationExecutionRequestBroker(store, {
    nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
  });
  const calls: Array<{ order: string; grokHomePath?: string | null }> = [];

  const preparer = new GrokTurnRequestPreparer({
    backendId: BACKEND_ID,
    requestKind: REQUEST_KIND,
    requests: broker,
    cliResolver: {
      resolveFromSettings: () => (
        overrides.cliPath === undefined ? '/usr/local/bin/grok' : overrides.cliPath
      ),
    },
    prepareLaunchArtifacts: async params => {
      calls.push({ order: 'artifacts' });
      return {
        configContent: '',
        grokHomePath: `/vault/.grimoire/grok-${params.permissionMode}`,
        launchKey: `artifact-${params.permissionMode}`,
        managedConfigPath: '/vault/.grimoire/grok/managed_config.toml',
        systemPromptPath: '/vault/.grimoire/grok/system.md',
      };
    },
    buildRuntimeEnv: (_settings, _cliPath, grokHomePath) => {
      calls.push({ order: 'env', grokHomePath });
      return { GROK_HOME: grokHomePath ?? '' };
    },
    buildProcessArguments: (effort, mode) => [
      'agent',
      ...(mode === 'always-approve' ? ['--always-approve'] : []),
      ...(effort ? ['--effort', effort] : []),
    ],
  });
  return { broker, store, preparer, calls };
}

const input = { conversationId: 'conv-1', prompt: 'hi', cwd: '/vault', settings: {} };

describe('GrokTurnRequestPreparer', () => {
  it('prepares artifacts before the environment and feeds the Grok home into it', async () => {
    const { preparer, calls } = createPreparer();

    await preparer.prepare(input);

    // The environment builder needs the generated home directory, so the
    // order is load-bearing rather than incidental.
    expect(calls.map(call => call.order)).toEqual(['artifacts', 'env']);
    expect(calls[1]?.grokHomePath).toBe('/vault/.grimoire/grok-ask');
  });

  it('derives CLI arguments from the configured permission mode and effort', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare({
      ...input,
      settings: { grok: { permissionMode: 'full_access', effortLevel: 'high' } },
    });
    const invocation = broker.take<{ startupRef: string }>(prepared.requestRef, REQUEST_KIND);
    const launch = broker.take<{ arguments: string[] }>(
      invocation.startupRef,
      MANAGED_ACP_LAUNCH_REQUEST_KIND,
    );

    expect(launch.arguments).toEqual(['agent', '--always-approve', '--effort', 'high']);
  });

  it('changes the restart fingerprint when the permission mode changes', async () => {
    const ask = await createPreparer().preparer.prepare(input);
    const approve = await createPreparer().preparer.prepare({
      ...input,
      settings: { grok: { permissionMode: 'full_access' } },
    });

    // Both settings alter the process arguments, so reusing the running client
    // would silently keep the old permission mode.
    expect(approve.restartFingerprint).not.toBe(ask.restartFingerprint);
  });

  it('changes the restart fingerprint when the reasoning effort changes', async () => {
    const low = await createPreparer().preparer.prepare({
      ...input,
      settings: { grok: { permissionMode: 'ask', effortLevel: 'low' } },
    });
    const high = await createPreparer().preparer.prepare({
      ...input,
      settings: { grok: { permissionMode: 'ask', effortLevel: 'high' } },
    });

    expect(high.restartFingerprint).not.toBe(low.restartFingerprint);
  });

  it('keeps the restart fingerprint stable for identical settings', async () => {
    const settings = { grok: { permissionMode: 'ask', effortLevel: 'low' } };
    const first = await createPreparer().preparer.prepare({ ...input, settings });
    const second = await createPreparer().preparer.prepare({ ...input, settings });

    expect(second.restartFingerprint).toBe(first.restartFingerprint);
  });

  it('fails closed when the CLI cannot be resolved', async () => {
    const { store, preparer } = createPreparer({ cliPath: null });

    await expect(preparer.prepare(input)).rejects.toThrow(ManagedAcpCliUnavailableError);
    expect(store.size).toBe(0);
  });
});
