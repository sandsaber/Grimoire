import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
import {
  openChatProjection,
  userMessage,
} from '@test/integration/app/chat/chatProjectionLiveHarness';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { GeminiExecution } from '@/providers/gemini/execution/GeminiExecutionComposition';
import { geminiProviderModule } from '@/providers/gemini/GeminiProviderModule';
import { updateGeminiProviderSettings } from '@/providers/gemini/settings';

/**
 * The Gemini CLI chat projection flip, against a real `gemini --acp`.
 *
 * **This account replenishes about one turn at a time.** Measured across two
 * runs on 2026-08-23: the first pass exhausted it, and after it came back the
 * harness answered one row in full and was exhausted again by the next, with
 * `session/prompt` then answering `429 You have exhausted your daily quota on
 * this model`. So the rows are ordered to spend the turn that is available on
 * the one that matters most, and the rest report the quota error.
 *
 * Worth the run anyway: two runs of Gemini's provider harness found three
 * defects, two of them shipped.
 *
 * Nothing below the composition is a fake — see `chatProjectionLiveHarness`.
 *
 * Off by default. Run it with `GRIMOIRE_GEMINI_LIVE=1`.
 */
const live = process.env.GRIMOIRE_GEMINI_LIVE === '1' ? describe : describe.skip;

live('Gemini CLI chat projection live smoke', () => {
  jest.setTimeout(300_000);

  const CONVERSATION_ID = 'conv-gemini-projection';
  const running: Array<() => Promise<void>> = [];
  /** Directories a reload row owns, since no single harness may delete them. */
  const reloadVaults: string[] = [];

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
    for (const vault of reloadVaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
    }
  });

  function report(...parts: readonly string[]): void {
    process.stdout.write(`${parts.join(' ')}\n`);
  }

  /**
   * Fails with the vendor's name on it when the vendor is what failed.
   *
   * Written for OpenCode, whose endpoint dropped two of five runs on
   * 2026-08-27, and kept here because the distinction is the same for every
   * hosted agent: a row that reports an outage as an assertion about the
   * projection path sends whoever reads it looking for a defect that is not
   * there. The path did its job in exactly those runs — it rendered the
   * provider's own sentence, which is the matrix's row 14.
   *
   * It still fails. An unavailable vendor is not a certified row.
   */
  function refuseVendorOutage(chunks: readonly { type: string }[]): void {
    const failure = chunks.find((chunk): chunk is { type: 'error'; content: string } => (
      chunk.type === 'error'
    ));
    if (failure && /unavailable|service failure|upstream/i.test(failure.content)) {
      throw new Error(
        `Gemini CLI could not serve this row: ${failure.content} `
        + 'This is the vendor, not the projection path — rerun it.',
      );
    }
  }

  function createPlugin(vault: string, overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      mediaFolder: 'media',
      systemPrompt: '',
      userName: 'Michael',
      ...overrides,
    };
    updateGeminiProviderSettings(settings, { enabled: true });
    if (process.env.GRIMOIRE_GEMINI_MODEL) {
      settings.model = process.env.GRIMOIRE_GEMINI_MODEL;
    }
    return {
      settings,
      manifest: { version: '0.0.0-live' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_GEMINI_CLI ?? 'gemini',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: (record: Record<string, unknown>) => {
        // The protocol's own account of what happened, for a row that
        // surprises. Row C did: it resumed onto a *different* session, and only
        // the wire says whether this build asked to load the stored one.
        if (process.env.GRIMOIRE_GEMINI_TRACE === '1') {
          report('LOG', JSON.stringify(record).slice(0, 300));
        }
      },
      saveSettings: async () => undefined,
    };
  }

  async function createHarness(
    overrides: Record<string, unknown> = {},
    vaultAdapter?: ReturnType<typeof createDurableInMemoryVaultAdapter>,
    reuseVault?: string,
  ) {
    // **The directory, not only the record store.** An ACP session belongs to
    // the project it was started in, so a reload that ran in a fresh temp
    // directory cannot load the session the first half created — the agent
    // answers an unknown session with a generic service failure. OpenCode's row
    // read as a resume defect twice before the directory was the answer.
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-gemini-projection-'));
    mkdirSync(vault, { recursive: true });
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
    const execution = new GeminiExecution(createPlugin(vault, overrides), host.registry);
    host.registerBackend(execution.createBackendRegistration());
    await host.start();

    const runtime = execution.createRuntime();
    const harness = await openChatProjection({
      backendId: geminiProviderModule.execution.descriptor.backendId,
      conversationId: CONVERSATION_ID,
      lifecycle: host.registry,
      providerId: 'gemini',
      runtime,
      // The vault the CLI is working in, so the column normalizes a written
      // file's path against the same root the product would.
      vaultPath: vault,
      // What `ConversationController` does when a conversation is opened. The
      // ACP session this conversation is bound to belongs to the conversation
      // the runtime was told about.
      syncConversation: true,
      ...(vaultAdapter ? { vaultAdapter } : {}),
    });
    const release = async (): Promise<void> => {
      await harness.close();
      execution.dispose();
      await host.dispose();
      // Only the directory this call made: a row that hands its vault to a
      // second agent — a reload — must not have it deleted underneath.
      if (!reuseVault) {
        rmSync(vault, { force: true, recursive: true });
      }
    };
    running.push(release);
    return { harness, release, runtime, vault };
  }

  it('row A: draws one answer, once, and leaves it in the vault', async () => {
    const { harness } = await createHarness();
    const { column, sessions, tab } = harness;
    const text = 'Reply with exactly: ok';

    const submitted = await tab.send({ text }, userMessage(text));
    const completed = await submitted.ticket.completion;
    await tab.settled();

    report(
      'ROW A',
      completed.terminal.kind,
      JSON.stringify(column.chunks.map(chunk => chunk.type)),
      JSON.stringify(column.drawn.join('').slice(0, 160)),
    );
    refuseVendorOutage(column.chunks);
    expect(completed.terminal.kind).toBe('succeeded');
    expect(column.chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);
    expect(column.drawn.join('').trim()).not.toBe('');
    // Matrix row 2.
    expect(column.finished).toHaveLength(1);
    const assistants = column.state.messages.filter(message => message.role === 'assistant');
    expect(assistants).toHaveLength(1);

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

    // Matrix row 3.
    const stored = await sessions.records.read(CONVERSATION_ID);
    expect(stored.kind).toBe('present');
    const messages = stored.kind === 'present' ? stored.metadata.messages ?? [] : [];
    report('ROW A stored', JSON.stringify(messages.map(message => message.role)));
    expect(messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(messages.find(message => message.role === 'user')?.content)
      .toBe(submitted.userMessage.content);
    const storedAnswer = messages.find(message => message.role === 'assistant');
    expect(storedAnswer?.id).toBe(assistants[0]?.id);
    expect(storedAnswer?.content.trim()).not.toBe('');
  });

  it('row B: asks once over the ACP channel, and the answer continues the turn', async () => {
    const { harness, runtime, vault } = await createHarness({ permissionMode: 'normal' });
    const { column, tab } = harness;
    const asked: Array<{ tool: string; description: string }> = [];
    // Installed by name rather than through a cast: the seven `ChatRuntime`
    // setters became one `installInteractions` on the adapter, and a cast to
    // the shape the deleted `setApprovalCallback` had kept compiling long after
    // the method was gone — this row could then only fail, and did, on every
    // provider that has one.
    runtime.installInteractions({
      approval: async (tool, _input, description) => {
        asked.push({ description, tool });
        return 'allow';
      },
    });

    // Named as a shell command rather than as an outcome, because the row is
    // about the *permission* and a model that answers without touching the
    // filesystem proves nothing. Asked as "create a file", OpenCode replied
    // `done` with no tool call at all on one of its runs.
    const text = 'Run the shell command `printf yes > allowed-projection.txt` in the working '
      + 'directory, then reply with exactly: done';
    const submitted = await tab.send({ text }, userMessage(text));
    // Bounded, and the bound is the point: before the coordinator attached a
    // presenter, a turn that asked simply stopped, and a suite timeout reports
    // that as "the test took too long" rather than as nobody answering.
    const ended = await Promise.race([
      submitted.ticket.completion.then(() => 'ended' as const),
      new Promise<'waiting'>(resolve => { setTimeout(() => resolve('waiting'), 120_000); }),
    ]);
    await tab.settled();

    report('ROW B', ended, JSON.stringify(asked), JSON.stringify(column.chunks.map(chunk => (
      chunk.type === 'error' || chunk.type === 'notice'
        ? `${chunk.type}:${String(chunk.content).slice(0, 200)}`
        : chunk.type
    ))));
    refuseVendorOutage(column.chunks);
    expect(ended).toBe('ended');
    // Matrix row 9, over ACP's own permission channel rather than an SDK
    // callback — the same seam, the transport five more providers share.
    expect(asked.length).toBeGreaterThan(0);
    // Answering it continued the turn, proven by the file rather than by the
    // callback having returned.
    expect(existsSync(join(vault, 'allowed-projection.txt'))).toBe(true);
  });

  it('row C: resumes the session after a reload, from what the vault kept', async () => {
    // A reload, not a second turn, and with the transcript emptied. Codex's row
    // of this shape stayed green through three breaks: the composition replays
    // the conversation's history into every request, and a provider asked to
    // resume nothing will happily continue whatever it last had.
    const vaultAdapter = createDurableInMemoryVaultAdapter();
    // **Made here, not by the first harness.** A harness deletes the directory
    // it created when it is released, and this row releases the first one
    // before the second exists — so the transcript the reload was meant to load
    // went with it. Grok's row read as a resume defect until this was the
    // answer: its session directory lives *in the vault*, and it correctly
    // reported the session as missing because it was.
    const shared = mkdtempSync(join(tmpdir(), 'grimoire-gemini-projection-reload-'));
    reloadVaults.push(shared);
    const first = await createHarness({}, vaultAdapter, shared);

    const remember = 'Remember the word "tomato". Reply with exactly: ok';
    await (await first.harness.tab.send(
      { text: remember },
      userMessage(remember),
    )).ticket.completion;
    await first.harness.tab.settled();
    // The surface's own half of the save, which is where the session lands.
    await first.harness.saveAfterTurn();

    const afterFirst = await first.harness.sessions.records.read(CONVERSATION_ID);
    const nativeSessionRef = afterFirst.kind === 'present'
      ? afterFirst.metadata.sessionId ?? undefined
      : undefined;
    report('ROW C session', String(nativeSessionRef));
    // **Gemini persists no session directory**, unlike Grok — its
    // `providerState` comes back empty — so what a reload has is the session id
    // and the project it was opened in. The directory is handed over anyway,
    // because the row must not differ between providers in what it gives them.
    report('ROW C providerState', JSON.stringify(
      afterFirst.kind === 'present' ? afterFirst.metadata.providerState : null,
    ));
    expect(nativeSessionRef).toBeTruthy();

    // Everything goes: the agent process, the kernel, the coordinator and the
    // tab. What survives is the vault, which is all a reload has.
    await first.release();

    const second = await createHarness({}, vaultAdapter, shared);
    const { column, sessions, tab } = second.harness;
    await sessions.records.apply(CONVERSATION_ID, current => ({ ...current, messages: [] }));

    const ask = 'What word did I ask you to remember? Reply with just that word.';
    const submitted = await tab.send(
      { text: ask },
      userMessage(ask),
      ...(nativeSessionRef ? [{ nativeSessionRef }] as const : []),
    );
    const completed = await submitted.ticket.completion;
    await tab.settled();

    report('ROW C', completed.terminal.kind, JSON.stringify(completed.terminal),
      JSON.stringify(column.chunks.map(chunk => (
        chunk.type === 'error' || chunk.type === 'notice'
          ? `${chunk.type}:${String(chunk.content).slice(0, 200)}`
          : chunk.type
      ))));
    refuseVendorOutage(column.chunks);
    expect(completed.terminal.kind).toBe('succeeded');
    expect(column.drawn.join('').toLowerCase()).toContain('tomato');
    // Still the one session, not a second: an agent that answered from a fresh
    // one would have bound the conversation to a different id.
    await second.harness.saveAfterTurn();
    const afterSecond = await sessions.records.read(CONVERSATION_ID);
    expect(afterSecond.kind === 'present' ? afterSecond.metadata.sessionId : null)
      .toBe(nativeSessionRef);
  });
});
