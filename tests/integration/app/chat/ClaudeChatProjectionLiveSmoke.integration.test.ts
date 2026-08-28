import '@/providers';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
import { loadEsmModule } from '@test/helpers/loadEsmModule';
import {
  openChatProjection,
  userMessage,
} from '@test/integration/app/chat/chatProjectionLiveHarness';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { createClaudeWorkspaceServices } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { ClaudeExecution } from '@/providers/claude/execution/ClaudeExecutionComposition';
import { updateClaudeProviderSettings } from '@/providers/claude/settings';

/**
 * The Claude chat projection flip, against the real `@anthropic-ai/claude-agent-sdk`.
 *
 * The third provider on the path and the first with an **interaction**: Claude
 * stops and asks before it writes, and a permission prompt is the one surface
 * where two paths could both decide to present. Antigravity brought a whole
 * turn, Codex brought content and a thread; this brings the question.
 *
 * `jest.config.js` maps the SDK to a mock for every suite in the repository,
 * which is right for all of them except this one and `ClaudeLiveSmoke`. The
 * real module is loaded by absolute path and handed to the composition through
 * the seam it already has for it.
 *
 * Off by default — it starts the Claude CLI and spends the account's tokens.
 * Run it with `GRIMOIRE_CLAUDE_LIVE=1`.
 */
const live = process.env.GRIMOIRE_CLAUDE_LIVE === '1' ? describe : describe.skip;

/** Where the real SDK is, since the mapper answers for the package name. */
const SDK_PATH = resolve(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');

live('Claude chat projection live smoke', () => {
  jest.setTimeout(300_000);

  const CONVERSATION_ID = 'conv-claude-projection';
  const running: Array<() => Promise<void>> = [];
  let realQuery: unknown;

  beforeAll(async () => {
    const sdk = await loadEsmModule(pathToFileURL(SDK_PATH).href);
    realQuery = sdk.query;
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

  function report(...parts: readonly string[]): void {
    process.stdout.write(`${parts.join(' ')}\n`);
  }

  function createPlugin(vault: string, overrides: Record<string, unknown> = {}): any {
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
      getResolvedProviderCliPath: () => process.env.GRIMOIRE_CLAUDE_CLI ?? 'claude',
      getActiveEnvironmentVariables: () => '',
      getAllViews: () => [],
      recordDebugLog: () => undefined,
      saveSettings: async () => undefined,
    };
  }

  /** The members `VaultFileAdapter` reaches for, over a real directory. */
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

  async function createHarness(
    overrides: Record<string, unknown> = {},
    vaultAdapter?: ReturnType<typeof createDurableInMemoryVaultAdapter>,
  ) {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-claude-projection-'));
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const plugin = createPlugin(vault, overrides);
    // The composition asks the workspace registry for the MCP and plugin
    // managers every turn, so this is not optional scaffolding.
    ProviderWorkspaceRegistry.setServices(
      'claude',
      await createClaudeWorkspaceServices(
        plugin,
        new VaultFileAdapter({ vault: { adapter: nodeVaultAdapter(vault) } } as never),
      ),
    );
    const host = new ExecutionKernelHost({
      storage: new VaultDurableStorage(createDurableInMemoryVaultAdapter()),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new ClaudeExecution(plugin, host.registry);
    host.registerBackend(execution.createBackendRegistration(realQuery as never));
    await host.start();

    const runtime = execution.createRuntime();
    const harness = await openChatProjection({
      backendId: claudeProviderModule.execution.descriptor.backendId,
      conversationId: CONVERSATION_ID,
      lifecycle: host.registry,
      providerId: 'claude',
      runtime,
      // What `ConversationController` does when a conversation is opened. The
      // presenter's session belongs to the conversation it was told about.
      syncConversation: true,
    });
    const release = async (): Promise<void> => {
      await harness.close();
      execution.dispose();
      await host.dispose();
      rmSync(vault, { force: true, recursive: true });
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
    expect(completed.terminal.kind).toBe('succeeded');
    expect(column.chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);
    expect(column.drawn.join('').trim()).not.toBe('');
    // Matrix row 2.
    expect(column.chunks.filter(chunk => chunk.type === 'done')).toHaveLength(1);
    const assistants = column.state.messages.filter(message => message.role === 'assistant');
    expect(assistants).toHaveLength(1);

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

  it('row B: asks once before it writes, and the answer continues the turn', async () => {
    const { harness, runtime, vault } = await createHarness({ permissionMode: 'normal' });
    const { column, tab } = harness;
    const asked: Array<{ tool: string; description: string }> = [];
    (runtime as unknown as {
      setApprovalCallback(
        callback: (tool: string, input: unknown, description: string) => Promise<string>,
      ): void;
    }).setApprovalCallback(async (tool, _input, description) => {
      asked.push({ description, tool });
      return 'allow';
    });

    const text = 'Create a file called allowed-projection.txt in the working directory '
      + 'containing the word yes, then reply with exactly: done';
    const submitted = await tab.send({ text }, userMessage(text));
    // Bounded, and the bound is the point. Before the coordinator had a
    // presenter this row simply stopped — the provider was waiting for an
    // answer nobody was there to give — and a suite timeout reports that as
    // "the test took too long" rather than as what it is. Failing here says
    // what was asked and what came back.
    const ended = await Promise.race([
      submitted.ticket.completion.then(() => 'ended' as const),
      new Promise<'waiting'>(resolve => { setTimeout(() => resolve('waiting'), 120_000); }),
    ]);
    await tab.settled();

    report('ROW B', ended, JSON.stringify(asked), JSON.stringify(column.chunks.map(c => c.type)));
    expect(ended).toBe('ended');
    // Matrix row 9. **Once** is the assertion: a permission prompt is the one
    // surface where two paths could both decide to present, and the render
    // target deliberately presents nothing — the provider's own presenter
    // already has it on screen, so all the target does is flush the tool calls
    // it was holding so the prompt is not above a blank.
    const writes = asked.filter(entry => entry.description.includes('allowed-projection.txt'));
    expect(writes).toHaveLength(1);
    // Answering it continued the turn, proven by the file rather than by the
    // callback having returned.
    expect(readFileSync(join(vault, 'allowed-projection.txt'), 'utf8')).toContain('yes');
    // And the tool it asked about is drawn, through the presenter, in the column.
    expect(column.chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
  });

  it('row C: resumes the session after a reload, from what the vault kept', async () => {
    // A reload, not a second turn — and with the transcript emptied. Codex's
    // row of this shape stayed green through three breaks: the composition
    // replays the conversation's history into every request, and a provider
    // asked to resume nothing will happily resume its own most recent thread.
    const vaultAdapter = createDurableInMemoryVaultAdapter();
    const first = await createHarness({}, vaultAdapter);

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
    expect(nativeSessionRef).toBeTruthy();

    // Everything goes: the SDK process, the kernel, the coordinator and the
    // tab. What survives is the vault, which is all a reload has.
    await first.release();

    const second = await createHarness({}, vaultAdapter);
    const { column, sessions, tab } = second.harness;
    // The transcript goes too, so the only place an answer can come from is the
    // session this build asked the provider to resume.
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
    expect(completed.terminal.kind).toBe('succeeded');
    expect(column.drawn.join('').toLowerCase()).toContain('tomato');
  });
});
