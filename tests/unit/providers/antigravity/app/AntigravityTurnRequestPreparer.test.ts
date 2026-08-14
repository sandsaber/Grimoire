import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  AntigravityCliUnavailableError,
  AntigravityTurnRequestPreparer,
} from '@/providers/antigravity/app/AntigravityTurnRequestPreparer';

const BACKEND_ID = executionBackendId('provider-antigravity');
const REQUEST_KIND = 'antigravity-turn';

interface AntigravityInvocation {
  command: string;
  cwd: string;
  environment: Record<string, string | undefined>;
  model: string | null;
  permissionMode: string;
  prompt: string;
}

function createPreparer(overrides: { cliPath?: string | null } = {}) {
  const store = new EphemeralExecutionRequestStore();
  let sequence = 0;
  const broker = new ApplicationExecutionRequestBroker(store, {
    nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
  });
  return {
    broker,
    store,
    preparer: new AntigravityTurnRequestPreparer({
      backendId: BACKEND_ID,
      requestKind: REQUEST_KIND,
      requests: broker,
      cliResolver: {
        resolveFromSettings: () => (
          overrides.cliPath === undefined ? '/usr/local/bin/antigravity' : overrides.cliPath
        ),
      },
      buildRuntimeEnv: () => ({ ANTIGRAVITY_TOKEN: 't' }),
    }),
  };
}

const input = { conversationId: 'conv-1', prompt: 'hello', cwd: '/vault', settings: {} };

describe('AntigravityTurnRequestPreparer', () => {
  it('carries the command and prompt directly without a startup reference', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<AntigravityInvocation>(prepared.requestRef, REQUEST_KIND);

    // One print-mode process per turn: there is no persistent client to resolve
    // a launch specification for.
    expect(invocation).not.toHaveProperty('startupRef');
    expect(invocation).toMatchObject({
      command: '/usr/local/bin/antigravity',
      cwd: '/vault',
      prompt: 'hello',
      environment: { ANTIGRAVITY_TOKEN: 't' },
    });
    expect(prepared.backendId).toBe(BACKEND_ID);
  });

  it('defaults an unset permission mode rather than leaving it undefined', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<AntigravityInvocation>(prepared.requestRef, REQUEST_KIND);

    // The backend reads this to decide whether to pass approval flags.
    expect(invocation.permissionMode).toBe('default');
    expect(invocation.model).toBeNull();
  });

  it('applies the configured model and permission mode', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare({
      ...input,
      settings: { antigravity: { model: 'gemini-3-pro', permissionMode: 'full_access' } },
    });
    const invocation = broker.take<AntigravityInvocation>(prepared.requestRef, REQUEST_KIND);

    expect(invocation).toMatchObject({ model: 'gemini-3-pro', permissionMode: 'full_access' });
  });

  it('reports a non-empty fingerprint that tracks the launch inputs', async () => {
    const { preparer } = createPreparer();

    const first = await preparer.prepare(input);
    const second = await preparer.prepare({
      ...input,
      settings: { antigravity: { permissionMode: 'full_access' } },
    });

    expect(first.restartFingerprint).not.toBe('');
    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
  });

  it('fails closed when the CLI cannot be resolved', async () => {
    const { store, preparer } = createPreparer({ cliPath: null });

    await expect(preparer.prepare(input)).rejects.toThrow(AntigravityCliUnavailableError);
    expect(store.size).toBe(0);
  });
});
