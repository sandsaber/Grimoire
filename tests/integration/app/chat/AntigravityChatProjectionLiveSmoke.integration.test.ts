import '@/providers';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
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
 * be driven. This is the driven half for the smallest provider: a turn submitted the way a tab submits one, run by the
 * kernel over a real CLI, drawn by the real render target, and read back out of
 * a real record store.
 *
 * Print mode is the smallest whole turn there is — no session to resume, no
 * interaction channel, one `output-delta` carrying the whole answer — so what
 * these rows measure is submit, draw, barrier and terminal, with none of the
 * couplings that would confound a first reading of them.
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

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
  });

  /** The `agy` invocations this process is responsible for, right now. */
  function agyProcesses() {
    return ownedProcesses(command => command.includes(cli) && command.includes('--print'));
  }

  function report(...parts: readonly string[]): void {
    process.stdout.write(`${parts.join(' ')}\n`);
  }

  function createPlugin(vault: string): any {
    const settings: Record<string, unknown> = {
      // Print mode cannot ask for approval, so anything short of full access is
      // refused before a process exists.
      permissionMode: 'full_access',
      savedProviderPermissionMode: { antigravity: 'full_access' },
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
    };
  }

  async function createHarness() {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-agy-projection-'));
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const host = new ExecutionKernelHost({
      storage: new VaultDurableStorage(createDurableInMemoryVaultAdapter()),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new AntigravityExecution(createPlugin(vault), host.registry);
    // No runner argument: the default is the OS one, which is the whole point.
    host.registerBackend({ backend: execution.createBackend() });
    await host.start();

    const runtime = execution.createRuntime();
    const harness = await openChatProjection({
      backendId: antigravityProviderModule.execution.descriptor.backendId,
      conversationId: CONVERSATION_ID,
      lifecycle: host.registry,
      providerId: 'antigravity',
      runtime,
      // The vault the CLI is working in, so the column normalizes a written
      // file's path against the same root the product would.
      vaultPath: vault,
    });
    running.push(async () => {
      await harness.close();
      await host.dispose();
      rmSync(vault, { force: true, recursive: true });
    });
    return harness;
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

  it('row A: draws a real answer once and leaves it in the vault', async () => {
    const { column, sessions, tab } = await createHarness();
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

    // A turn that ended by itself owns the same cleanup a cancelled one does.
    expect(agyProcesses().map(row => row.command)).toEqual([]);
  });

  it('row B: keeps a cancelled turn drawn and leaves no agy behind', async () => {
    if (process.platform === 'win32') {
      report('ROW B skipped: Windows job-object ownership is not observable this way');
      return;
    }
    const { column, tab } = await createHarness();
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

    const survivors = await waitFor('the agy tree to disappear', 20_000, () => (
      agyProcesses().length === 0 ? [] : undefined
    ));
    expect(survivors).toEqual([]);
  });

  // Matrix rows 11 and 12, driven rather than watched: a turn that outlives the
  // tab that started it, and one run drawn into two surfaces. The bodies are
  // shared with every other provider's file — see `chatProjectionSurfaceRows` —
  // because what they certify is the path rather than the provider.
  // Row 13 is not here — print mode reports no usage at all, so a row about the
  // context meter would be a row about `agy --print`.
  const surfaceRows = chatProjectionSurfaceRows({
    createHarness,
    report,
    // Print mode answers in one delta, so the slow prompt is what gives the tab
    // something to close on.
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
