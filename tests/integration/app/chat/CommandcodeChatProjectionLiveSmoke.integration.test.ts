import '@/providers';

import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDurableInMemoryVaultAdapter } from '@test/helpers/inMemoryVaultAdapter';
import { openChatProjection, userMessage } from '@test/integration/app/chat/chatProjectionLiveHarness';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import type GrimoirePlugin from '@/main';
import { commandcodeProviderModule } from '@/providers/commandcode/CommandcodeProviderModule';
import { CommandcodeExecution } from '@/providers/commandcode/execution/CommandcodeExecutionComposition';
import { NodeCommandcodeProcessRunner } from '@/providers/commandcode/runtime/CommandcodeProcess';

const freeModel = 'commandcode:poolside/laguna-s-2.1-free';
const paidEffort = process.env.GRIMOIRE_COMMANDCODE_PAID_EFFORT_LIVE === '1';
const model = paidEffort ? 'commandcode:deepseek/deepseek-v4-flash' : freeModel;
const live = process.env.GRIMOIRE_COMMANDCODE_LIVE === '1' ? describe : describe.skip;

live('Command Code real chat projection', () => {
  jest.setTimeout(180_000);

  it('reads a file, persists one answer and resumes the native session after reload', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-commandcode-live-'));
    const token = `proof-${randomUUID()}`;
    writeFileSync(join(vault, 'Note.md'), token);
    const storage = createDurableInMemoryVaultAdapter();
    const releases: Array<() => Promise<void>> = [];
    const open = async (effort?: string) => {
      const host = new ExecutionKernelHost({ storage: new VaultDurableStorage(createDurableInMemoryVaultAdapter()),
        scheduler: { setTimeout: (callback, ms) => setTimeout(callback, ms),
          clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout) } });
      const plugin = {
        settings: { providerConfigs: { commandcode: { enabled: true, cliPath: process.env.GRIMOIRE_COMMANDCODE_CLI ?? '',
          discoveredModels: [{ rawId: model.slice('commandcode:'.length), label: 'Live test model' }],
          reasoningEffortsByModel: { 'deepseek/deepseek-v4-flash': ['high', 'max'] } } },
          permissionMode: 'normal', model, effortLevel: effort ?? 'default',
          savedProviderEffort: { commandcode: effort ?? 'default' }, savedProviderModel: { commandcode: model } },
        app: { vault: { adapter: { basePath: vault } } },
        getApplicationRuntimeOrNull: () => null,
        recordDebugLog: () => undefined,
      } as unknown as GrimoirePlugin;
      const execution = new CommandcodeExecution(plugin, host.registry);
      const runner = new NodeCommandcodeProcessRunner();
      const reportedEfforts: unknown[] = [];
      const requestedEfforts: unknown[] = [];
      const backend = execution.createBackend({ start: (invocation, onEvent, onSession, approve) => {
        requestedEfforts.push(invocation.effort);
        return runner.start(invocation, event => {
          if (event.type === 'model_request_end') reportedEfforts.push(event.effort);
          onEvent(event);
        }, onSession, approve);
      } });
      host.registerBackend({ backend, interactions: backend.interactions });
      await host.start();
      const runtime = execution.createRuntime();
      const harness = await openChatProjection({ runtime, lifecycle: host.registry,
        backendId: commandcodeProviderModule.execution.descriptor.backendId,
        conversationId: 'commandcode-live-chat', providerId: 'commandcode', vaultPath: vault,
        vaultAdapter: storage, syncConversation: true });
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await harness.close();
        await host.dispose();
        await execution.dispose();
      };
      releases.push(release);
      return { harness, runtime, release, reportedEfforts, requestedEfforts };
    };
    try {
      const first = await open(paidEffort ? 'high' : undefined);
      const prompt = 'Read Note.md using read_file. Reply with only the exact token in that file.';
      const sent = await first.harness.tab.send({ text: prompt }, userMessage(prompt));
      const completed = await sent.ticket.completion;
      await first.harness.tab.settled();
      if (completed.terminal.kind !== 'succeeded') throw new Error(JSON.stringify({ completed, requestedEfforts: first.requestedEfforts }));
      expect({ terminal: completed.terminal, chunks: first.harness.column.chunks }).toMatchObject({ terminal: { kind: 'succeeded' } });
      expect(first.harness.column.chunks.some(chunk => chunk.type === 'tool_use')).toBe(true);
      expect(first.harness.column.drawn.join('')).toContain(token);
      expect(first.reportedEfforts).toContain(paidEffort ? 'high' : undefined);
      expect(first.requestedEfforts).toEqual([paidEffort ? 'high' : undefined]);
      await first.harness.saveAfterTurn();
      const sessionId = first.runtime.getSessionId();
      expect(sessionId).toBeTruthy();
      const saved = await first.harness.sessions.records.read('commandcode-live-chat');
      expect(saved.kind).toBe('present');
      if (saved.kind !== 'present') throw new Error('Conversation was not persisted.');
      expect(saved.metadata.sessionId).toBe(sessionId);
      await first.release();

      const resumed = await open(paidEffort ? 'max' : undefined);
      const followup = 'Without using any tools, repeat only the token from your previous answer.';
      const next = await resumed.harness.tab.send({ text: followup }, userMessage(followup));
      expect((await next.ticket.completion).terminal.kind).toBe('succeeded');
      await resumed.harness.tab.settled();
      expect(resumed.harness.column.drawn.join('')).toContain(token);
      expect(resumed.runtime.getSessionId()).toBe(sessionId);
      expect(resumed.reportedEfforts).toEqual([paidEffort ? 'max' : undefined]);
      expect(resumed.requestedEfforts).toEqual([paidEffort ? 'max' : undefined]);
    } finally {
      for (const release of releases.reverse()) await release();
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

const liveApprovals = process.env.GRIMOIRE_COMMANDCODE_APPROVAL_LIVE === '1' ? describe : describe.skip;
liveApprovals('Command Code real Safe approvals', () => {
  jest.setTimeout(180_000);
  it.each([
    { tool: 'edit_file', decision: 'allow' }, { tool: 'edit_file', decision: 'deny' }, { tool: 'edit_file', decision: 'cancel' },
    { tool: 'shell_command', decision: 'allow' }, { tool: 'shell_command', decision: 'deny' },
  ] as const)('waits for $tool and respects $decision through the chat projection', async ({ tool, decision }) => {
    const vault = mkdtempSync(join(tmpdir(), 'gcc-approval-live-'));
    const file = join(vault, 'Note.md');
    writeFileSync(file, 'OLD_MARKER\n');
    const host = new ExecutionKernelHost({ storage: new VaultDurableStorage(createDurableInMemoryVaultAdapter()),
      scheduler: { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout) } });
    const paidModel = 'commandcode:deepseek/deepseek-v4-flash';
    const plugin = {
      settings: { providerConfigs: { commandcode: { enabled: true, cliPath: process.env.GRIMOIRE_COMMANDCODE_CLI ?? '',
        discoveredModels: [{ rawId: paidModel.slice('commandcode:'.length), label: 'DeepSeek V4 Flash' }] } },
        model: paidModel, savedProviderModel: { commandcode: paidModel }, permissionMode: 'normal' },
      app: { vault: { adapter: { basePath: vault } } }, getApplicationRuntimeOrNull: () => null, recordDebugLog: () => undefined,
    } as unknown as GrimoirePlugin;
    const execution = new CommandcodeExecution(plugin, host.registry);
    const backend = execution.createBackend();
    host.registerBackend({ backend, interactions: backend.interactions });
    await host.start();
    const runtime = execution.createRuntime();
    const harness = await openChatProjection({ runtime, lifecycle: host.registry,
      backendId: backend.descriptor.backendId, conversationId: 'safe-live', providerId: 'commandcode', vaultPath: vault,
      vaultAdapter: createDurableInMemoryVaultAdapter(), syncConversation: true });
    const observations: Array<{ tool: string; input: string; before: string; after: string }> = [];
    const dismissed = jest.fn();
    runtime.installInteractions({ approvalDismisser: dismissed, approval: async (name, input) => {
      const before = readFileSync(file, 'utf8');
      // Hold the actual CLI at the approval boundary and prove it has not written.
      await new Promise(resolve => setTimeout(resolve, 250));
      observations.push({ tool: name, input: JSON.stringify(input), before, after: readFileSync(file, 'utf8') });
      if (decision === 'cancel') {
        await harness.tab.cancel();
        return 'allow'; // A late response after cancellation must have no effect.
      }
      return decision;
    } });
    try {
      const text = `Use ${tool} to replace OLD_MARKER with NEW_MARKER in Note.md, preserving the final newline. `
        + 'If denied, do not retry or use another tool. Reply briefly.';
      const sent = await harness.tab.send({ text }, userMessage(text));
      const completed = await sent.ticket.completion;
      await harness.tab.settled();
      expect(observations.length).toBeGreaterThan(0);
      expect(observations[0].before).toBe('OLD_MARKER\n');
      expect(observations.every(item => item.before === item.after)).toBe(true);
      expect(observations.some(item => item.input.includes('Note.md') && item.tool === (tool === 'edit_file' ? 'Edit' : 'Bash'))).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(decision === 'allow' ? 'NEW_MARKER\n' : 'OLD_MARKER\n');
      expect(completed.terminal).toMatchObject({ kind: decision === 'cancel' ? 'cancelled' : 'succeeded' });
      const settled = decision === 'cancel' ? dismissed.mock.calls.length > 0
        : harness.column.chunks.some(chunk => chunk.type === 'tool_result' &&
          (decision === 'allow' ? !chunk.isError : chunk.isError));
      expect(settled).toBe(true);
    } finally {
      await harness.close(); await host.dispose(); await execution.dispose();
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
