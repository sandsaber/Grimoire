import '@/providers';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownedProcesses } from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { CodexExecution } from '@/providers/codex/execution/CodexExecutionComposition';
import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/providers/codex/execution/NodeCodexExecutionConnectionFactory';
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

  /** Every daemon this file started, released whatever the row did. */
  const running: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
  });

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
    /** Shuts the daemon down, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = reuseVault ?? mkdtempSync(join(tmpdir(), 'grimoire-codex-live-'));
    // Recreated where a row hands its vault on: the first daemon's shutdown
    // takes the directory with it, and the thread being resumed lives in the
    // daemon's own sessions directory rather than here.
    mkdirSync(vault, { recursive: true });
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
        if (process.env.GRIMOIRE_CODEX_TRACE === '1') {
          const request = connection.request.bind(connection);
          (connection as { request: unknown }).request = async (
            method: string,
            params: unknown,
            timeoutMs?: number,
          ) => {
            report('RPC ->', method, JSON.stringify(params).slice(0, 160));
            try {
              const result = await request(method, params, timeoutMs);
              report('RPC <-', method, JSON.stringify(result).slice(0, 160));
              return result;
            } catch (error) {
              report('RPC !!', method, String(error).slice(0, 160));
              throw error;
            }
          };
        }
        connection.onNotification((method, params) => {
          if (process.env.GRIMOIRE_CODEX_TRACE === '1') {
             
            report('WIRE', method, JSON.stringify(params).slice(0, 900));
          }
        });
        return connection;
      },
    }));
    await host.start();
    const release = async (): Promise<void> => {
      execution.dispose();
      await host.dispose();
      // Only the vault this harness made: a row that hands its vault to a
      // second daemon — a restart — must not have it deleted underneath.
      if (!reuseVault) {
        rmSync(vault, { force: true, recursive: true });
      }
    };
    running.push(release);
    return {
      execution,
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

  it('row 1: answers a plain message', async () => {
    const { runtime, shutdown } = await createHarness();

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
    await shutdown();
  });

  it('row 2: runs a command and shows the call and its result', async () => {
    const { runtime, shutdown } = await createHarness({ permissionMode: 'full_access' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Run the shell command `echo grimoire-live` and then reply with exactly: done',
    })));

    report('ROW 2', JSON.stringify(summarize(chunks)));
    expect(chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
    expect(chunks.some(chunk => (
      chunk.type === 'tool_result' && String(chunk.content).includes('grimoire-live')
    ))).toBe(true);
    await shutdown();
  });

  it('row 6: compacts a thread, and refuses a compaction with an argument', async () => {
    const { runtime, shutdown } = await createHarness();
    await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: ok' })));

    const compacted = await drain(runtime.query(runtime.prepareTurn({ text: '/compact' })));
    const refused = await drain(runtime.query(runtime.prepareTurn({ text: '/compact please' })));

    report('ROW 6', JSON.stringify(compacted.filter(chunk => chunk.type === 'error')),
      '|', JSON.stringify(refused.filter(chunk => chunk.type === 'error')));
    expect(compacted.filter(chunk => chunk.type === 'error')).toEqual([]);
    // Refused locally: the daemon compacts a thread, it does not read an argument.
    expect(refused.some(chunk => chunk.type === 'error')).toBe(true);
    await shutdown();
  });

  it('row 8: asks for approval and runs what the user allowed', async () => {
    const { runtime, shutdown } = await createHarness();
    const asked: string[] = [];
    runtime.installInteractions({ approval: async (_tool: string, _input: unknown, description: string) => {
      asked.push(description);
      return 'allow';
    } });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Create a file called approved-live.txt in the working directory '
        + 'containing the word yes, then reply with exactly: done',
    })));

    report('ROW 8', JSON.stringify(asked), JSON.stringify(summarize(chunks)));
    expect(asked.length).toBeGreaterThan(0);
    expect(chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
    await shutdown();
  });

  it('row 12: runs a plan turn', async () => {
    const { runtime, shutdown } = await createHarness({ permissionMode: 'plan' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({
      text: 'Plan two short steps for tidying a note. Do not edit anything.',
    })));

    report('ROW 12 errors', JSON.stringify(chunks.filter(chunk => chunk.type === 'error')));
    expect(chunks.some(chunk => chunk.type === 'text' || chunk.type === 'progress')).toBe(true);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    await shutdown();
  });

  it('row 14: resumes the thread a fresh daemon was told about', async () => {
    const first = await createHarness();
    await drain(first.runtime.query(first.runtime.prepareTurn({
      text: 'Remember the word violet. Reply with exactly: ok',
    })));
    const threadId = first.runtime.getSessionId();
    // The daemon holds the thread until it exits — `thread/resume` answers
    // "already has an active writer" otherwise, which is what a restart avoids
    // by taking the process with it.
    await first.shutdown();

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
    expect(answer.toLowerCase()).toContain('violet');
    await second.shutdown();
  });

  /** The `codex app-server` daemons this process is responsible for. */
  function codexDaemons(): string[] {
    return ownedProcesses(command => (
      command.includes('app-server')
      && command.includes(process.env.GRIMOIRE_CODEX_CLI ?? 'codex')
    )).map(row => row.command);
  }

  it('row 16: cancels a running turn and leaves no daemon behind', async () => {
    if (process.platform === 'win32') {
      // Ownership on Windows is a job object rather than a process group, and
      // `ps` is not how that is read. That half stays a person's check there.
      report('ROW 16 skipped: Windows job-object ownership is not observable this way');
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
    // Cancel once the turn is actually saying something: a wall-clock wait can
    // cancel a turn that has not been dispatched yet, which tests the
    // pre-dispatch path rather than the one this row is about.
    for (let attempt = 0; attempt < 300 && !collected.some(chunk => (
      chunk.type === 'text' || chunk.type === 'progress'
    )); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // The row is named for a daemon that must be gone afterwards, so it has to
    // have been there: a cancel that leaves `codex app-server` running would
    // otherwise pass exactly as a cancel that cleans up.
    expect(codexDaemons().length).toBeGreaterThan(0);

    runtime.cancel();
    await started;
    const chunks = collected;

    report('ROW 16', JSON.stringify(summarize(chunks).slice(-4)));
    // The turn ends rather than hanging; what it managed to say before the stop
    // is whatever the model had streamed.
    expect(chunks.length).toBeGreaterThan(0);
    // The daemon outlives a cancelled turn on purpose — it is persistent, and
    // the next turn resumes on it. What must not outlive the unload is the
    // process, which is the half of this row no assertion covered.
    await shutdown();
    for (let attempt = 0; attempt < 100 && codexDaemons().length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(codexDaemons()).toEqual([]);
  });

  it('row 21: reports a failed turn in the daemon\'s own words', async () => {
    const { runtime, shutdown } = await createHarness({ model: 'gpt-5.3-codex-spark' });

    const chunks = await drain(runtime.query(runtime.prepareTurn({ text: 'Reply with exactly: ok' })));

    const errors = chunks.filter(chunk => chunk.type === 'error');
    report('ROW 21', JSON.stringify(summarize(chunks)),
      JSON.stringify(runtime.consumeTurnMetadata()),
      JSON.stringify(errors.map(chunk => String(chunk.content).slice(0, 90))));
    // One error, and the daemon's wording rather than the neutral sentence.
    expect(errors).toHaveLength(1);
    expect(String(errors[0].content)).toContain('not supported');
    await shutdown();
  });
});
