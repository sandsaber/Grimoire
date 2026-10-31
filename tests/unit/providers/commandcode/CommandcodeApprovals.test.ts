import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import { NodeLocalShellProcessAdapter } from '@/app/execution/local/NodeLocalShellProcessAdapter';
import type { InteractionRequest } from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import { runId } from '@/core/execution/ExecutionIds';
import type { LocalShellLaunchSpec } from '@/core/execution/local/LocalShellBackend';
import { CommandcodeApprovalPresenter, CommandcodeApprovals } from '@/providers/commandcode/execution/CommandcodeApprovals';
import type { CommandcodeApprovalHandler } from '@/providers/commandcode/runtime/CommandcodeApprovalTransport';
import { type CommandcodeProcessHandle, NodeCommandcodeProcessRunner } from '@/providers/commandcode/runtime/CommandcodeProcess';

// Exercise the actual process guard and IPC; this fake only replaces the vendor loop.
const CLI = `
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const emit = event => process.stdout.write(JSON.stringify({ type: 'event', event }) + '\\n');
let hook;
if (process.env.GUARD_SCENARIO !== 'missing') {
  const factory = (await import(pathToFileURL(process.argv[process.argv.indexOf('--mod') + 1]).href)).default;
  factory({ hooks: h => { hook = h.beforeToolCall; } });
}
emit({type: 'run_start', sessionId: 'probe'});
async function runTool(id) {
const call = { toolCallId: id, toolName: 'write_file', input: {file_path: 'Note.md', content: 'NEW'} };
emit({type: 'tool_queued', ...call});
const result = process.env.GUARD_SCENARIO === 'skipped' ? undefined : await hook(call, {signal: new AbortController().signal});
if (result?.block) emit({type: 'tool_hook_blocked', ...call, hookOutput: result.additionalContext});
else {
  emit({type: 'tool_running', toolCallId: call.toolCallId, toolName: call.toolName});
  writeFileSync('Note.md', 'NEW');
  emit({type: 'tool_completed', ...call, result: []});
}
}
await (process.env.GUARD_SCENARIO === 'parallel' ? Promise.all([runTool('edit-1'), runTool('edit-2')]) : runTool('edit-1'));
process.stdout.write(JSON.stringify({type:'result', subtype:'success', finalText:'Done'}) + '\\n');
`;

type TracedHandle = CommandcodeProcessHandle & { trace: string[] };

class TracingProcessAdapter extends NodeLocalShellProcessAdapter {
  constructor(private readonly trace: string[]) { super(); }

  override launch(spec: LocalShellLaunchSpec) {
    const child = super.launch(spec);
    const trace = this.trace;
    void child.started.then(() => trace.push('child ready'), error => trace.push(`child startup error: ${String(error)}`));
    void child.exited.then(exit => trace.push(`child exit: ${exit.code}`));
    return { ...child, stderr: (async function* () {
      for await (const chunk of child.stderr) {
        trace.push(`stderr: ${Buffer.from(chunk).toString('utf8').slice(0, 2048)}`);
        yield chunk;
      }
    })() };
  }
}

function phase<T>(handle: TracedHandle, name: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} timed out. ${handle.trace.join(' | ')}`)), timeoutMs);
    void promise.then(value => {
      clearTimeout(timeout);
      resolve(value);
    }, error => {
      clearTimeout(timeout);
      reject(new Error(`${name} failed: ${String(error)}. ${handle.trace.join(' | ')}`));
    });
  });
}

async function waitForApproval(handle: TracedHandle, opened: Promise<void>): Promise<void> {
  await phase(handle, 'CLI startup', handle.started, 35_000);
  await phase(handle, 'Approval request', Promise.race([opened, handle.completed.then(exit => {
    throw new Error(`CLI exited with code ${exit.code} before opening an approval.`);
  })]), 5_000);
}

describe.each(['1.53.0', '1.66.0'])('Command Code %s Safe process guard', version => {
  // Windows pays for a cold guardian compile before the CLI can answer.
  jest.setTimeout(process.platform === 'win32' ? 60_000 : 15_000);
  let directory: string;
  let handles: TracedHandle[];
  beforeEach(() => {
    handles = [];
    directory = mkdtempSync(join(tmpdir(), 'gcc-test-'));
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'command-code', version }));
    writeFileSync(join(directory, 'dist/index.mjs'), CLI);
    writeFileSync(join(directory, 'Note.md'), 'OLD');
  });
  afterEach(async () => {
    for (const handle of handles) {
      await phase(handle, 'Forced termination', handle.terminate('forced'), 5_000);
      await phase(handle, 'Output drain', handle.completed.catch(() => undefined), 5_000);
      if (!await handle.confirmTerminated()) throw new Error(`Process tree remained live. ${handle.trace.join(' | ')}`);
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const contents = () => readFileSync(join(directory, 'Note.md'), 'utf8');
  const start = (approve: CommandcodeApprovalHandler, scenario = '') => {
    const trace: string[] = [];
    const processHandle = new NodeCommandcodeProcessRunner(new TracingProcessAdapter(trace)).start({
      command: join(directory, 'dist/index.mjs'), cwd: directory,
      environment: { PATH: process.env.PATH!, GUARD_SCENARIO: scenario, NODE_DEBUG: 'net',
        ...(process.env.LOCALAPPDATA ? { LOCALAPPDATA: process.env.LOCALAPPDATA } : {}) },
      prompt: 'Edit Note.md', permissionMode: 'normal',
    }, event => { trace.push(`event: ${String(event.type)}`); }, () => undefined, async (request, signal) => {
      trace.push('approval opened');
      try {
        const allowed = await approve(request, signal);
        trace.push(`approval answered: ${allowed}`);
        return allowed;
      } catch (error) {
        trace.push(`approval handler failed: ${String(error)}`);
        throw error;
      }
    });
    const handle = { ...processHandle, trace };
    void handle.started.then(() => trace.push('started'), error => trace.push(`startup error: ${String(error)}`));
    void handle.completed.then(exit => trace.push(`completed: ${exit.code}`), error => trace.push(`completion error: ${String(error)}`));
    handles.push(handle);
    return handle;
  };

  it.each([true, false])('waits for an explicit answer before writing: allow=%s', async allow => {
    let answer!: (allow: boolean) => void;
    let opened!: () => void;
    const waiting = new Promise<void>(resolve => { opened = resolve; });
    const handle = start(async tool => {
      expect(tool.input.file_path).toBe('Note.md');
      opened();
      return new Promise(resolve => { answer = resolve; });
    });
    try {
      await waitForApproval(handle, waiting);
      expect(contents()).toBe('OLD');
      answer(allow);
      expect((await phase(handle, 'CLI completion', handle.completed, 15_000)).code).toBe(0);
      expect(contents()).toBe(allow ? 'NEW' : 'OLD');
    } finally { await handle.terminate('forced'); }
  });

  it('launches the verified Node executable directly inside the owned process tree', async () => {
    const launch = jest.spyOn(NodeLocalShellProcessAdapter.prototype, 'launch');
    const handle = start(async () => true);
    try {
      expect(launch).toHaveBeenCalledWith(expect.objectContaining({ windowsInvocationMode: 'direct' }));
      expect((await handle.completed).code).toBe(0);
    } finally {
      await handle.terminate('forced');
      launch.mockRestore();
    }
  });

  it.each(['missing', 'skipped'])('stops before execution if the approval mod is %s', async scenario => {
    const approve = jest.fn(async () => true);
    const handle = start(approve, scenario);
    try {
      expect((await handle.completed).code).not.toBe(0);
      expect(approve).not.toHaveBeenCalled();
      expect(contents()).toBe('OLD');
    } finally { await handle.terminate('forced'); }
  });

  it('denies when the approval handler fails', async () => {
    const handle = start(async () => { throw new Error('view detached'); });
    try { await handle.completed; expect(contents()).toBe('OLD'); }
    finally { await handle.terminate('forced'); }
  });

  it('serializes approvals from a parallel native tool batch', async () => {
    let active = 0, maximum = 0, calls = 0;
    const handle = start(async () => {
      calls++; active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active--;
      return true;
    }, 'parallel');
    try {
      expect((await handle.completed).code).toBe(0);
      expect(calls).toBe(2);
      expect(maximum).toBe(1);
    } finally { await handle.terminate('forced'); }
  });

  it.each(['1.66.1', '9.0.0'])('refuses unverified CLI %s without executing it', unsupportedVersion => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'command-code', version: unsupportedVersion }));
    expect(() => start(async () => true)).toThrow('Safe mode requires');
    expect(contents()).toBe('OLD');
  });

  it('cancels a pending approval and cannot accept a late allowance', async () => {
    let opened!: () => void;
    const waiting = new Promise<void>(resolve => { opened = resolve; });
    let answer!: (allow: boolean) => void;
    const handle = start(async () => { opened(); return new Promise(resolve => { answer = resolve; }); });
    await waitForApproval(handle, waiting);
    await handle.terminate('forced');
    answer(true);
    await handle.completed;
    expect(contents()).toBe('OLD');
  });
});

describe('Command Code approval lifecycle', () => {
  const id = runId(`run-${'1'.repeat(32)}`);
  const tool = { toolCallId: 'edit-1', toolName: 'edit_file', input: { file_path: 'Note.md' } };
  it('resolves once and discards a late allowance after cancellation', async () => {
    const approvals = new CommandcodeApprovals();
    const events: ProviderExecutionEvent['event'][] = [];
    const abort = new AbortController();
    const answer = approvals.request(id, tool, abort.signal, event => events.push(event));
    const opened = events[0];
    if (opened.kind !== 'interaction-opened') throw new Error('Missing approval');
    expect(approvals.presentation(opened.interaction.presentationRef)).toEqual(tool);
    abort.abort();
    await approvals.resolve({ interactionId: opened.interaction.interactionId, responseId: 'allow-once', resolvedAt: Date.now() });
    expect(await answer).toBe(false);
    expect(events.filter(event => event.kind === 'interaction-resolved')).toHaveLength(1);
    expect(approvals.presentation(opened.interaction.presentationRef)).toBeUndefined();
  });

  it.each(['allow', 'deny', 'cancel'] as const)('maps the visible decision %s to a one-time response', async decision => {
    const approvals = new CommandcodeApprovals();
    let request!: InteractionRequest;
    const answer = approvals.request(id, tool, new AbortController().signal, event => {
      if (event.kind === 'interaction-opened') request = event.interaction;
    });
    const approval = jest.fn(async () => decision);
    const presenter = new CommandcodeApprovalPresenter(approvals, () => ({ approval }));
    const responseId = await presenter.present(request);
    expect(approval).toHaveBeenCalledWith('Edit', tool.input, expect.any(String), expect.objectContaining({
      decisionOptions: [expect.objectContaining({ value: 'allow-once' }), expect.objectContaining({ value: 'deny' })],
    }));
    expect(responseId).toBe(decision === 'allow' ? 'allow-once' : 'deny');
    await approvals.resolve({ interactionId: request.interactionId, responseId: responseId!, resolvedAt: Date.now() });
    expect(await answer).toBe(decision === 'allow');
  });
});
