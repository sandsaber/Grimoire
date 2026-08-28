import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { kimicodePlanUsageStore } from '@/providers/kimicode/app/KimicodePlanUsageStore';
import { KimicodeExecution } from '@/providers/kimicode/execution/KimicodeExecutionComposition';
import { loadKimicodeSessionCost } from '@/providers/kimicode/history/KimicodeUsageMetadataStore';
import { getKimicodeProviderSettings, updateKimicodeProviderSettings } from '@/providers/kimicode/settings';

/**
 * The Kimi Code flip against a real `kimi acp` process.
 *
 * The manual smoke matrix has two halves: what the protocol does, and what the
 * surface draws. This is the first half, run headlessly — a real agent, real
 * turns, the flipped path end to end — so the second half is left with only the
 * questions a person has to look at.
 *
 * **Deliberately MiMoCode's file with the names changed**, down to the row
 * numbers and the order they run in. These two providers mirror each other by
 * instruction, their compositions differ only in identifiers, and a harness that
 * drifted would hide that — so this one is meant to stay diffable against its
 * sibling after normalizing the provider name, which is how the drift gets
 * found. A row that is true of one and not the other belongs in the matrix as a
 * difference, not here as a divergence.
 *
 * Off by default: it starts a CLI and spends the account's tokens, so CI must
 * never reach it. Run it with `GRIMOIRE_KIMICODE_LIVE=1`.
 */
const live = process.env.GRIMOIRE_KIMICODE_LIVE === '1' ? describe : describe.skip;

live('Kimi Code live smoke', () => {
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
    updateKimicodeProviderSettings(settings, { enabled: true });
    if (process.env.GRIMOIRE_KIMICODE_MODEL) {
      settings.model = process.env.GRIMOIRE_KIMICODE_MODEL;
    }
    return {
      settings,
      manifest: { version: '0.0.0-live' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_KIMICODE_CLI ?? 'kimi',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: (record: Record<string, unknown>) => {
        if (process.env.GRIMOIRE_KIMICODE_TRACE === '1') {
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
    execution: KimicodeExecution;
    plugin: any;
    vault: string;
    /** Stops the agent, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-kimicode-live-'));
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
    const execution = new KimicodeExecution(plugin, host.registry);
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
            : chunk.type === 'error'
          ? `error:${chunk.content.slice(0, 200).replaceAll('\n', ' ')}`
          : chunk.type
    ));
  }

  function answerOf(chunks: readonly StreamChunk[]): string {
    return chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
      .map(chunk => chunk.content)
      .join('');
  }

  /** The `kimi acp` processes this run is responsible for. */
  function agents(): string[] {
    // The binary is `kimi`; the directory it ships in is `.kimi-code`. Matching
    // the binary matches both, and matching only the directory would miss a
    // `kimi` resolved from anywhere else.
    return ownedProcesses(command => command.includes('kimi') && command.includes('acp'))
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
    // The window comes from an update while the turn runs; the prompt's own
    // tokens come from the answer. The badge needs the pair.
    expect(usage?.usage.contextWindow).toBeGreaterThan(0);
    expect(usage?.usage.inputTokens).toBeGreaterThan(0);
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
    // patch is built from: an id and a database, for this conversation.
    first.runtime.syncConversationState(conversation);
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: 'Remember the word cobalt. Reply with exactly: OK',
    })));
    const updates = first.runtime.sessionBinding({
      conversation,
      sessionInvalidated: false,
    }).updates;
    await first.shutdown();

    // A different composition, a different process: the session is resumed by
    // what the conversation remembers, which is an id **and** a database.
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
      JSON.stringify(summarize(chunks)));
    expect(updates.sessionId).toBeTruthy();
    // Both halves of the binding, because one without the other resolves to
    // nothing: the session lives in that database and no other.
    expect((updates.providerState as { databasePath?: string })?.databasePath).toBeTruthy();
    expect(answerOf(chunks).toLowerCase()).toContain('cobalt');
    await second.shutdown();
  });

  it('row 9: replaces a session the agent no longer has', async () => {
    const { runtime, shutdown } = await createHarness();
    runtime.syncConversationState({
      id: 'conv-missing',
      messages: [],
      providerState: {},
      sessionId: 'ses_grimoire_live_missing',
    });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const errors = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error')
      .map(chunk => chunk.content);
    report('ROW 9', String(runtime.getSessionId()), JSON.stringify(errors));
    // What this CLI answers for an unknown session is **not known here**: no
    // account on this machine has ever opened one. What the resume policy
    // requires either way is that the binding survives — invalidate only on an
    // explicit "no such session", so a transport or auth failure does not
    // silently throw the conversation away — and that the turn says something
    // the user can act on. Both are asserted; the agent's exact words are the
    // matrix's job to record when an account exists.
    expect(errors).toHaveLength(1);
    // **The agent's own reason, not just the word "session".** This row used to
    // assert that the message mentioned a session, which the composition's own
    // sentence does whatever the agent said — so it stayed green while an
    // unauthenticated CLI's user was told a saved session may have gone and to
    // start a new chat. What stopped the turn may be the session and may be the
    // CLI, and only the agent knows which.
    expect(errors[0]).toContain('said:');
    expect(runtime.getSessionId()).toBe('ses_grimoire_live_missing');
    await shutdown();
  });

  it('rows 12 and 13: asks before it writes, and writes what was allowed', async () => {
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

  it('row 15: writes nothing when the prompt is refused', async () => {
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

    report('ROW 15', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    // The refusal reaches the agent, which is the only thing that stops it.
    expect(existsSync(join(vault, 'refused-live.txt'))).toBe(false);
    await shutdown();
  });

  it('row 17: fills the model catalog from an empty vault', async () => {
    const { execution, plugin, shutdown } = await createHarness();

    const discovered = await execution.metadata.discoverMetadata();

    const models = getKimicodeProviderSettings(plugin.settings).discoveredModels;
    report('ROW 17', String(discovered), String(models.length),
      JSON.stringify(models.slice(0, 3).map(model => model.rawId)));
    expect(discovered).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 18: lists the commands a session announces', async () => {
    const { execution, shutdown } = await createHarness();

    const commands = await execution.metadata.listCommands();

    report('ROW 18', String(commands.length),
      JSON.stringify(commands.slice(0, 5).map(command => command.name)));
    expect(commands.length).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 19: shows the spend when there is spend to show', async () => {
    kimicodePlanUsageStore.reset();
    const { runtime, plugin, shutdown } = await createHarness();

    await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const sessionId = runtime.getSessionId();
    const conversation: any = { id: 'conv-cost', messages: [], providerState: {}, sessionId: null };
    const providerState = runtime.sessionBinding({ conversation, sessionInvalidated: false })
      .updates.providerState as { databasePath?: string } | undefined;
    // What Kimi Code's own database says this session cost, which is the source
    // the fallback reads when the vendor reports nothing on the wire.
    const known = await loadKimicodeSessionCost(String(sessionId), providerState);

    const usage = kimicodePlanUsageStore.getCachedUsage({
      plugin,
      providerId: 'kimicode',
      settings: plugin.settings,
    });

    report('ROW 19', JSON.stringify(known), JSON.stringify(usage ?? null));
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
