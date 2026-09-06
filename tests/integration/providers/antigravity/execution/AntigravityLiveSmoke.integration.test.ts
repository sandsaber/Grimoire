import '@/providers';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isAlive,
  ownedProcesses,
  processTable,
  processTree,
} from '@test/helpers/execution/hostProcessTree';
import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import type { StreamChunk } from '@/core/types';
import { AntigravityExecution } from '@/providers/antigravity/execution/AntigravityExecutionComposition';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

/**
 * The Antigravity flip against a real `agy`.
 *
 * Wave 1's smoke matrix is five items, and four of them are automated gates or
 * timestamped in the vault log. The fifth is the one no fake can answer: after a
 * cancel, is the `agy` process tree *actually* gone. Every other suite asks the
 * runner whether it terminated; this one asks the operating system, over a
 * process table it did not write.
 *
 * That is why nothing here is stubbed below the composition: the backend is the
 * one production builds, over `NodeAntigravityProcessTransport`, over a real
 * login-shell launch of a real CLI. A green row with a fake anywhere under it
 * would prove the fake.
 *
 * Off by default: it starts a CLI and spends the account's tokens, so CI must
 * never reach it. Run it with `GRIMOIRE_ANTIGRAVITY_LIVE=1`.
 */
const live = process.env.GRIMOIRE_ANTIGRAVITY_LIVE === '1' ? describe : describe.skip;

live('Antigravity live smoke', () => {
  jest.setTimeout(240_000);

  const cli = process.env.GRIMOIRE_ANTIGRAVITY_CLI ?? 'agy';

  /** Every harness this file built, released whatever the row did. */
  const running: Array<() => Promise<void>> = [];
  /** Every pid this file saw `agy` own, so a failed row leaves nothing behind. */
  const owned = new Set<number>();

  afterEach(async () => {
    for (const release of running.splice(0)) {
      await release().catch(() => undefined);
    }
    for (const pid of owned) {
      if (!isAlive(pid)) {
        continue;
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone between the check and the signal, which is the point.
      }
    }
    owned.clear();
  });

  function createPlugin(vault: string, overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = {
      // Print mode cannot ask for approval, so anything short of full access is
      // refused before a process exists — and this file is about processes.
      permissionMode: 'full_access',
      savedProviderPermissionMode: { antigravity: 'full_access' },
      userName: 'Michael',
      ...overrides,
    };
    updateAntigravityProviderSettings(settings, {
      enabled: true,
      // Empty by default, which sends no `--model` and lets the CLI pick what
      // the account is configured for: the rows are about the path, not the
      // answer, and a stale model name would fail them for the wrong reason.
      visibleModels: process.env.GRIMOIRE_ANTIGRAVITY_MODEL
        ? [process.env.GRIMOIRE_ANTIGRAVITY_MODEL]
        : [],
    });
    return {
      settings,
      app: { vault: { adapter: { basePath: vault } } },
      getResolvedProviderCliPath: () => cli,
      recordDebugLog: () => undefined,
    };
  }

  async function createHarness(overrides: Record<string, unknown> = {}): Promise<{
    runtime: ExecutionChatRuntimeAdapter;
    vault: string;
    /** Shuts the kernel down, which is what a plugin unload does. */
    shutdown(): Promise<void>;
  }> {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-agy-live-'));
    writeFileSync(join(vault, 'Note.md'), '# Note\n\nThe vault has one note in it.\n');
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: {
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
    });
    const execution = new AntigravityExecution(createPlugin(vault, overrides), host.registry);
    // No runner argument: the default is the OS one, which is the whole point.
    host.registerBackend({ backend: execution.createBackend() });
    await host.start();
    const release = async (): Promise<void> => {
      await host.dispose();
      rmSync(vault, { force: true, recursive: true });
    };
    running.push(release);
    return { runtime: execution.createRuntime(), shutdown: release, vault };
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
        ? `${chunk.type}:${chunk.content.slice(0, 60).replaceAll('\n', ' ')}`
        : chunk.type
    ));
  }

  /** The `agy` invocations this process is responsible for, right now. */
  function agyProcesses() {
    return ownedProcesses(command => command.includes(cli) && command.includes('--print'));
  }

  function pause(delayMs: number): Promise<void> {
    return new Promise(resolve => { setTimeout(resolve, delayMs); });
  }

  async function waitFor<T>(
    label: string,
    timeoutMs: number,
    attempt: () => T | undefined,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = attempt();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        // Named rather than left to a suite timeout: "no `agy` was ever
        // launched" and "the tree outlived the cancel" are different findings.
        throw new Error(`${label} did not happen within ${timeoutMs}ms.`);
      }
      await pause(100);
    }
  }

  it('row 1: answers a plain message and leaves nothing running', async () => {
    const { runtime, shutdown } = await createHarness();

    const chunks = await drain(runtime.query(
      runtime.prepareTurn({ text: 'Reply with exactly: ok' }),
    ));

    report('ROW 1', JSON.stringify(summarize(chunks)));
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.trim() !== '')).toBe(true);
    expect(runtime.consumeTurnMetadata()).toMatchObject({ wasSent: true });
    // A turn that ends by itself owns the same cleanup a cancelled one does.
    expect(agyProcesses().map(row => row.command)).toEqual([]);
    await shutdown();
  });

  it('row 2: cancels a running turn and leaves no agy process tree behind', async () => {
    if (process.platform === 'win32') {
      // Windows owns the tree through a job object rather than a process group,
      // and `ps` is not how that is read. The row stays a person's check there.
      report('ROW 2 skipped: Windows job-object ownership is not observable this way');
      return;
    }
    const { runtime, shutdown } = await createHarness();
    const chunks: StreamChunk[] = [];
    const turn = (async () => {
      for await (const chunk of runtime.query(runtime.prepareTurn({
        // A tool call that sleeps, rather than a long answer, and deliberately.
        // The first version of this row asked for four hundred numbers and went
        // green with process termination disabled: `agy` had simply finished
        // before the row looked. A child that will still be running two minutes
        // from now cannot end on its own inside the assertion's window, so the
        // only way this row passes is if something killed it — and it makes the
        // tree a tree, which is the noun the row is about.
        text: 'Run the shell command `sleep 120` and then reply with exactly: done',
      }))) {
        chunks.push(chunk);
      }
    })();

    const root = await waitFor('an agy process', 120_000, () => (
      agyProcesses()[0]
    ));
    owned.add(root.pid);
    const sleeping = await waitFor('the sleep the model was asked to run', 120_000, () => (
      processTree(processTable(), root.pid)
        .find(row => row.command.includes('sleep 120') && !row.command.includes('--print'))
    ));
    const tree = processTree(processTable(), root.pid);
    for (const row of tree) {
      owned.add(row.pid);
    }
    report('ROW 2 tree', JSON.stringify(tree.map(row => `${row.pid}:${row.command.slice(0, 70)}`)));
    expect(tree.map(row => row.pid)).toContain(sleeping.pid);
    expect(tree.every(row => isAlive(row.pid))).toBe(true);

    runtime.cancel();
    await turn;

    // The operating system's answer, not the runner's. Bounded, because the
    // backend escalates SIGTERM to SIGKILL after its own two seconds and the
    // whole point of the row is that the escalation ends somewhere — well
    // inside the two minutes the sleeping descendant would otherwise have.
    const survivors = await waitFor('the agy tree to disappear', 20_000, () => {
      const alive = [...owned].filter(pid => isAlive(pid));
      return alive.length === 0 ? [] : undefined;
    });
    report('ROW 2', JSON.stringify(summarize(chunks)), `survivors=${survivors.length}`);
    expect(survivors).toEqual([]);
    // And nothing of this file's making is left anywhere under this process,
    // including a child that outlived the group it was recorded in.
    expect(agyProcesses().map(row => row.command)).toEqual([]);
    expect(chunks.filter(chunk => chunk.type === 'error')).toEqual([]);
    // The turn reached the provider, which is what separates a cancellation
    // from a refusal before dispatch.
    expect(runtime.consumeTurnMetadata()).toMatchObject({ wasSent: true });
    await shutdown();
  });
});
