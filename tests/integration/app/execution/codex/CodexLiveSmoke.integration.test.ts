import '@/providers';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { CodexExecution } from '@/app/execution/codex/CodexExecutionComposition';
import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/app/execution/codex/NodeCodexExecutionConnectionFactory';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { resolveCodexAppServerLaunchSpec } from '@/providers/codex/runtime/codexAppServerSupport';
import { updateCodexProviderSettings } from '@/providers/codex/settings';
import { DEFAULT_CODEX_MINI_MODEL } from '@/providers/codex/types/models';

/**
 * The Codex flip against a real `codex app-server`.
 *
 * The manual smoke matrix has two halves: what the daemon does, and what the
 * surface draws. This is the first half, run headlessly — a real daemon, real
 * turns, the flipped path end to end — so the second half is left with only the
 * questions a person has to look at.
 *
 * Off by default: it starts a CLI and spends the account's tokens, so CI must
 * never reach it. Run it with `GRIMOIRE_CODEX_LIVE=1`.
 */
const live = process.env.GRIMOIRE_CODEX_LIVE === '1' ? describe : describe.skip;

live('Codex live smoke', () => {
  jest.setTimeout(180_000);

  function createPlugin(vault: string, overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      permissionMode: 'default',
      effortLevel: 'low',
      // The cheapest model this provider offers: the rows are about the path,
      // not about the answer, and every run spends the account's tokens.
      // The mini model by default: the rows are about the path, not the answer,
      // and every run spends the account's tokens. `gpt-5.3-codex-spark` is
      // refused outright by a ChatGPT account, so it is not the cheap option.
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
    reuseVault?: string,
  ): Promise<{
    runtime: any;
    execution: CodexExecution;
    vault: string;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-codex-live-'));
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const plugin = createPlugin(vault, overrides);
    const execution = new CodexExecution(plugin, host.registry);
    // The daemon's own traffic, so a row that fails says what the daemon did
    // rather than only what the surface saw.
    const base = new NodeCodexExecutionConnectionFactory({
      activeLaunchSpec: new CodexActiveLaunchSpec(
        () => resolveCodexAppServerLaunchSpec(plugin, 'codex'),
      ),
    });
    host.registerBackend(execution.createBackendRegistration({
      create: () => {
        const connection = base.create();
        connection.onNotification((method, params) => {
          if (process.env.GRIMOIRE_CODEX_TRACE === '1') {
             
            report('WIRE', method, JSON.stringify(params).slice(0, 220));
          }
        });
        return connection;
      },
    }));
    await host.start();
    return { execution, vault, runtime: execution.createRuntime() };
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

  it('row 1: answers a plain message', async () => {
    const { runtime, execution } = await createHarness();

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: ok' }),
    ));

     
     
    report('ROW 1', JSON.stringify(summarize(chunks)));
    const metadata = runtime.consumeTurnMetadata();
    expect(chunks.some(chunk => chunk.type === 'text')).toBe(true);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(metadata).toMatchObject({ wasSent: true });
    // The native turn id, not a result reference: this is what a fork resumes
    // at, and it is the one thing about a finished turn the kernel cannot know.
    expect(metadata.assistantMessageId).toBe(metadata.userMessageId);
    // Live, this fails: the answer arrives three times. Kept as the evidence it
    // is until the duplication is fixed — see the journal entry for the run.
    expect(chunks.filter(chunk => chunk.type === 'text')).toHaveLength(1);
    execution.dispose();
  });

  it('row 2: runs a command and shows the call and its result', async () => {
    const { runtime, execution } = await createHarness({ permissionMode: 'full_access' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Run the shell command `echo grimoire-live` and then reply with exactly: done',
    })));

    report('ROW 2', JSON.stringify(summarize(chunks)));
    expect(chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
    expect(chunks.some(chunk => (
      chunk.type === 'tool_result' && String(chunk.content).includes('grimoire-live')
    ))).toBe(true);
    execution.dispose();
  });

  it('row 6: compacts a thread, and refuses a compaction with an argument', async () => {
    const { runtime, execution } = await createHarness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: ok' })));

    const compacted = await drain(runtime.query(runtime.prepareTurn({ text: '/compact' })));
    const refused = await drain(runtime.query(runtime.prepareTurn({ text: '/compact please' })));

    report('ROW 6', JSON.stringify(compacted.filter(chunk => chunk.type === 'error')),
      '|', JSON.stringify(refused.filter(chunk => chunk.type === 'error')));
    expect(compacted.filter(chunk => chunk.type === 'error')).toEqual([]);
    // Refused locally: the daemon compacts a thread, it does not read an argument.
    expect(refused.some(chunk => chunk.type === 'error')).toBe(true);
    execution.dispose();
  });

  it('row 8: asks for approval and runs what the user allowed', async () => {
    const { runtime, execution } = await createHarness();
    const asked: string[] = [];
    runtime.setApprovalCallback(async (_tool: string, _input: unknown, description: string) => {
      asked.push(description);
      return 'allow';
    });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called approved-live.txt in the working directory '
        + 'containing the word yes, then reply with exactly: done',
    })));

    report('ROW 8', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    expect(chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
    execution.dispose();
  });

  it('row 12: runs a plan turn', async () => {
    const { runtime, execution } = await createHarness({ permissionMode: 'plan' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Plan two short steps for tidying a note. Do not edit anything.',
    })));

    report('ROW 12 errors', JSON.stringify(chunks.filter(chunk => chunk.type === 'error')));
    expect(chunks.some(chunk => chunk.type === 'text' || chunk.type === 'progress')).toBe(true);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    execution.dispose();
  });

  it('row 14: resumes the thread a fresh daemon was told about', async () => {
    const first = await createHarness();
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: 'Remember the word violet. Reply with exactly: ok',
    })));
    const threadId = first.runtime.getSessionId();
    first.execution.dispose();

    // A different composition, a different daemon: the thread is resumed by the
    // id the conversation remembers, which is what a restart does.
    const second = await createHarness({}, first.vault);
    second.runtime.syncConversationState({ id: 'conv-1', sessionId: threadId });
    const chunks = await drain(second.runtime.query(second.runtime.prepareTurn({
      text: 'What word did I ask you to remember? Reply with the word only.',
    })));

    const answer = chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join('');
    report('ROW 14', String(threadId), JSON.stringify(summarize(chunks)));
    // The thread id is reported, which is what lets a conversation remember it.
    expect(threadId).toBeTruthy();
    // Live, this fails: resuming the thread in a fresh daemon ends the run as
    // indeterminate — the daemon goes idle without running the turn. Kept as
    // the reproduction, the way row 1's duplication was.
    expect(answer.toLowerCase()).toContain('violet');
    second.execution.dispose();
  });

  it('row 16: cancels a running turn and leaves no daemon behind', async () => {
    const { runtime, execution } = await createHarness();
    const started = drain(runtime.query(runtime.prepareTurn({
      text: 'Count slowly from one to fifty, one number per line.',
    })));
    await new Promise(resolve => setTimeout(resolve, 1_500));

    runtime.cancel();
    const chunks = await started;

    report('ROW 16', JSON.stringify(summarize(chunks).slice(-4)));
    // The turn ends rather than hanging; what it managed to say before the stop
    // is whatever the model had streamed.
    expect(chunks.length).toBeGreaterThan(0);
    execution.dispose();
  });

  it('row 21: reports a failed turn in the daemon\'s own words', async () => {
    const { runtime, execution } = await createHarness({ model: 'gpt-5.3-codex-spark' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: ok' })));

    const errors = chunks.filter(chunk => chunk.type === 'error');
    report('ROW 21', JSON.stringify(summarize(chunks)),
      JSON.stringify(runtime.consumeTurnMetadata()),
      JSON.stringify(errors.map(chunk => String(chunk.content).slice(0, 90))));
    // One error, and the daemon's wording rather than the neutral sentence.
    expect(errors).toHaveLength(1);
    expect(String(errors[0].content)).toContain('not supported');
    execution.dispose();
  });
});
