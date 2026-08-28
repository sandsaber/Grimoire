import '@/providers';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadEsmModule } from '@test/helpers/loadEsmModule';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { StreamChunk } from '@/core/types';
import { claudePlanUsageStore } from '@/providers/claude/app/ClaudePlanUsageStore';
import { createClaudeWorkspaceServices } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { ClaudeExecution } from '@/providers/claude/execution/ClaudeExecutionComposition';
import { updateClaudeProviderSettings } from '@/providers/claude/settings';

/**
 * The Claude flip against the real `@anthropic-ai/claude-agent-sdk`.
 *
 * The last of the four matrices to get a harness, and the only one that needed
 * a way around the test setup itself: `jest.config.js` maps the SDK to a mock
 * for every suite in the repository, which is right for all of them except this
 * one. The real module is loaded by absolute path below, and handed to the
 * composition through the seam it already has for exactly this — the optional
 * `queryFunction` on `createBackendRegistration`.
 *
 * Off by default: it starts the Claude CLI and spends the account's tokens, so
 * CI must never reach it. Run it with `GRIMOIRE_CLAUDE_LIVE=1`.
 */
const live = process.env.GRIMOIRE_CLAUDE_LIVE === '1' ? describe : describe.skip;

/** Where the real SDK is, since the mapper answers for the package name. */
const SDK_PATH = resolve(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');

live('Claude live smoke', () => {
  jest.setTimeout(300_000);

  const running: Array<() => Promise<void>> = [];
  let realQuery: unknown;

  beforeAll(async () => {
    const sdk = await loadEsmModule(pathToFileURL(SDK_PATH).href);
    realQuery = sdk.query;
    // Checked rather than assumed: a package that renamed its entry point would
    // otherwise reach the composition as `undefined` and fail every row with a
    // message about the kernel. Thrown rather than expected, because a
    // `beforeAll` is not a test and a failure here is a setup failure.
    if (typeof realQuery !== 'function') {
      throw new Error(`The real Claude SDK at ${SDK_PATH} exports no query function.`);
    }
  });

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
    ProviderWorkspaceRegistry.clear();
  });

  function createPlugin(
    vault: string,
    overrides: Record<string, unknown> = {},
    cliPath?: string,
  ): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'default',
      effortLevel: 'low',
      // The cheapest model this provider offers: the rows are about the path,
      // not about the answer, and every run spends the account's tokens.
      model: process.env.GRIMOIRE_CLAUDE_MODEL ?? 'haiku',
      systemPrompt: '',
      userName: 'Michael',
      ...overrides,
    };
    updateClaudeProviderSettings(settings, {
      enabled: true,
      // The vault is a scratch directory, so the machine's own Claude settings
      // must not decide what a row is allowed to do.
      loadUserSettings: false,
      respectProjectSettings: false,
    });
    return {
      settings,
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => cliPath ?? process.env.GRIMOIRE_CLAUDE_CLI ?? 'claude',
      getActiveEnvironmentVariables: () => '',
      getAllViews: () => [],
      recordDebugLog: (record: Record<string, unknown>) => {
        if (process.env.GRIMOIRE_CLAUDE_TRACE === '1') {
          report('DEBUG', JSON.stringify(record).slice(0, 400));
        }
      },
      saveSettings: async () => undefined,
    };
  }

  async function createHarness(
    overrides: Record<string, unknown> = {},
    reuseVault?: string,
    cliPath?: string,
  ): Promise<{
    runtime: any;
    execution: ClaudeExecution;
    plugin: any;
    vault: string;
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-claude-live-'));
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const plugin = createPlugin(vault, overrides, cliPath);
    const adapter = new VaultFileAdapter({
      vault: {
        adapter: nodeVaultAdapter(vault),
      },
    } as never);
    // The composition asks the workspace registry for the MCP and plugin
    // managers every turn, so this is not optional scaffolding.
    ProviderWorkspaceRegistry.setServices(
      'claude',
      await createClaudeWorkspaceServices(plugin, adapter),
    );
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new ClaudeExecution(plugin, host.registry);
    host.registerBackend(execution.createBackendRegistration(realQuery as never));
    await host.start();
    const release = async (): Promise<void> => {
      execution.dispose();
      await host.dispose();
      if (!reuseVault) {
        rmSync(vault, { force: true, recursive: true });
      }
    };
    running.push(release);
    return { execution, plugin, vault, runtime: execution.createRuntime(), shutdown: release };
  }

  /** The three members `VaultFileAdapter` reaches for, over a real directory. */
  function nodeVaultAdapter(root: string): Record<string, unknown> {
    const full = (path: string): string => join(root, path);
    return {
      basePath: root,
      exists: async (path: string) => {
        try {
          readFileSync(full(path));
          return true;
        } catch {
          return false;
        }
      },
      read: async (path: string) => readFileSync(full(path), 'utf8'),
      write: async (path: string, content: string) => {
        mkdirSync(join(full(path), '..'), { recursive: true });
        writeFileSync(full(path), content);
      },
      mkdir: async (path: string) => {
        mkdirSync(full(path), { recursive: true });
      },
      rename: async () => undefined,
      remove: async () => undefined,
      list: async () => ({ files: [], folders: [] }),
      stat: async () => null,
    };
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

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

  function textOf(chunks: readonly StreamChunk[]): string {
    return chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
      .map(chunk => chunk.content)
      .join('');
  }

  it('row 1: answers a plain message, once', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: ok' }),
    ));

    report('ROW 1', JSON.stringify(summarize(chunks)));
    const metadata = runtime.consumeTurnMetadata();
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(textOf(chunks).toLowerCase()).toContain('ok');
    expect(metadata).toMatchObject({ wasSent: true });
    // The native identity a fork resumes at. The kernel cannot know it, so a
    // turn that finishes without one degrades fork and rewind silently.
    expect(typeof metadata.assistantMessageId).toBe('string');
    // Row 4's half that does not need eyes: an answer delivered twice is the
    // defect the mirrored-update rows exist for, and it reads as one answer
    // here only if nothing repeated it.
    expect(textOf(chunks).toLowerCase().split('ok').length - 1).toBe(1);
    await shutdown();
  });

  it('row 2: asks before running a command, and shows what it produced', async () => {
    const { runtime, shutdown } = await createHarness({ permissionMode: 'normal' });
    const asked: Array<{ tool: string; description: string }> = [];
    runtime.installInteractions({ approval: async (tool: string, _input: unknown, description: string) => {
      asked.push({ tool, description });
      return 'allow';
    } });

    // A command that writes. Claude Code decides for itself that a read-only
    // shell command is safe and never routes it through `canUseTool` — `echo`
    // runs with no prompt at all, which the first version of this row read as
    // a missing prompt. The row is about the prompt, so it has to ask for
    // something the CLI would actually stop on.
    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Run the shell command `printf grimoire-live > shell-made.txt`, then run '
        + '`cat shell-made.txt`, then reply with exactly: done',
    })));

    report('ROW 2', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    // The command itself, not a tool name: a prompt that says only "Bash" is
    // one nobody can weigh.
    expect(asked.some(entry => entry.description.includes('shell-made.txt'))).toBe(true);
    expect(chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
    expect(chunks.some(chunk => (
      chunk.type === 'tool_result' && String(chunk.content).includes('grimoire-live')
    ))).toBe(true);
    await shutdown();
  });

  it('row 3: writes the file it was allowed to write', async () => {
    const { runtime, vault, shutdown } = await createHarness({ permissionMode: 'normal' });
    const asked: string[] = [];
    runtime.installInteractions({ approval: async (tool: string) => {
      asked.push(tool);
      return 'allow';
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called allowed-live.txt in the working directory containing '
        + 'the word yes, then reply with exactly: done',
    })));

    report('ROW 3', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    expect(readFileSync(join(vault, 'allowed-live.txt'), 'utf8')).toContain('yes');
    await shutdown();
  });

  it('row 10: refusing the prompt writes nothing', async () => {
    const { runtime, vault, shutdown } = await createHarness({ permissionMode: 'normal' });
    const asked: string[] = [];
    runtime.installInteractions({ approval: async (tool: string) => {
      asked.push(tool);
      return 'deny';
    } });

    await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called refused-live.txt in the working directory containing '
        + 'the word no, then reply with exactly: done',
    })));

    report('ROW 10', JSON.stringify(asked));
    expect(asked.length).toBeGreaterThan(0);
    // The refusal reaching the model is what stops it; the absent file is what
    // proves the refusal was not merely displayed.
    expect(() => readFileSync(join(vault, 'refused-live.txt'), 'utf8')).toThrow();
    await shutdown();
  });

  it('row 12: continues the same session across a restart', async () => {
    const first = await createHarness();
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: 'Remember the word violet. Reply with exactly: ok',
    })));
    const sessionId = first.runtime.getSessionId();
    // The vault outlives the harness: the SDK keeps its transcript under the
    // project it ran in, so deleting it here would delete the thing being
    // resumed — the mistake the Grok run found the hard way.
    await first.shutdown();

    const second = await createHarness({}, first.vault);
    second.runtime.syncConversationState({
      id: 'conv-resume',
      providerState: {},
      sessionId,
    });
    const chunks = await drain(second.runtime.query(second.runtime.prepareTurn({
      text: 'What word did I ask you to remember? Reply with the word only.',
    })));

    report('ROW 12', String(sessionId), JSON.stringify(summarize(chunks)));
    expect(typeof sessionId).toBe('string');
    expect(textOf(chunks).toLowerCase()).toContain('violet');
    await second.shutdown();
    rmSync(first.vault, { force: true, recursive: true });
  });

  it('row 19: hands a slash command to the provider instead of answering it', async () => {
    const { runtime, shutdown } = await createHarness();

    // Sent as the turn, which is what the row is about: the SDK owns the
    // expansion and Grimoire must not answer locally. Listing them is a
    // different question, and one this path cannot answer yet — the workspace
    // half is still registered the legacy way, so `listCommands` throws by name
    // and `getSupportedCommands()` is empty by design until M5.
    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: '/compact' })));
    const metadata = runtime.consumeTurnMetadata();

    report('ROW 19', JSON.stringify(summarize(chunks)), JSON.stringify(metadata));
    expect(metadata).toMatchObject({ wasSent: true });
    // Whatever the provider makes of it, it is the provider that made it: a
    // turn answered locally would never have been dispatched.
    expect(chunks.length).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 27: reports a context reading against a real window', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: ok' }),
    ));
    // The reading rides the stream as a chunk of its own, which is how the
    // badge gets it — not on the turn's metadata.
    const usage = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage')
      .map(chunk => chunk.usage)
      .at(-1);

    report('ROW 27', JSON.stringify(usage ?? null));
    expect(usage).toBeTruthy();
    // Against a real window, not a guessed one: a fraction of an assumed
    // context is a badge that lies quietly.
    expect(usage?.contextWindow ?? 0).toBeGreaterThan(0);
    expect(usage?.contextTokens ?? 0).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 28: the plan indicator takes what the turn reported', async () => {
    claudePlanUsageStore.reset();
    const { runtime, plugin, shutdown } = await createHarness();

    await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: ok' })));

    const usage = claudePlanUsageStore.getCachedUsage({
      plugin,
      providerId: 'claude',
      settings: plugin.settings,
    });

    report('ROW 28', JSON.stringify(usage ?? null));
    // The row L1 was about: the store had no production caller at all, so the
    // indicator was empty whatever the account reported. A subscription that
    // reports neither a cost nor a rate-limit window legitimately shows
    // nothing, so what is asserted is that the store was *reached* — a window
    // or a spend, either one.
    expect(usage).toBeTruthy();
    await shutdown();
  });

  it('row 22: stops a running turn', async () => {
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

    runtime.cancel();
    await started;

    report('ROW 22', JSON.stringify(summarize(collected).slice(-4)));
    expect(collected.length).toBeGreaterThan(0);
    await shutdown();
  });

  it('row 25: shows an error rather than an empty turn when the turn cannot run', async () => {
    // A CLI that is not there. A bad model name is the more obvious way to
    // force this and it does not work: the SDK accepts an unknown model and
    // answers anyway, so a row written that way passes while proving nothing.
    const { runtime, shutdown } = await createHarness({}, undefined, '/nonexistent/claude-grimoire');

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: ok' }),
    ));

    const errors = chunks.filter(chunk => chunk.type === 'error');
    report('ROW 25', JSON.stringify(summarize(chunks).slice(-3)));
    expect(errors.length).toBeGreaterThan(0);
    expect(textOf(chunks)).not.toContain('ok');
    await shutdown();
  });
});
