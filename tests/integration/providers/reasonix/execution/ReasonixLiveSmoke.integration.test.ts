import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { reasonixPlanUsageStore } from '@/providers/reasonix/app/ReasonixPlanUsageStore';
import { ReasonixExecution } from '@/providers/reasonix/execution/ReasonixExecutionComposition';
import { getReasonixProviderSettings, updateReasonixProviderSettings } from '@/providers/reasonix/settings';

/**
 * The Reasonix composition against a real `reasonix acp` process.
 *
 * The manual smoke matrix has two halves: what the protocol does, and what the
 * surface draws. This is the first half, run headlessly — a real agent, real
 * turns, the path end to end. First run 2026-09-09 against `reasonix 3000.6.14`.
 *
 * Off by default: it starts a CLI and spends the account's credits, so CI must
 * never reach it. Run it with `GRIMOIRE_REASONIX_LIVE=1`; `reasonix setup` first.
 */
const live = process.env.GRIMOIRE_REASONIX_LIVE === '1' ? describe : describe.skip;

live('Reasonix live smoke', () => {
  jest.setTimeout(300_000);

  /** Every process this file started, released whatever the row did. */
  const running: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const release of running.splice(0).reverse()) {
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
    updateReasonixProviderSettings(settings, { enabled: true });
    if (typeof overrides.permissionMode === 'string') {
      // Both halves, because the toolbar writes both and the projection prefers
      // whichever this provider last saved.
      updateReasonixProviderSettings(settings, { selectedMode: overrides.permissionMode });
      settings.savedProviderPermissionMode = { reasonix: overrides.permissionMode };
    }
    return {
      settings,
      manifest: { version: '0.0.0-live' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_REASONIX_CLI ?? 'reasonix',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: (record: Record<string, unknown>) => {
        if (process.env.GRIMOIRE_REASONIX_TRACE === '1') {
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
    execution: ReasonixExecution;
    plugin: any;
    vault: string;
    /** Stops the agent, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-reasonix-live-'));
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
    const execution = new ReasonixExecution(plugin, host.registry);
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

  /** The `reasonix acp` processes this run is responsible for. */
  function agents(): string[] {
    return ownedProcesses(command => command.includes('reasonix') && /\bacp\b/.test(command))
      .map(row => row.command);
  }

  it.each(['normal', 'plan', 'full_access'])('row 1: answers a plain message, and streams it (%s)', async permissionMode => {
    const { runtime, shutdown } = await createHarness({ permissionMode });

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
    // Only one half is on the wire. Reasonix sends no `usage_update` and its
    // status notification states no window size, so the badge reports the
    // turn's tokens and says the window is not authoritative.
    expect(usage?.usage.contextTokens).toBeGreaterThan(0);
    expect(usage?.usage.inputTokens).toBeGreaterThan(0);
    expect(usage?.usage.contextWindowIsAuthoritative).toBe(false);
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

  it.each(['auto', 'enabled'])('row 7: continues the same session on a second turn (effort %s)', async effortLevel => {
    const { runtime, plugin, shutdown } = await createHarness({ permissionMode: 'normal' });
    updateReasonixProviderSettings(plugin.settings, {
      effortLevel,
      availableEfforts: [{ id: 'enabled', name: 'Enabled' }],
    });
    const word = mintedWord();
    const first = await drain(runtime.query(runtime.prepareTurn({
      text: `For this conversation only, the code word is ${word}. `
        + 'Do not use tools or save it to persistent memory. Reply with exactly: OK',
    })));
    report('ROW 7 FIRST', JSON.stringify(summarize(first)));
    expect(errorsOf(first)).toEqual([]);
    expect(answerOf(first)).toContain('OK');
    expect(first.some(chunk => chunk.type === 'tool_use')).toBe(false);
    const sessionId = runtime.getSessionId();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'What is the code word from my previous message? Do not use tools. Reply with the word only.',
    })));

    report('ROW 7', String(sessionId), JSON.stringify(summarize(chunks)));
    expect(sessionId).toBeTruthy();
    expect(runtime.getSessionId()).toBe(sessionId);
    expect(answerOf(chunks).toLowerCase()).toContain(word);
    await shutdown();
  });

  it.each(['auto', 'enabled'])('row 8: restores history after a process restart (effort %s)', async effortLevel => {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-reasonix-resume-'));
    running.push(async () => { rmSync(vault, { force: true, recursive: true }); });
    const settings = { permissionMode: 'normal' };
    const first = await createHarness(settings, vault);
    updateReasonixProviderSettings(first.plugin.settings, {
      effortLevel,
      availableEfforts: [{ id: 'enabled', name: 'Enabled' }],
    });
    const word = mintedWord();
    const text = `For this conversation only, the code word is ${word}. `
      + 'Do not use tools or save it to persistent memory. Reply with exactly: OK';
    const conversation: any = { id: 'conv-live', providerState: {}, sessionId: null };
    first.runtime.syncConversationState(conversation);
    const initial = await drain(first.runtime.query(first.runtime.prepareTurn({ text })));
    expect(errorsOf(initial)).toEqual([]);
    expect(answerOf(initial)).toContain('OK');
    expect(initial.some(chunk => chunk.type === 'tool_use')).toBe(false);
    const updates = first.runtime.sessionBinding({ conversation, sessionInvalidated: false }) ?? {};
    const history = [
      { id: 'user-1', role: 'user' as const, content: text, timestamp: 1 },
      { id: 'assistant-1', role: 'assistant' as const, content: answerOf(initial), timestamp: 2 },
    ];
    await first.shutdown();

    const second = await createHarness(settings, vault);
    updateReasonixProviderSettings(second.plugin.settings, {
      effortLevel,
      availableEfforts: [{ id: 'enabled', name: 'Enabled' }],
    });
    second.runtime.syncConversationState({ ...conversation, sessionId: updates.sessionId });
    const chunks = await drain(second.runtime.query(second.runtime.prepareTurn({
      text: 'What is the code word from my previous message? Do not use tools. Reply with the word only.',
    }), history));
    report('ROW 8', effortLevel, JSON.stringify(updates),
      'resumed-as:', String(second.runtime.getSessionId()), JSON.stringify(summarize(chunks)));
    expect(updates.sessionId).toBeTruthy();
    expect(second.runtime.getSessionId()).toBe(updates.sessionId);
    expect(errorsOf(chunks)).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'tool_use')).toBe(false);
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
    // Reasonix asks for the write itself as well; the ask below is
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
    // Reasonix's own gate is the one that asks here, and it names the file it
    // is asking about — so the ask is its title rather than Grimoire's `write`,
    // which is the ask row 12/13 sees on top of it when this one allows.
    expect(asked.some(tool => tool.startsWith('write_file'))).toBe(true);
    // The refusal reaches the agent as its own tool's result.
    expect(results.some(result => result.includes('blocked by permission policy'))).toBe(true);
    // **What this row cannot promise is the file.** It was absent when this ran
    // on 2026-09-09, and the agent said so in prose rather than routing around
    // the refusal. But `tool_approval: ask` gates only the tools Reasonix
    // classifies as permission-gated, and a shell command it judges read-only
    // runs unasked — `ls -a` completed in the same turn a `write_file` raised a
    // request. The seam that would close that is terminal delegation, which no
    // provider drives yet; until then the ceiling is written down beside the
    // mode mapping.
    await shutdown();
  });

  it('row 16: runs the turn in the mode the tab is set to', async () => {
    // Grimoire's `plan` happens to be spelled the same as this agent's, but
    // Safe and Auto-approve are not, and the posture is a second call either
    // way. What proves the translation landed is the agent behaving like a
    // read-only session. Observed 2026-09-09: Reasonix in `plan` emits `plan`
    // updates and then asks to leave Plan mode, which this row denies.
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

    const stored = getReasonixProviderSettings(plugin.settings);
    report('ROW 17', String(discovered), String(stored.discoveredModels.length),
      JSON.stringify(stored.discoveredModels.slice(0, 3).map(model => model.rawId)),
      JSON.stringify(stored.availableModes.map(mode => mode.id)));
    expect(discovered).toBe(true);
    expect(stored.discoveredModels.length).toBeGreaterThan(0);
    expect(stored.availableModes.map(mode => mode.id)).toEqual(
      expect.arrayContaining(['normal', 'plan', 'goal']),
    );
    await shutdown();
  });

  it('row 18: learns which reasoning levels this model takes', async () => {
    // The levels are the provider block's, not Grimoire's: one with
    // `supported_efforts` offers disabled/low/high/max, one without gets the
    // built-in set for its kind. Whatever this account is configured with, the
    // session must be the source and `auto` must not be among them — it is the
    // picker's own default, not a level the agent takes.
    const { execution, plugin, shutdown } = await createHarness();

    await execution.metadata.discoverMetadata();

    const stored = getReasonixProviderSettings(plugin.settings);
    report('ROW 18', JSON.stringify(stored.availableEfforts));
    expect(stored.availableEfforts.length).toBeGreaterThan(0);
    expect(stored.availableEfforts.map(effort => effort.id)).not.toContain('auto');
    await shutdown();
  });

  it('row 19: shows the spend when there is spend to show', async () => {
    reasonixPlanUsageStore.reset();
    const { runtime, plugin, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const usage = reasonixPlanUsageStore.getCachedUsage({
      plugin,
      providerId: 'reasonix',
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
