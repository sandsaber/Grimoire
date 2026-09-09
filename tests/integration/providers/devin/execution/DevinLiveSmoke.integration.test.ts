import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { devinPlanUsageStore } from '@/providers/devin/app/DevinPlanUsageStore';
import { DevinExecution } from '@/providers/devin/execution/DevinExecutionComposition';
import { getDevinProviderSettings, updateDevinProviderSettings } from '@/providers/devin/settings';

/**
 * The Devin composition against a real `devin acp` process.
 *
 * The manual smoke matrix has two halves: what the protocol does, and what the
 * surface draws. This is the first half, run headlessly — a real agent, real
 * turns, the path end to end. First run 2026-09-09 against `devin 3000.6.14`.
 *
 * Off by default: it starts a CLI and spends the account's credits, so CI must
 * never reach it. Run it with `GRIMOIRE_DEVIN_LIVE=1`; `devin auth login` first.
 */
const live = process.env.GRIMOIRE_DEVIN_LIVE === '1' ? describe : describe.skip;

live('Devin live smoke', () => {
  jest.setTimeout(300_000);

  /** Every process this file started, released whatever the row did. */
  const running: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
  });

  function createPlugin(vault: string, overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'full_access',
      mediaFolder: 'media',
      systemPrompt: '',
      userName: 'Michael',
      ...overrides,
    };
    updateDevinProviderSettings(settings, { enabled: true });
    if (typeof overrides.permissionMode === 'string') {
      // Both halves, because the toolbar writes both and the projection prefers
      // whichever this provider last saved.
      updateDevinProviderSettings(settings, { selectedMode: overrides.permissionMode });
      settings.savedProviderPermissionMode = { devin: overrides.permissionMode };
    }
    return {
      settings,
      manifest: { version: '0.0.0-live' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_DEVIN_CLI ?? 'devin',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: (record: Record<string, unknown>) => {
        if (process.env.GRIMOIRE_DEVIN_TRACE === '1') {
          report('LOG', JSON.stringify(record).slice(0, 400));
        }
      },
      saveSettings: async () => undefined,
    };
  }

  async function createHarness(
    overrides: Record<string, unknown> = {},
    reuseVault?: string,
  ): Promise<{
    runtime: any;
    execution: DevinExecution;
    plugin: any;
    vault: string;
    /** Stops the agent, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-devin-live-'));
    mkdirSync(vault, { recursive: true });
    if (!existsSync(join(vault, 'Note.md'))) {
      writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    }
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const plugin = createPlugin(vault, overrides);
    const execution = new DevinExecution(plugin, host.registry);
    host.registerBackend(execution.createBackendRegistration());
    await host.start();
    const release = async (): Promise<void> => {
      execution.dispose();
      await host.dispose();
      // Only the vault this harness made: a row that hands its vault on — a
      // reload — must not have it deleted underneath.
      if (!reuseVault) {
        rmSync(vault, { force: true, recursive: true });
      }
    };
    running.push(release);
    return {
      execution,
      plugin,
      vault,
      runtime: execution.createRuntime(),
      shutdown: release,
    };
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

  /** What the run saw, for the person reading the output rather than the assertions. */
  function report(...parts: readonly string[]): void {
    process.stdout.write(`${parts.join(' ')}\n`);
  }

  function summarize(chunks: readonly StreamChunk[]): string[] {
    return chunks.map(chunk => (
      chunk.type === 'text' || chunk.type === 'thinking'
        ? `${chunk.type}:${chunk.content.slice(0, 40).replaceAll('\n', ' ')}`
        : chunk.type === 'tool_use'
          ? `tool_use:${chunk.name}`
          : chunk.type === 'tool_result'
            ? `tool_result:${String(chunk.content).slice(0, 40).replaceAll('\n', ' ')}`
            : chunk.type === 'notice'
              ? `notice:${JSON.stringify(chunk).slice(0, 200)}`
              : chunk.type === 'error'
                ? `error:${chunk.content.slice(0, 160).replaceAll('\n', ' ')}`
                : chunk.type
    ));
  }

  function answerOf(chunks: readonly StreamChunk[]): string {
    return chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
      .map(chunk => chunk.content)
      .join('');
  }

  function errorsOf(chunks: readonly StreamChunk[]): string[] {
    return chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content);
  }

  /** The `devin acp` processes this run is responsible for. */
  function agents(): string[] {
    return ownedProcesses(command => command.includes('devin') && /\bacp\b/.test(command))
      .map(row => row.command);
  }

  it('row 1: answers a plain message, and streams it', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: OK' }),
    ));

    report('ROW 1', JSON.stringify(summarize(chunks)));
    expect(errorsOf(chunks)).toEqual([]);
    expect(answerOf(chunks)).toContain('OK');
    // The message-start chunk this used to require is gone. It never reached a
    // surface — the tab binding filters framing off the content channel — and
    // the message the answer hangs on is opened by the projection, from the
    // run. What a live row can still see is the answer above.
    expect(runtime.consumeTurnMetadata()).toMatchObject({ wasSent: true });
    await shutdown();
  });

  it('row 2: shows a tool call and its result', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Read the file Note.md in the working directory and reply with its first line only.',
    })));

    report('ROW 2', JSON.stringify(summarize(chunks)));
    // The agent's own word for the tool, because this provider has no tool
    // stream adapter — what the card says is what the agent called it.
    expect(chunks.some(chunk => chunk.type === 'tool_use' && chunk.name !== 'tool')).toBe(true);
    expect(chunks.some(chunk => chunk.type === 'tool_result')).toBe(true);
    await shutdown();
  });

  it('row 5: reports the context window and the tokens the prompt cost', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const usage = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage')
      .at(-1);
    report('ROW 5', JSON.stringify(usage?.usage ?? null));
    // Both halves are on the wire: `devin-wire.json` seq 35 is
    // `usage_update {used: 13652, size: 200000}`, and seq 37 answers the
    // prompt with `usage: {inputTokens: 13622, outputTokens: 30, ...}`.
    expect(usage?.usage.contextWindow).toBeGreaterThan(0);
    expect(usage?.usage.contextTokens).toBeGreaterThan(0);
    expect(usage?.usage.inputTokens).toBeGreaterThan(0);
    await shutdown();
  });

  /**
   * A word minted for one row, because this CLI remembers across sessions.
   *
   * Qwen's harness learned this the hard way: an agent that keeps memories
   * across sessions recalls a previous run's word. A word minted this minute
   * cannot be answered from anything a previous run left.
   */
  function mintedWord(): string {
    return `grimoire${Math.random().toString(36).slice(2, 8)}`;
  }

  it('row 7: continues the same session on a second turn', async () => {
    const { runtime, shutdown } = await createHarness();
    const word = mintedWord();
    await drain(runtime.query(runtime.prepareTurn({
      text: `Remember the word ${word}. Reply with exactly: OK`,
    })));
    const sessionId = runtime.getSessionId();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'What word did I ask you to remember? Reply with the word only.',
    })));

    report('ROW 7', String(sessionId), JSON.stringify(summarize(chunks)));
    expect(sessionId).toBeTruthy();
    expect(runtime.getSessionId()).toBe(sessionId);
    expect(answerOf(chunks).toLowerCase()).toContain(word);
    await shutdown();
  });

  it('row 8: resumes the conversation a fresh load was told about', async () => {
    const first = await createHarness();
    const word = mintedWord();
    const conversation: any = { id: 'conv-live', messages: [], providerState: {}, sessionId: null };
    first.runtime.syncConversationState(conversation);
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: `Remember the word ${word}. Reply with exactly: OK`,
    })));
    const updates = first.runtime.sessionBinding({
      conversation,
      sessionInvalidated: false,
    }) ?? {};
    await first.shutdown();

    // A different composition, a different process. The binding is an id and a
    // marker that is usually empty — until 2026-08-30 it was the id alone, which
    // is why this provider had nowhere to remember that a session had been
    // replaced.
    const second = await createHarness({}, first.vault);
    second.runtime.syncConversationState({
      ...conversation,
      sessionId: updates.sessionId,
    });
    const chunks = await drain(second.runtime.query(second.runtime.prepareTurn({
      text: 'What word did I ask you to remember? Reply with the word only.',
    })));

    report('ROW 8', JSON.stringify(updates),
      'resumed-as:', String(second.runtime.getSessionId()),
      JSON.stringify(summarize(chunks)));
    expect(updates.sessionId).toBeTruthy();
    // **One field, and empty is the point.** This provider used to write no
    // state at all — its binding was an id and nothing else, which this row
    // asserted. It carries a session-drop marker now, and a conversation whose
    // session resumed is written back as `{}` rather than left alone: the
    // surface replaces `providerState` whole, so an omitted opinion would leave
    // a stale marker standing with no way to take it down.
    expect(updates.providerState).toEqual({});
    expect(answerOf(chunks).toLowerCase()).toContain(word);
    await second.shutdown();
  });

  it('row 9: says what a session the agent no longer has needs the person to do', async () => {
    const { runtime, shutdown } = await createHarness();
    runtime.syncConversationState({
      id: 'conv-missing',
      messages: [],
      providerState: {},
      sessionId: '00000000-0000-4000-8000-000000000000',
    });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    report('ROW 9', String(runtime.getSessionId()), JSON.stringify(errorsOf(chunks)),
      String(runtime.isSessionDropped()), JSON.stringify(summarize(chunks)));
    // **Now observed.** Either outcome is correct — an agent that names the
    // session as missing lets the backend replace it, and one that answers
    // something vaguer keeps the binding and says so in words. What must not
    // happen is the third thing, which is what this CLI did until 2026-08-30: a
    // turn that silently starts a new conversation and leaves the old one
    // unreachable with nothing on screen to say so. The replacement is right;
    // the silence was the defect, and this provider had no `session-resume`
    // branch and no `sessionDropped` to end it with.
    const replaced = runtime.getSessionId() !== '00000000-0000-4000-8000-000000000000';
    expect(replaced || errorsOf(chunks).length > 0).toBe(true);
    expect(replaced ? runtime.isSessionDropped() : true).toBe(true);
    await shutdown();
  });

  it('rows 12 and 13: asks before it writes, and writes what was allowed', async () => {
    // In `accept-edits` Devin auto-approves the write itself; the ask below is
    // Grimoire's own, raised from `fs/write_text_file` by the workspace file
    // system. That is the whole of what makes this mode Safe.
    const { runtime, vault, shutdown } = await createHarness({ permissionMode: 'normal' });
    const asked: Array<{ tool: string; description: string }> = [];
    runtime.installInteractions({ approval: async (tool: string, _input: unknown, description: string) => {
      asked.push({ tool, description });
      return 'allow';
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called allowed-live.txt in the working directory containing '
        + 'the word yes, then reply with exactly: done',
    })));

    report('ROW 12/13', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    expect(existsSync(join(vault, 'allowed-live.txt'))).toBe(true);
    await shutdown();
  });

  it('row 15: refuses the write, and the agent hears the refusal', async () => {
    const { runtime, vault, shutdown } = await createHarness({ permissionMode: 'normal' });
    const asked: string[] = [];
    runtime.installInteractions({ approval: async (tool: string) => {
      asked.push(tool);
      return 'deny';
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called refused-live.txt in the working directory containing '
        + 'the word no, then reply with exactly: done',
    })));

    const results = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_result' }> => chunk.type === 'tool_result')
      .map(chunk => String(chunk.content));
    report('ROW 15', JSON.stringify(asked), String(existsSync(join(vault, 'refused-live.txt'))),
      JSON.stringify(summarize(chunks)));
    expect(asked).toContain('write');
    // The refusal reaches the agent through the write it asked for.
    expect(results.some(result => result.includes('not approved'))).toBe(true);
    // **What this row cannot promise is the file.** Observed 2026-09-09: told
    // no, Devin wrote it with `echo no > refused-live.txt` through its own
    // shell — a command its `accept-edits` classifier auto-approves as
    // read-only, redirect and all, where `printf` asks. The only seam that
    // would close it is terminal delegation, which no provider drives yet;
    // until then the ceiling is written down beside the mode mapping.
    await shutdown();
  });

  it('row 16: runs the turn in the mode the tab is set to', async () => {
    // Grimoire's `plan` is not one of this agent's own ids; a turn that
    // forwarded it would be refused by `set_config_option` before the prompt
    // was ever sent. What proves the translation landed is the agent behaving
    // like a read-only session. Observed 2026-09-09: Devin in `plan` answers in
    // prose that it is in Plan mode and asks how to proceed — it raises no
    // plan-exit permission the way Qwen does, so none is asserted.
    const { runtime, vault, shutdown } = await createHarness({ permissionMode: 'plan' });
    const asked: string[] = [];
    runtime.installInteractions({ approval: async (tool: string) => {
      asked.push(tool);
      return 'deny';
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called planned-live.txt in the working directory containing '
        + 'the word no, then reply with exactly: done',
    })));

    report('ROW 16', JSON.stringify(asked), JSON.stringify(errorsOf(chunks)),
      JSON.stringify(summarize(chunks)));
    expect(chunks.length).toBeGreaterThan(0);
    // And it ran read-only: Plan is the mode that reads and does not write.
    expect(existsSync(join(vault, 'planned-live.txt'))).toBe(false);
    await shutdown();
  });

  it('row 17: fills the model catalog from an empty vault', async () => {
    const { execution, plugin, shutdown } = await createHarness();

    const discovered = await execution.metadata.discoverMetadata();

    const stored = getDevinProviderSettings(plugin.settings);
    report('ROW 17', String(discovered), String(stored.discoveredModels.length),
      JSON.stringify(stored.discoveredModels.slice(0, 3).map(model => model.rawId)),
      JSON.stringify(stored.availableModes.map(mode => mode.id)));
    expect(discovered).toBe(true);
    expect(stored.discoveredModels.length).toBeGreaterThan(0);
    expect(stored.availableModes.map(mode => mode.id)).toEqual(
      expect.arrayContaining(['accept-edits', 'plan', 'bypass']),
    );
    await shutdown();
  });

  it('row 19: shows the spend when there is spend to show', async () => {
    devinPlanUsageStore.reset();
    const { runtime, plugin, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const usage = devinPlanUsageStore.getCachedUsage({
      plugin,
      providerId: 'devin',
      settings: plugin.settings,
    });
    report('ROW 19', JSON.stringify(usage ?? null), JSON.stringify(summarize(chunks).slice(-3)));
    // Spend-only, and fed from the wire or not at all: this provider has no
    // session log a missing cost could be read out of. A plan that charges
    // nothing per turn makes an empty indicator the honest answer, so what is
    // recorded here is what was seen rather than what was required.
    expect(errorsOf(chunks)).toEqual([]);
    await shutdown();
  });

  it('row 6: cancels a running turn and leaves no agent behind', async () => {
    if (process.platform === 'win32') {
      report('ROW 6 skipped: Windows job-object ownership is not observable this way');
      return;
    }
    const { runtime, shutdown } = await createHarness();
    const collected: StreamChunk[] = [];
    const started = (async () => {
      for await (const chunk of runtime.query(runtime.prepareTurn({
        text: 'Count slowly from one to fifty, one number per line.',
      }))) {
        collected.push(chunk);
      }
    })();
    for (let attempt = 0; attempt < 600 && collected.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // The row is named for a process that must be gone afterwards, so it has to
    // have been there.
    expect(agents().length).toBeGreaterThan(0);

    runtime.cancel();
    await started;

    report('ROW 6', JSON.stringify(summarize(collected).slice(-4)));
    expect(collected.length).toBeGreaterThan(0);
    await shutdown();
    expect(agents()).toEqual([]);
  });
});
