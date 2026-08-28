import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { GrokExecution } from '@/app/execution/grok/GrokExecutionComposition';
import type { StreamChunk } from '@/core/types';
import { grokPlanUsageStore } from '@/providers/grok/app/GrokPlanUsageStore';
import { loadGrokSessionCost } from '@/providers/grok/history/GrokUsageMetadataStore';
import { getGrokProviderSettings, updateGrokProviderSettings } from '@/providers/grok/settings';
import type { GrokProviderState } from '@/providers/grok/types';

/**
 * The Grok flip against a real `grok agent … stdio` process.
 *
 * The manual smoke matrix has two halves: what the protocol does, and what the
 * surface draws. This is the first half, run headlessly — a real agent, real
 * turns, the flipped path end to end — so the second half is left with only the
 * questions a person has to look at.
 *
 * Off by default: it starts a CLI and spends the account's tokens, so CI must
 * never reach it. Run it with `GRIMOIRE_GROK_LIVE=1`.
 */
const live = process.env.GRIMOIRE_GROK_LIVE === '1' ? describe : describe.skip;

live('Grok live smoke', () => {
  jest.setTimeout(300_000);

  /** Every process this file started, released whatever the row did. */
  const running: Array<() => Promise<void>> = [];
  /**
   * Every vault this file made, removed after the row rather than by the
   * harness that made it.
   *
   * Not incidental bookkeeping: Grok keeps its session store *inside* the
   * vault, under the managed home. A harness that deleted its own vault on
   * shutdown took the sessions with it, and the resume row then asked a fresh
   * process to load a session whose directory no longer existed — which Grok
   * answers, correctly, with a filesystem error.
   */
  const vaults: string[] = [];

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
    for (const vault of vaults.splice(0)) {
      rmSync(vault, { force: true, recursive: true });
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
    updateGrokProviderSettings(settings, { enabled: true });
    if (process.env.GRIMOIRE_GROK_MODEL) {
      settings.model = process.env.GRIMOIRE_GROK_MODEL;
    }
    return {
      settings,
      manifest: { version: '0.0.0-live' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_GROK_CLI ?? 'grok',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: (record: Record<string, unknown>) => {
        if (process.env.GRIMOIRE_GROK_TRACE === '1') {
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
    execution: GrokExecution;
    plugin: any;
    vault: string;
    /** Stops the agent, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-grok-live-'));
    mkdirSync(vault, { recursive: true });
    if (!reuseVault) {
      vaults.push(vault);
    }
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
    const execution = new GrokExecution(plugin, host.registry);
    host.registerBackend(execution.createBackendRegistration());
    await host.start();
    const release = async (): Promise<void> => {
      execution.dispose();
      await host.dispose();
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
            : chunk.type
    ));
  }

  function answerOf(chunks: readonly StreamChunk[]): string {
    return chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
      .map(chunk => chunk.content)
      .join('');
  }

  /** The `grok agent` processes this run is responsible for. */
  function agents(): string[] {
    return ownedProcesses(command => command.includes('grok') && command.includes('agent'))
      .map(row => row.command);
  }

  it('row 1: answers a plain message, and streams it', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: OK' }),
    ));

    report('ROW 1', JSON.stringify(summarize(chunks)));
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(answerOf(chunks)).toContain('OK');
    // The message the answer hangs on, which the surface needs before the text.
    expect(chunks.some(chunk => chunk.type === 'assistant_message_start')).toBe(true);
    expect(runtime.consumeTurnMetadata()).toMatchObject({ wasSent: true });
    await shutdown();
  });

  it('row 1b: says the answer once, whichever channel it arrives on', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Reply with exactly: unique-answer-token',
    })));

    report('ROW 1b', JSON.stringify(summarize(chunks)));
    // Some Grok releases mirror the same update onto `session/update` and onto
    // their own method. The deduplicator is per connection, and the proof it
    // works is here: the phrase appears once, not twice.
    const occurrences = answerOf(chunks).split('unique-answer-token').length - 1;
    expect(occurrences).toBe(1);
    await shutdown();
  });

  it('row 2: shows a tool call and its result', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Read the file Note.md in the working directory and reply with its first line only.',
    })));

    report('ROW 2', JSON.stringify(summarize(chunks)));
    // The normalized name, not `tool`: this is what the card is drawn from.
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
    report('ROW 5', JSON.stringify(usage?.usage));
    // The tokens come from `response_completed`, which is Grok's own channel.
    // The window comes from the session log, read while the answer is
    // committed — no Grok turn reports one on the wire.
    expect(usage?.usage.inputTokens).toBeGreaterThan(0);
    expect(usage?.usage.contextWindow).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 7: continues the same session on a second turn', async () => {
    const { runtime, shutdown } = await createHarness();
    await drain(runtime.query(runtime.prepareTurn({
      text: 'Remember the word violet. Reply with exactly: OK',
    })));
    const sessionId = runtime.getSessionId();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'What word did I ask you to remember? Reply with the word only.',
    })));

    report('ROW 7', String(sessionId), JSON.stringify(summarize(chunks)));
    expect(sessionId).toBeTruthy();
    expect(runtime.getSessionId()).toBe(sessionId);
    expect(answerOf(chunks).toLowerCase()).toContain('violet');
    await shutdown();
  });

  it('row 8: resumes the conversation a fresh load was told about', async () => {
    const first = await createHarness();
    const conversation: any = { id: 'conv-live', messages: [], providerState: {}, sessionId: null };
    // Bound the way a tab binds it, because the binding is what the session
    // patch is built from: an id and the directory its transcript is in.
    first.runtime.syncConversationState(conversation);
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: 'Remember the word cobalt. Reply with exactly: OK',
    })));
    const updates = first.runtime.buildSessionUpdates({
      conversation,
      sessionInvalidated: false,
    }).updates;
    await first.shutdown();

    // A different composition, a different process: the session is resumed by
    // what the conversation remembers.
    const second = await createHarness({}, first.vault);
    second.runtime.syncConversationState({
      ...conversation,
      providerState: updates.providerState ?? {},
      sessionId: updates.sessionId,
    });
    const chunks = await drain(second.runtime.query(second.runtime.prepareTurn({
      text: 'What word did I ask you to remember? Reply with the word only.',
    })));

    report('ROW 8', JSON.stringify(updates),
      'resumed-as:', String(second.runtime.getSessionId()),
      JSON.stringify(chunks.filter(chunk => chunk.type === 'error')),
      JSON.stringify(summarize(chunks)));
    expect(updates.sessionId).toBeTruthy();
    // Where the transcript is, without which a session id hydrates nothing.
    expect((updates.providerState as GrokProviderState)?.sessionDirPath).toBeTruthy();
    expect(answerOf(chunks).toLowerCase()).toContain('cobalt');
    await second.shutdown();
  });

  it('row 9: replaces a session the agent no longer has', async () => {
    const { runtime, shutdown } = await createHarness();
    runtime.syncConversationState({
      id: 'conv-missing',
      messages: [],
      providerState: {},
      sessionId: 'grimoire-live-missing-session',
    });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const errors = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content);
    report('ROW 9', String(runtime.getSessionId()), JSON.stringify(errors),
      JSON.stringify(summarize(chunks)));
    // Grok reports a session it cannot find as a filesystem error and never
    // names the session, so the composition is what recognizes it. The turn
    // then answers on a new session rather than refusing.
    expect(errors).toEqual([]);
    expect(answerOf(chunks)).toContain('OK');
    expect(runtime.getSessionId()).not.toBe('grimoire-live-missing-session');
    await shutdown();
  });

  it('rows 13 and 14: asks before it writes, and writes what was allowed', async () => {
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

    report('ROW 13/14', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    // Grok names a permission by the tool *and* the kind, so a shell command
    // must not read back as a tool called `Shell`.
    expect(asked.every(entry => entry.description.trim().length > 0)).toBe(true);
    expect(existsSync(join(vault, 'allowed-live.txt'))).toBe(true);
    await shutdown();
  });

  it('row 16: writes nothing when the prompt is refused', async () => {
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

    report('ROW 16', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    // The refusal reaches the agent, which is the only thing that stops it.
    expect(existsSync(join(vault, 'refused-live.txt'))).toBe(false);
    await shutdown();
  });

  it('row 18: fills the model catalog from an empty vault', async () => {
    const { execution, plugin, shutdown } = await createHarness();

    const discovered = await execution.metadata.discoverMetadata();

    const models = getGrokProviderSettings(plugin.settings).discoveredModels;
    report('ROW 18', String(discovered), String(models.length),
      JSON.stringify(models.slice(0, 3).map(model => model.rawId)));
    expect(discovered).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 19: lists the commands a session announces', async () => {
    const { execution, shutdown } = await createHarness();

    const commands = await execution.metadata.listCommands();

    report('ROW 19', String(commands.length),
      JSON.stringify(commands.slice(0, 5).map(command => command.name)));
    expect(commands.length).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 20: shows the spend when there is spend to show', async () => {
    grokPlanUsageStore.reset();
    const { runtime, plugin, shutdown } = await createHarness();

    await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const sessionId = runtime.getSessionId();
    const conversation: any = { id: 'conv-cost', messages: [], providerState: {}, sessionId: null };
    const providerState = runtime.buildSessionUpdates({ conversation, sessionInvalidated: false })
      .updates.providerState as GrokProviderState | undefined;
    // What Grok's own session log says this turn cost, which is the source the
    // fallback reads when the vendor reports nothing on the wire.
    const known = await loadGrokSessionCost(String(sessionId), providerState);

    const usage = grokPlanUsageStore.getCachedUsage({
      plugin,
      providerId: 'grok',
      settings: plugin.settings,
    });

    report('ROW 20', JSON.stringify(known), JSON.stringify(usage ?? null));
    // A subscription plan legitimately charges nothing per turn, and an empty
    // indicator is then the honest answer. What must hold is the implication:
    // a cost this vault can see is a cost the indicator shows.
    const owed = (known?.amount ?? 0) > 0;
    expect({ owed, shown: Boolean(usage) }).not.toEqual({ owed: true, shown: false });
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
    for (let attempt = 0; attempt < 150 && agents().length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(agents()).toEqual([]);
  });
});
