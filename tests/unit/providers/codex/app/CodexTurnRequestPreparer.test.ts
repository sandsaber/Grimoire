import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  CodexTurnRequestPreparer,
  resolveCodexSandboxConfig,
} from '@/providers/codex/app/CodexTurnRequestPreparer';

const BACKEND_ID = executionBackendId('provider-codex');
const REQUEST_KIND = 'codex-turn';

interface CodexInvocation {
  thread: { kind: string; params: Record<string, unknown> };
  turn: { kind: string; params: { input: Array<{ type: string; text: string }> } };
}

function createPreparer() {
  const store = new EphemeralExecutionRequestStore();
  let sequence = 0;
  const broker = new ApplicationExecutionRequestBroker(store, {
    nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
  });
  return {
    broker,
    preparer: new CodexTurnRequestPreparer({
      backendId: BACKEND_ID,
      requestKind: REQUEST_KIND,
      requests: broker,
    }),
  };
}

const input = { conversationId: 'conv-1', prompt: 'hello', cwd: '/vault', settings: {} };

describe('resolveCodexSandboxConfig', () => {
  it('maps full access and plan modes to their Codex equivalents', () => {
    expect(resolveCodexSandboxConfig('full_access'))
      .toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    expect(resolveCodexSandboxConfig('plan'))
      .toEqual({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  });

  it('falls back to read-only for unknown modes', () => {
    // An unrecognised mode must not widen the sandbox.
    for (const mode of [undefined, null, '', 'something-new', 42]) {
      expect(resolveCodexSandboxConfig(mode))
        .toEqual({ approvalPolicy: 'on-request', sandbox: 'read-only' });
    }
  });
});

describe('CodexTurnRequestPreparer', () => {
  it('registers a thread intent and turn without a startup reference', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<CodexInvocation>(prepared.requestRef, REQUEST_KIND);

    // Codex's app-server launch specification is supplied at composition time,
    // so unlike every other provider there is no startupRef to resolve.
    expect(invocation).not.toHaveProperty('startupRef');
    expect(invocation.thread.kind).toBe('new');
    expect(invocation.thread.params).toMatchObject({ cwd: '/vault', sandbox: 'read-only' });
    expect(invocation.turn).toEqual({
      kind: 'start',
      params: { input: [{ type: 'text', text: 'hello' }] },
    });
  });

  it('applies the configured model and permission mode', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare({
      ...input,
      settings: { codex: { model: 'gpt-5-codex', permissionMode: 'full_access' } },
    });
    const invocation = broker.take<CodexInvocation>(prepared.requestRef, REQUEST_KIND);

    expect(invocation.thread.params).toMatchObject({
      model: 'gpt-5-codex',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
  });

  it('omits base instructions when none are configured', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<CodexInvocation>(prepared.requestRef, REQUEST_KIND);

    // Sending an empty value would override the CLI's own instructions.
    expect(invocation.thread.params).not.toHaveProperty('baseInstructions');
  });

  it('reports a non-empty fingerprint reflecting the thread configuration', async () => {
    const { preparer } = createPreparer();

    const readOnly = await preparer.prepare(input);
    const fullAccess = await preparer.prepare({
      ...input,
      settings: { codex: { permissionMode: 'full_access' } },
    });

    expect(readOnly.restartFingerprint).not.toBe('');
    expect(fullAccess.restartFingerprint).not.toBe(readOnly.restartFingerprint);
  });
});
