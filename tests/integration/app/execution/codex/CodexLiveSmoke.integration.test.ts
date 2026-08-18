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
      ...(process.env.GRIMOIRE_CODEX_MODEL ? { model: process.env.GRIMOIRE_CODEX_MODEL } : {}),
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

  async function createHarness(overrides: Record<string, unknown> = {}): Promise<{
    runtime: any;
    execution: CodexExecution;
    vault: string;
  }> {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-codex-live-'));
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
});
