import type { Options } from '@anthropic-ai/claude-agent-sdk';

import { CLAUDE_STARTUP_OPTIONS_REQUEST_KIND } from '@/app/execution/claude/ClaudeStartupOptionsResolverAdapter';
import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';
import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import {
  ClaudeCliUnavailableError,
  ClaudeTurnRequestPreparer,
} from '@/providers/claude/app/ClaudeTurnRequestPreparer';

const BACKEND_ID = executionBackendId('provider-claude');
const REQUEST_KIND = 'claude-turn';

function createPreparer(overrides: { cliPath?: string | null } = {}) {
  const store = new EphemeralExecutionRequestStore();
  let sequence = 0;
  const broker = new ApplicationExecutionRequestBroker(store, {
    nextRequestRef: () => `req-${String(++sequence).padStart(32, '0')}` as never,
  });
  const preparer = new ClaudeTurnRequestPreparer({
    backendId: BACKEND_ID,
    requestKind: REQUEST_KIND,
    requests: broker,
    cliResolver: {
      resolveFromSettings: () => (
        overrides.cliPath === undefined ? '/usr/local/bin/claude' : overrides.cliPath
      ),
    },
  });
  return { broker, store, preparer };
}

const input = { conversationId: 'conv-1', prompt: 'hello', cwd: '/vault', settings: {} };

describe('ClaudeTurnRequestPreparer', () => {
  it('registers SDK options under the Claude startup kind', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<{ startupRef: string }>(prepared.requestRef, REQUEST_KIND);
    // Claude resolves startup options, not a process launch specification.
    const options = broker.take<Options>(
      invocation.startupRef,
      CLAUDE_STARTUP_OPTIONS_REQUEST_KIND,
    );

    expect(options).toMatchObject({
      cwd: '/vault',
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
    });
    expect(prepared.backendId).toBe(BACKEND_ID);
  });

  it('carries an SDK user message rather than ACP content blocks', async () => {
    const { broker, preparer } = createPreparer();

    const prepared = await preparer.prepare(input);
    const invocation = broker.take<{ message: { type: string; message: { content: string } } }>(
      prepared.requestRef,
      REQUEST_KIND,
    );

    expect(invocation.message).toMatchObject({
      type: 'user',
      message: { role: 'user', content: 'hello' },
    });
  });

  it('keeps the restart fingerprint stable across turns with unchanged startup inputs', async () => {
    const first = await createPreparer().preparer.prepare(input);
    const second = await createPreparer().preparer.prepare(input);

    // The backend compares this to decide whether the persistent SDK query may
    // be reused; a clock-derived value would restart it every message.
    expect(second.restartFingerprint).toBe(first.restartFingerprint);
  });

  it('changes the restart fingerprint when the working directory changes', async () => {
    const first = await createPreparer().preparer.prepare(input);
    const second = await createPreparer().preparer.prepare({ ...input, cwd: '/other-vault' });

    expect(second.restartFingerprint).not.toBe(first.restartFingerprint);
  });

  it('fails closed when the CLI cannot be resolved', async () => {
    const { store, preparer } = createPreparer({ cliPath: null });

    await expect(preparer.prepare(input)).rejects.toThrow(ClaudeCliUnavailableError);
    expect(store.size).toBe(0);
  });
});
