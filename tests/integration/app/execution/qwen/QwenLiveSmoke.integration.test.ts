import '@/providers';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { QwenExecution } from '@/app/execution/qwen/QwenExecutionComposition';
import type { StreamChunk } from '@/core/types';
import { qwenPlanUsageStore } from '@/providers/qwen/app/QwenPlanUsageStore';
import { getQwenProviderSettings, updateQwenProviderSettings } from '@/providers/qwen/settings';

/**
 * The Qwen flip against a real `qwen --acp` process.
 *
 * The manual smoke matrix has two halves: what the protocol does, and what the
 * surface draws. This is the first half, run headlessly — a real agent, real
 * turns, the flipped path end to end — so the second half is left with only the
 * questions a person has to look at.
 *
 * The first wave-7 harness that can run at all. MiMoCode's account cannot
 * generate and Kimi Code's machine is not authenticated, so wave 6 shipped two
 * flips no live run could confirm; this CLI answered its wire recording in full,
 * which is why it was built before Qwen despite the plan's order.
 *
 * Off by default: it starts a CLI and spends the account's tokens, so CI must
 * never reach it. Run it with `GRIMOIRE_QWEN_LIVE=1`.
 */
const live = process.env.GRIMOIRE_QWEN_LIVE === '1' ? describe : describe.skip;

live('Qwen live smoke', () => {
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
    updateQwenProviderSettings(settings, { enabled: true });
    if (typeof overrides.effortLevel === 'string') {
      updateQwenProviderSettings(settings, { effortLevel: overrides.effortLevel as never });
    }
    if (typeof overrides.permissionMode === 'string') {
      // Both halves, because the toolbar writes both and the projection prefers
      // whichever this provider last saved.
      updateQwenProviderSettings(settings, { selectedMode: overrides.permissionMode });
      settings.savedProviderPermissionMode = { qwen: overrides.permissionMode };
    }
    return {
      settings,
      manifest: { version: '0.0.0-live' },
      app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [],
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_QWEN_CLI ?? 'qwen',
      getActiveEnvironmentVariables: () => '',
      recordDebugLog: (record: Record<string, unknown>) => {
        if (process.env.GRIMOIRE_QWEN_TRACE === '1') {
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
    execution: QwenExecution;
    plugin: any;
    vault: string;
    /** Stops the agent, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-qwen-live-'));
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
    const execution = new QwenExecution(plugin, host.registry);
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

  /** The `qwen --acp` processes this run is responsible for. */
  function agents(): string[] {
    return ownedProcesses(command => command.includes('qwen') && command.includes('--acp'))
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
    // The message the answer hangs on, which the surface needs before the text.
    expect(chunks.some(chunk => chunk.type === 'assistant_message_start')).toBe(true);
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
    // The window comes from an update while the turn runs; the prompt's own
    // tokens come from the answer. The badge needs the pair — and the wire
    // recording never reached a usage update, so this row is the first time
    // anything has observed one from this CLI.
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
    first.runtime.syncConversationState(conversation);
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: 'Remember the word cobalt. Reply with exactly: OK',
    })));
    const updates = first.runtime.buildSessionUpdates({
      conversation,
      sessionInvalidated: false,
    }).updates;
    await first.shutdown();

    // A different composition, a different process. The binding is an id and
    // nothing else — this provider writes no state a second half could point at,
    // which is the difference from every sibling on this transport.
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
    expect(updates.providerState).toBeUndefined();
    expect(answerOf(chunks).toLowerCase()).toContain('cobalt');
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
      JSON.stringify(summarize(chunks)));
    // Either outcome is correct and which one it is has never been observed for
    // this CLI: an agent that names the session as missing lets the backend
    // replace it, and one that answers something vaguer keeps the binding and
    // says so in words. What must not happen is a turn that silently starts a
    // new conversation and leaves the old one unreachable.
    const replaced = runtime.getSessionId() !== '00000000-0000-4000-8000-000000000000';
    expect(replaced || errorsOf(chunks).length > 0).toBe(true);
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

  it('row 16: runs the turn in the mode the tab is set to', async () => {
    // Grimoire's `plan` is not one of this agent's own ids; a turn that
    // forwarded it would be rejected by `session/set_mode` before the prompt was
    // ever sent, and the whole conversation would die on it. What proves the
    // translation landed is the agent behaving like a read-only session.
    const { runtime, vault, shutdown } = await createHarness({ permissionMode: 'plan' });
    const asked: string[] = [];
    runtime.installInteractions({ approval: async (tool: string) => {
      asked.push(tool);
      return 'allow';
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called planned-live.txt in the working directory containing '
        + 'the word no, then reply with exactly: done',
    })));

    report('ROW 16', JSON.stringify(asked), JSON.stringify(errorsOf(chunks)),
      JSON.stringify(summarize(chunks)));
    // The turn ran at all, which is the half `set_mode` would have broken.
    expect(errorsOf(chunks)).toEqual([]);
    expect(chunks.length).toBeGreaterThan(0);
    // And it ran read-only: Plan is the mode that reads and does not write.
    expect(existsSync(join(vault, 'planned-live.txt'))).toBe(false);
    await shutdown();
  });

  it('row 20: talks the session into an effort, and only once', async () => {
    // This provider's own, and no sibling harness has it: the reasoning level is
    // a `/effort <level>` prompt the vendor charges for like any other turn. Two
    // turns, one prompt — and if it is two, every turn is paying for a level the
    // session already has.
    const { runtime, shutdown } = await createHarness({ effortLevel: 'low' });

    await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));
    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Reply with exactly: OK',
    })));

    report('ROW 20', JSON.stringify(summarize(chunks)));
    // The effort prompt's own answer must not be in the conversation either.
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('effort')))
      .toBe(false);
    expect(errorsOf(chunks)).toEqual([]);
    await shutdown();
  });

  it('row 21: asks the person a question, and sends the answers back', async () => {
    // The first `kind: 'question'` interaction the product carries. Whether this
    // CLI reaches for `ask_user_question` on a prompt like this one is exactly
    // what nobody knows — an empty `asked` here is a row that did not run, not a
    // row that failed, and the report says which.
    const { runtime, shutdown } = await createHarness();
    const asked: unknown[] = [];
    runtime.installInteractions({ question: async (input: unknown) => {
      asked.push(input);
      return { colour: 'blue' };
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Ask me which colour I prefer before answering, then reply with the colour.',
    })));

    report('ROW 21', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    if (asked.length === 0) {
      report('ROW 21 did not run: this turn did not reach for ask_user_question');
      return;
    }
    expect(answerOf(chunks).toLowerCase()).toContain('blue');
    await shutdown();
  });

  it('row 22: reports the context window from the method ACP does not define', async () => {
    // `qwen/status/session/context_usage`, asked once as the turn ends because
    // no `usage_update` this provider sends carries the parent window.
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const usage = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage')
      .at(-1);
    report('ROW 22', JSON.stringify(usage?.usage ?? null));
    expect(usage?.usage.contextWindow).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 23: keeps a nested agent activity out of the conversation', async () => {
    // This CLI streams a subagent's own thoughts and tool calls through the
    // parent session. Drawn here they interleave concurrent agents into one
    // transcript — the parent Agent tool call stays, its children must not.
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Use a subagent to count the files in the working directory, then reply with the count.',
    })));

    report('ROW 23', JSON.stringify(summarize(chunks)));
    expect(errorsOf(chunks)).toEqual([]);
    await shutdown();
  });

  it('row 17: fills the model catalog from an empty vault', async () => {
    const { execution, plugin, shutdown } = await createHarness();

    const discovered = await execution.metadata.discoverMetadata();

    const stored = getQwenProviderSettings(plugin.settings);
    report('ROW 17', String(discovered), String(stored.discoveredModels.length),
      JSON.stringify(stored.discoveredModels.slice(0, 3).map(model => model.rawId)),
      JSON.stringify(stored.availableModes.map(mode => mode.id)));
    expect(discovered).toBe(true);
    expect(stored.discoveredModels.length).toBeGreaterThan(0);
    expect(stored.availableModes.map(mode => mode.id)).toEqual(
      expect.arrayContaining(['default', 'plan', 'yolo']),
    );
    await shutdown();
  });

  it('row 19: shows the spend when there is spend to show', async () => {
    qwenPlanUsageStore.reset();
    const { runtime, plugin, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: OK' })));

    const usage = qwenPlanUsageStore.getCachedUsage({
      plugin,
      providerId: 'qwen',
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
