import '@/providers';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
import {
  openChatProjection,
  userMessage,
} from '@test/integration/app/chat/chatProjectionLiveHarness';
import { chatProjectionSurfaceRows } from '@test/integration/app/chat/chatProjectionSurfaceRows';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import { CodexExecution } from '@/providers/codex/execution/CodexExecutionComposition';
import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/providers/codex/execution/NodeCodexExecutionConnectionFactory';
import { resolveCodexAppServerLaunchSpec } from '@/providers/codex/runtime/codexAppServerSupport';
import { updateCodexProviderSettings } from '@/providers/codex/settings';
import { DEFAULT_CODEX_MINI_MODEL } from '@/providers/codex/types/models';

/**
 * The Codex chat projection flip, against a real `codex app-server`.
 *
 * The second provider on the path, and the first that brings anything to it:
 * Antigravity's print mode has one `output-delta` and no session, while Codex
 * has a **content presenter** whose items the surface has to draw, a thread the
 * next turn has to resume, and its own words for a failure. Those are three of
 * the four things the matrix says are a provider's own, so this is where the
 * pattern is proven rather than where it is repeated.
 *
 * Nothing below the composition is a fake — see `chatProjectionLiveHarness`.
 *
 * Off by default — it starts a daemon and spends the account's tokens. Run it
 * with `GRIMOIRE_CODEX_LIVE=1`.
 */
const live = process.env.GRIMOIRE_CODEX_LIVE === '1' ? describe : describe.skip;

live('Codex chat projection live smoke', () => {
  jest.setTimeout(240_000);

  const CONVERSATION_ID = 'conv-codex-projection';
  const running: Array<() => Promise<void>> = [];
  /** Which runtime each harness's tab was built with. */
  const runtimes = new WeakMap<object, ExecutionChatRuntimeAdapter>();

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
  });

  /** The runtime a harness was built with, for the encoder a steer needs. */
  function runtimeOf(harness: { readonly tab: object }): ExecutionChatRuntimeAdapter {
    const runtime = runtimes.get(harness.tab);
    if (!runtime) {
      throw new Error('This harness has no runtime recorded.');
    }
    return runtime;
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
      await pause(200);
    }
  }

  function report(...parts: readonly string[]): void {
    process.stdout.write(`${parts.join(' ')}\n`);
  }

  function createPlugin(vault: string, overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'default',
      effortLevel: 'low',
      // The cheapest model this provider offers: the rows are about the path,
      // not about the answer, and every run spends the account's tokens.
      model: process.env.GRIMOIRE_CODEX_MODEL ?? DEFAULT_CODEX_MINI_MODEL,
      systemPrompt: '',
      userName: 'Michael',
      ...overrides,
    };
    updateCodexProviderSettings(settings, { enabled: true });
    return {
      settings,
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_CODEX_CLI ?? 'codex',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: () => undefined,
    };
  }

  async function createHarness(
    overrides: Record<string, unknown> = {},
    vaultAdapter?: ReturnType<typeof createDurableInMemoryVaultAdapter>,
  ) {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-codex-projection-'));
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const host = new ExecutionKernelHost({
      storage: new VaultDurableStorage(createDurableInMemoryVaultAdapter()),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const plugin = createPlugin(vault, overrides);
    const execution = new CodexExecution(plugin, host.registry);
    const connections = new NodeCodexExecutionConnectionFactory({
      activeLaunchSpec: new CodexActiveLaunchSpec(
        () => resolveCodexAppServerLaunchSpec(plugin, 'codex'),
      ),
    });
    // The daemon's own traffic, so a row that surprises says what was sent
    // rather than only what came back. Row C needed it: it stayed green under
    // two different breaks, and only the wire says which call resumed a thread.
    const sent: string[] = [];
    host.registerBackend(execution.createBackendRegistration({
      create: () => {
        const connection = connections.create();
        const request = connection.request.bind(connection);
        (connection as { request: unknown }).request = async (
          method: string,
          params: unknown,
          timeoutMs?: number,
        ) => {
          // `thread/*` in full, untruncated. Row C's assertion is about the id
          // one of them carried, and the first version of this capped the line
          // at 4000 characters — `baseInstructions` is longer than that on its
          // own, so the id fell off the end and the row read as Codex resuming
          // a thread it had not been given.
          sent.push(`${method} ${method.startsWith('thread/')
            ? JSON.stringify(params)
            : JSON.stringify(params).slice(0, 90)}`);
          return request(method, params, timeoutMs);
        };
        return connection;
      },
    }));
    await host.start();

    const runtime = execution.createRuntime();
    const harness = await openChatProjection({
      backendId: codexProviderModule.execution.descriptor.backendId,
      conversationId: CONVERSATION_ID,
      lifecycle: host.registry,
      providerId: 'codex',
      runtime,
      // The vault the CLI is working in, so the column normalizes a written
      // file's path against the same root the product would.
      vaultPath: vault,
      ...(vaultAdapter ? { vaultAdapter } : {}),
      // Codex's presenter holds the daemon's thread for *this* conversation, and
      // the tab is showing one from the moment it opens. Syncing is what
      // `ConversationController` does there, and without it the presenter would
      // be answering about a conversation it was never told about.
      syncConversation: true,
    });
    const release = async (): Promise<void> => {
      await harness.close();
      execution.dispose();
      await host.dispose();
      rmSync(vault, { force: true, recursive: true });
    };
    running.push(release);
    runtimes.set(harness.tab, runtime);
    return { harness, release, runtime, sent };
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
    expect(completed.terminal.kind).toBe('succeeded');
    expect(column.chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);
    // Matrix row 5, and the first provider content this path has ever drawn:
    // Codex answers through its presenter rather than only as `output-delta`.
    expect(column.drawn.join('').trim()).not.toBe('');
    // Matrix row 2. The legacy adapter path sees this answer three times —
    // recorded against `CodexLiveSmoke` row 1 — so this is the row that says
    // whether the projection carries that duplication or not.
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

  it('row B: draws a tool call and its result in the column', async () => {
    const { harness } = await createHarness({ permissionMode: 'full_access' });
    const { column, tab } = harness;
    const text = 'Run the shell command `echo grimoire-projection` and then reply with exactly: done';

    const submitted = await tab.send({ text }, userMessage(text));
    await submitted.ticket.completion;
    await tab.settled();

    report('ROW B', JSON.stringify(column.chunks.map(chunk => (
      chunk.type === 'tool_use'
        ? `tool_use:${chunk.name}:${chunk.id ?? '-'}`
        : chunk.type === 'tool_result'
          ? `tool_result:${chunk.id}:${String(chunk.content).slice(0, 30).replaceAll('\n', ' ')}`
          : chunk.type
    ))));
    // The presenter's items reaching the column through `openTurnBlock`, which
    // is the whole of what a provider brings to this path that Antigravity did
    // not. Asserted on the chunks rather than the text, because a tool call is
    // not text and this is the channel it travels on.
    expect(column.chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
    const results = column.chunks.filter(chunk => chunk.type === 'tool_result');
    expect(results.some(chunk => String(chunk.content).includes('grimoire-projection'))).toBe(true);
    // **Codex sends one call's result twice** — once when the item completes and
    // again from `flushPendingRawToolOutputs` at `turn.completed`, because the
    // raw `function_call_output` arrives after the item did and the consume that
    // was meant to claim it found nothing. Observed live on 2026-08-27.
    //
    // It is not a finding about this path and this row says so by asserting the
    // shape rather than the count: every result names a call the turn actually
    // made, and `StreamController.handleToolResult` looks a result up by id and
    // updates the call in place, so the repeat lands on the same card on both
    // paths. What a chunk recorder sees is what the controller merges.
    const calls = new Set(column.chunks
      .filter(chunk => chunk.type === 'tool_use')
      .map(chunk => chunk.id));
    expect(calls.size).toBeGreaterThan(0);
    expect(results.filter(chunk => !calls.has(chunk.id))).toHaveLength(0);
  });

  it('row D: sends steered input into a turn that is already running', async () => {
    // **Codex is the only provider that declares steering**, and the flip took
    // it away without saying so: the adapter's `steer` acts on the run *it*
    // started, and on this path the coordinator starts it — so a steer answered
    // `false` for every turn and the controller quietly put the message back in
    // the queue, which is what a provider that never supported steering looks
    // like.
    const { harness } = await createHarness({ permissionMode: 'full_access' });
    const { column, sessions, tab } = harness;

    // A turn that is still running when the steer arrives, and deliberately: a
    // steer is refused once the run is terminal, which is correct and is not
    // what this row is about. The first version asked the model to count to
    // twenty — it answered all twenty before the steer was sent, and the row
    // read as the defect it was written to prove was fixed.
    const first = 'Run the shell command `sleep 30`, then reply with exactly: slept';
    const submitted = await tab.send({ text: first }, userMessage(first));
    await waitFor('the turn to reach the provider', 60_000, () => (
      column.chunks.some(chunk => chunk.type === 'tool_use') ? true : undefined
    ));

    const steered = 'Stop counting. Reply with exactly: steered';
    const accepted = await tab.steer(
      runtimeOf(harness).turnEncoder.prepareTurn({ text: steered }),
      userMessage(steered),
    );
    const completed = await submitted.ticket.completion;
    await tab.settled();

    report('ROW D', String(accepted), completed.terminal.kind,
      JSON.stringify(column.drawn.join('').slice(-160)));
    expect(accepted).toBe(true);
    // The steered question is in the transcript, not only in the provider's
    // context: the legacy path drew it from the provider's echo, which this one
    // filters out as turn framing.
    const stored = await sessions.records.read(CONVERSATION_ID);
    const questions = stored.kind === 'present'
      ? (stored.metadata.messages ?? []).filter(message => message.role === 'user')
      : [];
    report('ROW D stored', JSON.stringify(questions.map(message => message.content.slice(0, 40))));
    expect(questions).toHaveLength(2);
    expect(questions[1]?.content).toContain('steered');

    // **And the order the surface holds, because that is what gets written over
    // the record.** The barrier writes the answer last, so the column has drawn
    // the answer's bubble before the steered question arrives; the target moves
    // it in front of the turn it joined. That move was a no-op in every real tab
    // until this run — `ChatState.messages` answers with a copy, and the reorder
    // was performed on it — which left `ConversationController.save` writing a
    // question that follows its own answer, and the next turn reading it that
    // way.
    report('ROW D order', JSON.stringify(column.state.messages.map(message => message.role)));
    expect(column.state.messages.map(message => message.role))
      .toEqual(['user', 'user', 'assistant']);
    await harness.saveAfterTurn();
    const saved = await sessions.records.read(CONVERSATION_ID);
    expect(saved.kind === 'present' ? (saved.metadata.messages ?? []).map(m => m.role) : [])
      .toEqual(['user', 'user', 'assistant']);
  });

  it('row C: resumes the thread after a reload, from what the vault kept', async () => {
    // A reload, not a second turn. The first version of this row sent both
    // turns through one live kernel and stayed **green with `nativeSessionRef`
    // deleted from the composition** — the coordinator reuses the conversation's
    // open session, so the daemon's thread was still there to answer from and
    // nothing was resuming anything. A green break is a missing test until
    // proven otherwise, and this was one.
    const vaultAdapter = createDurableInMemoryVaultAdapter();
    const first = await createHarness({}, vaultAdapter);

    const remember = 'Remember the word "tomato". Reply with exactly: ok';
    await (await first.harness.tab.send(
      { text: remember },
      userMessage(remember),
    )).ticket.completion;
    await first.harness.tab.settled();
    // The surface's own half of the save, which is where the thread lands.
    await first.harness.saveAfterTurn();

    const afterFirst = await first.harness.sessions.records.read(CONVERSATION_ID);
    const nativeSessionRef = afterFirst.kind === 'present'
      ? afterFirst.metadata.sessionId ?? undefined
      : undefined;
    report('ROW C thread', String(nativeSessionRef));
    expect(nativeSessionRef).toBeTruthy();

    // Everything goes: the daemon, the kernel, the coordinator and the tab. What
    // survives is the vault, which is all a reload has.
    await first.release();

    const second = await createHarness({}, vaultAdapter);
    const { column, sessions, tab } = second.harness;
    // The transcript goes too, and this is the whole of what makes the row
    // decisive. The composition encodes the history the vault has into every
    // request, so a second turn with the transcript in front of it answers from
    // the transcript — which is why this row stayed green with the thread
    // deleted from the command *and* with the conversation never synced. What
    // is left after this is the daemon's thread or nothing.
    await sessions.records.apply(CONVERSATION_ID, current => ({ ...current, messages: [] }));
    const ask = 'What word did I ask you to remember? Reply with just that word.';
    const submitted = await tab.send(
      { text: ask },
      userMessage(ask),
      ...(nativeSessionRef ? [{ nativeSessionRef }] as const : []),
    );
    const completed = await submitted.ticket.completion;
    await tab.settled();

    report('ROW C', completed.terminal.kind, JSON.stringify(column.drawn.join('').slice(0, 160)));
    const threadCalls = second.sent.filter(line => line.startsWith('thread/'));
    report('ROW C wire', JSON.stringify(threadCalls.map(line => line.slice(0, 200))));
    report('ROW C sent', JSON.stringify(second.sent.map(line => line.split(' ')[0])));
    report('ROW C carries', JSON.stringify(second.sent
      .filter(line => line.includes(String(nativeSessionRef)))
      .map(line => line.split(' ')[0])));
    // **The half the model's answer cannot prove.** With no thread to go on,
    // Codex opens a new one and answers from nothing — but the answer alone
    // stayed true through three separate breaks, because the conversation's
    // transcript is replayed into every request and, once that was emptied,
    // because **the thread is carried twice**: as `nativeSessionRef` on the
    // kernel command, which restores it at session open, and inside the request
    // reference, from the conversation binding the runtime was synced with.
    // Either one alone resumes, so breaking either alone is invisible. What
    // separates a resume from a coincidence is the id on the wire, and this row
    // is red only when both carriers are gone — which is when `thread/start`
    // replaces `thread/resume` and the model has never heard of the word.
    expect(threadCalls.some(line => (
      line.startsWith('thread/resume') && line.includes(String(nativeSessionRef))
    ))).toBe(true);
    expect(completed.terminal.kind).toBe('succeeded');
    // The thread carried, proven by the model answering from a context this
    // build did not hand it: the vault's copy of the conversation is empty, so
    // the only place "tomato" can come from is the daemon's own thread.
    expect(column.drawn.join('').toLowerCase()).toContain('tomato');
    // And the conversation is still on the one thread, not a second.
    await second.harness.saveAfterTurn();
    const afterSecond = await sessions.records.read(CONVERSATION_ID);
    expect(afterSecond.kind === 'present' ? afterSecond.metadata.sessionId : null)
      .toBe(nativeSessionRef);
  });

  // Matrix rows 11, 12 and 13, driven rather than watched: a turn that outlives
  // the tab that started it, one run drawn into two surfaces, and the count the
  // context meter reads. The bodies are shared with every other provider's file
  // — see `chatProjectionSurfaceRows` — because what they certify is the path
  // rather than the provider.
  // Codex reports usage on every turn, so row G applies.
  const surfaceRows = chatProjectionSurfaceRows({
    createHarness: async () => (await createHarness()).harness,
    report,
  });

  it('row E: finishes a turn whose tab closed, and stores it', async () => {
    await surfaceRows.tabClosedMidTurn();
  });

  it('row F: draws one turn into both surfaces on the conversation', async () => {
    await surfaceRows.twoSurfacesOneConversation();
  });

  it('row G: leaves the turn\'s usage on the column and in the conversation', async () => {
    await surfaceRows.usageAfterTurn();
  });

  it('row H: holds queued input until the running turn is durable', async () => {
    await surfaceRows.queuedInputWaitsForDurability();
  });

  it('row I: reports a completed plan for a plan-mode turn', async () => {
    // **Matrix row 1's untested half.** Grimoire's own plan approval appears
    // after a turn only when the turn says a plan was completed, and Codex is
    // the one provider that ever said so: it reads its own plan mode and its own
    // plan deltas. What the matrix calls untested is exactly this — not the
    // wiring, but whether a provider's ids reach it.
    const { harness, runtime } = await createHarness({ permissionMode: 'plan' });
    const { column, tab } = harness;
    const text = 'Plan how you would add a README to this project, in at least three steps. '
      + 'Do not write any files.';

    const submitted = await tab.send({ text }, userMessage(text));
    const completed = await submitted.ticket.completion;
    await tab.settled();

    const reading = harness.providerTurnMetadata.at(-1);
    report(
      'ROW I',
      completed.terminal.kind,
      `provider=${String(reading?.planCompleted)}`,
      `completion=${String(completed.planCompleted)}`,
      JSON.stringify(column.drawn.join('').slice(0, 80)),
    );
    expect(completed.terminal.kind).toBe('succeeded');
    // **Whatever the provider said, the surface heard.** Not "a plan turn
    // reports a plan": Codex reports one only when the model actually produces
    // plan items, and a row that asserted that would be reading the model's
    // answer as proof of a mechanism — it passed alone and failed in a full run
    // on the same code. This holds either way, and goes red the moment the two
    // halves disagree, which is the state this row found on 2026-08-30: the
    // provider holding `planCompleted: true` and the completion holding
    // `undefined`, so the approval never appeared.
    expect(completed.planCompleted === true).toBe(reading?.planCompleted === true);
    // The tab is the one reader, and it consumed what it read: nothing is left
    // on the runtime for a second one, which is what keeps it once per turn.
    expect(runtime.consumeTurnMetadata().planCompleted).toBeUndefined();
  });
});
