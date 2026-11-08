import '@/providers';

import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
import { imageAttachmentRoundTrip } from "@test/integration/app/chat/chatProjectionImageRow";
import {
  openChatProjection,
  userMessage,
} from '@test/integration/app/chat/chatProjectionLiveHarness';
import { chatProjectionSurfaceRows } from '@test/integration/app/chat/chatProjectionSurfaceRows';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { AntigravityExecution } from '@/providers/antigravity/execution/AntigravityExecutionComposition';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

/**
 * The Antigravity chat projection, against a real `agy`.
 *
 * A live smoke matrix splits into rows a person has to watch and rows that can
 * be driven. This is the driven half: a turn submitted the way a tab submits
 * one, run by the kernel over a real CLI, drawn by the real render target, and
 * read back out of a real record store.
 *
 * Includes ACP approvals and native session resume through the same entrypoint.
 *
 * Off by default — it starts a CLI and spends the account's tokens. Run it with
 * `GRIMOIRE_ANTIGRAVITY_LIVE=1`.
 */
const live = process.env.GRIMOIRE_ANTIGRAVITY_LIVE === '1' ? describe : describe.skip;

live('Antigravity chat projection live smoke', () => {
  jest.setTimeout(240_000);

  const cli = process.env.GRIMOIRE_ANTIGRAVITY_CLI ?? 'agy';
  const CONVERSATION_ID = 'conv-agy-projection';

  const running: Array<() => Promise<void>> = [];
  const vaults: string[] = [];

  afterEach(async () => {
    for (const release of running.splice(0).reverse()) {
      await release().catch(() => undefined);
    }
    for (const vault of vaults.splice(0)) rmSync(vault, { force: true, recursive: true });
  });

  /** The `agy` invocations this process is responsible for, right now. */
  function agyProcesses() {
    return ownedProcesses(command => command.includes(cli)
      && (/(?:^|\s)acp(?:\s|$)/.test(command) || command.includes('--print')));
  }

  function report(...parts: readonly string[]): void {
    process.stdout.write(`${parts.join(' ')}\n`);
  }

  function createPlugin(vault: string, permissionMode: 'normal' | 'full_access'): any {
    const settings: Record<string, unknown> = {
      permissionMode,
      savedProviderPermissionMode: { antigravity: permissionMode },
      userName: 'Michael',
    };
    updateAntigravityProviderSettings(settings, {
      enabled: true,
      visibleModels: process.env.GRIMOIRE_ANTIGRAVITY_MODEL
        ? [process.env.GRIMOIRE_ANTIGRAVITY_MODEL]
        : [],
    });
    return {
      settings,
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => cli,
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
    };
  }

  async function createHarness(
    permissionMode: 'normal' | 'full_access' = 'full_access',
    vaultAdapter = createDurableInMemoryVaultAdapter(),
    reuseVault?: string,
  ) {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-agy-projection-'));
    if (!reuseVault) vaults.push(vault);
    if (!existsSync(join(vault, 'Note.md'))) {
      writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    }
    const host = new ExecutionKernelHost({
      storage: new VaultDurableStorage(createDurableInMemoryVaultAdapter()),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new AntigravityExecution(createPlugin(vault, permissionMode), host.registry);
    // No runner argument: the default is the OS one, which is the whole point.
    host.registerBackend(execution.createBackendRegistration());
    await host.start();

    const runtime = execution.createRuntime();
    const harness = await openChatProjection({
      backendId: antigravityProviderModule.execution.descriptor.backendId,
      conversationId: CONVERSATION_ID,
      lifecycle: host.registry,
      providerId: 'antigravity',
      runtime,
      vaultAdapter,
      syncConversation: true,
      // The vault the CLI is working in, so the column normalizes a written
      // file's path against the same root the product would.
      vaultPath: vault,
    });
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await harness.close();
      await runtime.cleanup();
      await host.dispose();
      await execution.dispose();
    };
    running.push(release);
    return { ...harness, runtime, vault, release };
  }

  function pause(delayMs: number): Promise<void> {
    return new Promise(resolve => { setTimeout(resolve, delayMs); });
  }

  async function waitFor<T>(
    label: string,
    timeoutMs: number,
    attempt: () => T | undefined,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = attempt();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(`${label} did not happen within ${timeoutMs}ms.`);
      }
      await pause(100);
    }
  }

  it('image attachments: delivers both pictures and preserves their saved references', async () => {
    await imageAttachmentRoundTrip(await createHarness(), CONVERSATION_ID);
  });

  it('row A: draws a real answer once and leaves it in the vault', async () => {
    const { column, sessions, tab, release, runtime } = await createHarness();
    const text = 'Reply with exactly: ok';

    const submitted = await tab.send({ text }, userMessage(text));
    const completed = await submitted.ticket.completion;
    await tab.settled();

    report(
      'ROW A',
      completed.terminal.kind,
      JSON.stringify(column.chunks.map(chunk => chunk.type)),
      JSON.stringify(column.drawn.join('').slice(0, 120)),
    );
    expect(completed.terminal.kind).toBe('succeeded');
    // Matrix row 14, inverted: nothing failed, so the failure wording never ran.
    expect(column.chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);
    // Matrix row 5: the answer arrived as text on the column.
    expect(column.drawn.join('').trim()).not.toBe('');
    // Matrix row 2: the column was told once that the turn ended — which the
    // render target says by calling `finishTurn`, not by sending a chunk.
    expect(column.finished).toHaveLength(1);
    const assistants = column.state.messages.filter(message => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.content.trim()).not.toBe('');

    // Matrix row 5, at the layer the answer is stored and redrawn from: the
    // turn is **one text block**, not one per delta. The column is the real
    // `StreamController` now, so this reads what a reopened conversation would
    // draw — and while the column was a double, an answer cut at every delta
    // boundary passed this file on every provider.
    const answer = assistants[0];
    expect(column.thrown).toEqual([]);
    // The surface's own last step, which is what closes the final block of an
    // answer: `endTurn` does not, and neither does `finishTurn`. Without it a
    // whole answer reads as no blocks at all.
    await column.closeOpenBlocks(answer);
    const textBlocks = column.textBlocks(answer);
    const joined = textBlocks.map(block => block.content).join('');
    const answered = answer?.content ?? '';
    report('ROW A blocks', JSON.stringify(column.blocks(answer).map(block => block.type)));
    // Whole: the blocks end with exactly what the message says. Only a notice
    // can come before it — `StreamController` writes one into the open text
    // block on purpose and deliberately leaves it out of the message's own
    // content, because the warning is Grimoire's rather than the model's. Gemini
    // drew one on a live run: it could not switch to auto-approve in an
    // untrusted folder, and said so above its answer.
    expect(answered ? joined.slice(-answered.length) : joined).toBe(answered);
    // And split only where something displaced the open block — a tool card, a
    // stretch of reasoning — never between two deltas of one sentence.
    expect(textBlocks.length).toBeLessThanOrEqual(
      column.blocks(answer).filter(block => block.type !== 'text').length + 1,
    );

    // Matrix row 3: what the vault holds after the barrier, read back through
    // the record store rather than from the copy the surface kept.
    const stored = await sessions.records.read(CONVERSATION_ID);
    expect(stored.kind).toBe('present');
    const messages = stored.kind === 'present' ? stored.metadata.messages ?? [] : [];
    report('ROW A stored', JSON.stringify(messages.map(message => message.role)));
    expect(messages.filter(message => message.role === 'user')).toHaveLength(1);
    // The question is what the provider composed, which is what `submitTurn`
    // hands back for the surface to match its own to.
    expect(messages.find(message => message.role === 'user')?.content)
      .toBe(submitted.userMessage.content);
    // The answer is stored under the same id the surface drew it into, which is
    // what makes "what was on screen" and "what is in the vault" one message.
    const storedAnswer = messages.find(message => message.role === 'assistant');
    expect(storedAnswer?.id).toBe(assistants[0]?.id);
    expect(storedAnswer?.content.trim()).not.toBe('');

    expect(runtime.getSessionId()).toBeTruthy();
    await release();
    if (process.platform !== 'win32') {
      await waitFor('idle chat session cleanup', 20_000, () => agyProcesses().length === 0 ? [] : undefined);
    }
  });

  it('row B: keeps a cancelled turn drawn and leaves no agy behind', async () => {
    if (process.platform === 'win32') {
      report('ROW B skipped: Windows job-object ownership is not observable this way');
      return;
    }
    const { column, tab, release } = await createHarness();
    const text = 'Run the shell command `sleep 120` and then reply with exactly: done';

    const submitted = await tab.send({ text }, userMessage(text));
    await waitFor('an agy process', 120_000, () => agyProcesses()[0]);

    await tab.cancel();
    const completed = await submitted.ticket.completion;
    await tab.settled();

    report('ROW B', completed.terminal.kind, JSON.stringify(column.chunks.map(c => c.type)));
    // Matrix row 7: the turn ends as cancelled, the column is closed once, and
    // the partial answer stays where it was drawn rather than being replaced by
    // a failure.
    expect(completed.terminal.kind).toBe('cancelled');
    expect(column.finished).toHaveLength(1);
    expect(column.chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);

    // ACP may remain warm after cancellation until its last surface releases it.
    await release();
    const survivors = await waitFor('the agy tree to disappear', 20_000, () => (
      agyProcesses().length === 0 ? [] : undefined
    ));
    expect(survivors).toEqual([]);
  });

  it('Safe mode: rejects one edit, allows the next turn, and resumes the saved native session', async () => {
    const vaultAdapter = createDurableInMemoryVaultAdapter();
    const first = await createHarness('normal', vaultAdapter);
    const file = join(first.vault, 'Note.md');
    const original = 'OLD_MARKER\n';
    const updated = 'NEW_MARKER\n';
    const secret = `memory-${randomUUID()}`;
    writeFileSync(file, original);
    let decision: 'allow' | 'deny' = 'deny';
    const asked: Array<{ input: string; before: string; after: string; decision: string }> = [];
    const native: Array<{ kind: string; phase?: string; stopReason?: string; status?: string;
      values?: readonly unknown[]; models?: number; configOptions?: number }> = [];
    // Observe native completion evidence while retaining the real presenter.
    const observe = (runtime: typeof first.runtime, phase: string) => {
      const present = runtime.surfacePorts.presentProviderContent!;
      jest.spyOn(runtime.surfacePorts, 'presentProviderContent').mockImplementation(payload => {
        const content = payload as any;
        if (content?.kind === 'session-config') native.push({ kind: content.kind, phase,
          models: content.session?.models?.availableModels?.length ?? 0,
          configOptions: content.session?.configOptions?.length ?? 0 });
        if (content?.kind === 'prompt-result') native.push({ kind: content.kind, stopReason: content.response?.stopReason });
        if (content?.kind === 'session-update' && content.notification?.update?.sessionUpdate === 'tool_call_update') {
          native.push({ kind: 'tool_call_update', status: content.notification.update.status });
        }
        return present(payload);
      });
    };
    observe(first.runtime, 'first');
    const diagnostics = (phase: string, terminal: unknown, column = first.column) => {
      const redact = (value: unknown) => JSON.stringify(value).replaceAll(secret, '[memory token]').slice(0, 700);
      report('SAFE', phase, JSON.stringify(terminal), `approvals=${asked.length}`,
        redact(column.chunks.filter(chunk => chunk.type === 'error').map(chunk => chunk.content)),
        redact(column.failures), JSON.stringify(native), `drawnChars=${column.drawn.join('').length}`);
    };
    first.runtime.installInteractions({ approval: async (_tool, input, _description, options) => {
      native.push({ kind: 'offered', values: options?.decisionOptions?.map(option => option.value) });
      const before = readFileSync(file, 'utf8');
      // A real edit must stay blocked while the UI is still considering it.
      await pause(250);
      asked.push({ input: JSON.stringify(input), before, after: readFileSync(file, 'utf8'), decision });
      return decision;
    } });

    const deniedText = `Remember this secret code for later: ${secret}. `
      + 'Use your file editing tool to replace OLD_MARKER with NEW_MARKER in Note.md, preserving its final newline. '
      + 'If permission is denied, stop and do not retry or use another tool. Reply briefly.';
    const denied = await first.tab.send({ text: deniedText }, userMessage(deniedText));
    const deniedResult = await denied.ticket.completion;
    await first.tab.settled();
    if (deniedResult.terminal.kind !== 'succeeded') diagnostics('denied', deniedResult.terminal);
    expect(deniedResult.terminal.kind).toBe('succeeded');
    expect(native.some(event => event.kind === 'offered' && event.values?.includes('reject-once'))).toBe(true);
    expect(native.some(event => event.kind === 'prompt-result' && event.stopReason === 'end_turn')).toBe(true);
    expect(first.column.failures).toEqual([]);
    expect(asked.some(item => item.decision === 'deny' && item.input.includes('Note.md'))).toBe(true);
    expect(asked.every(item => item.before === original && item.after === original)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(original);
    await first.saveAfterTurn();
    const sessionId = first.runtime.getSessionId();
    expect(sessionId).toBeTruthy();

    // Remove replayable history: the next answer must come from this native session.
    await first.sessions.records.apply(CONVERSATION_ID, current => ({ ...current, messages: [] }));
    decision = 'allow';
    const approvedText = 'Try the same Note.md edit again using your file editing tool: replace OLD_MARKER '
      + 'with NEW_MARKER, preserving the final newline. Then repeat only the secret code I asked you to remember.';
    const drawnBefore = first.column.drawn.length;
    const approved = await first.tab.send({ text: approvedText }, userMessage(approvedText));
    const approvedResult = await approved.ticket.completion;
    await first.tab.settled();
    if (approvedResult.terminal.kind !== 'succeeded') diagnostics('approved', approvedResult.terminal);
    expect(approvedResult.terminal.kind).toBe('succeeded');
    expect(asked.some(item => item.decision === 'allow' && item.input.includes('Note.md'))).toBe(true);
    expect(asked.every(item => item.before === item.after)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(updated);
    expect(first.column.drawn.slice(drawnBefore).join('')).toContain(secret);
    expect(first.runtime.getSessionId()).toBe(sessionId);
    await first.saveAfterTurn();
    const saved = await first.sessions.records.read(CONVERSATION_ID);
    expect(saved.kind === 'present' ? saved.metadata.sessionId : null).toBe(sessionId);
    await first.sessions.records.apply(CONVERSATION_ID, current => ({ ...current, messages: [] }));
    await first.release();
    if (process.platform !== 'win32') {
      await waitFor('the saved session process to close', 20_000, () => agyProcesses().length === 0 ? [] : undefined);
    }

    // New kernel, composition and CLI; only the saved binding and native transcript survive.
    const resumed = await createHarness('normal', vaultAdapter, first.vault);
    observe(resumed.runtime, 'resumed');
    const recall = 'Without using tools, repeat only the secret code I asked you to remember.';
    const next = await resumed.tab.send({ text: recall }, userMessage(recall), {
      ...(sessionId ? { nativeSessionRef: sessionId } : {}),
    });
    const resumedResult = await next.ticket.completion;
    await resumed.tab.settled();
    if (resumedResult.terminal.kind !== 'succeeded') diagnostics('resumed', resumedResult.terminal, resumed.column);
    expect(resumedResult.terminal.kind).toBe('succeeded');
    expect(resumed.column.drawn.join('')).toContain(secret);
    expect(resumed.runtime.getSessionId()).toBe(sessionId);
    expect(resumed.column.chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    await resumed.saveAfterTurn();
    const reloaded = await resumed.sessions.records.read(CONVERSATION_ID);
    expect(reloaded.kind === 'present' ? reloaded.metadata.sessionId : null).toBe(sessionId);
    await resumed.release();
    if (process.platform !== 'win32') {
      await waitFor('the resumed session process to close', 20_000, () => agyProcesses().length === 0 ? [] : undefined);
    }
    report('SAFE deny/allow + native resume', String(sessionId),
      `denied=${asked.filter(item => item.decision === 'deny').length}`,
      `allowed=${asked.filter(item => item.decision === 'allow').length}`,
      JSON.stringify(native.filter(event => event.kind === 'session-config')));
  }, 600_000);

  // Matrix rows 11 and 12, driven rather than watched: a turn that outlives the
  // tab that started it, and one run drawn into two surfaces. The bodies are
  // shared with every other provider's file — see `chatProjectionSurfaceRows` —
  // because what they certify is the path rather than the provider.
  const surfaceRows = chatProjectionSurfaceRows({
    createHarness: () => createHarness(),
    report,
    slowPrompt: 'Count from 1 to 30, one number per line, then reply with exactly: done',
  });

  it('row E: finishes a turn whose tab closed, and stores it', async () => {
    await surfaceRows.tabClosedMidTurn();
  });

  it('row F: draws one turn into both surfaces on the conversation', async () => {
    await surfaceRows.twoSurfacesOneConversation();
  });

  it('row H: holds queued input until the running turn is durable', async () => {
    await surfaceRows.queuedInputWaitsForDurability();
  });
});
