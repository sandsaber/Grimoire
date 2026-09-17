import { executionSessionId, runId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import { commandcodeProviderModule } from '@/providers/commandcode/CommandcodeProviderModule';
import { CommandcodeContentPresenter } from '@/providers/commandcode/execution/CommandcodeContentPresenter';
import { type CommandcodeBackendContext,CommandcodeExecutionBackend } from '@/providers/commandcode/execution/CommandcodeExecutionBackend';
import { parseCommandcodeModels } from '@/providers/commandcode/runtime/CommandcodeModelDiscovery';
import { type CommandcodeInvocation, commandcodeLaunchSpec, type CommandcodeProcessHandle } from '@/providers/commandcode/runtime/CommandcodeProcess';
import { CommandcodeStream } from '@/providers/commandcode/runtime/CommandcodeStream';

const invocation: CommandcodeInvocation = { command: '/bin/command-code', cwd: '/vault', environment: {},
  prompt: 'A prompt with $() and "quotes"', permissionMode: 'normal' };
const request = { runId: runId(`run-${'1'.repeat(32)}`), requestRef: 'request-1', owner: { kind: 'conversation' as const, ownerId: 'chat-1' },
  resultExpectation: 'required' as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const outcome = deferred<Awaited<CommandcodeProcessHandle['completed']>>();
  const handle: CommandcodeProcessHandle = {
    started: Promise.resolve(), completed: outcome.promise,
    confirmTerminated: jest.fn(async () => true), terminate: jest.fn(async () => 'confirmed'),
  };
  let emit!: (event: Record<string, unknown>) => void;
  let bind!: (id: string) => void;
  const context: CommandcodeBackendContext = {
    resolve: jest.fn(async () => ({ ...invocation })),
    runner: { start: jest.fn((_invocation, event, session) => { emit = event; bind = session; return handle; }) },
    sessionInstanceId: () => sessionInstanceId(`si-${'2'.repeat(32)}`), delay: async () => undefined,
    setTimeout: () => 1, clearTimeout: () => undefined,
  };
  const backend = new CommandcodeExecutionBackend(context);
  return { backend, context, handle, outcome, emit: (event: Record<string, unknown>) => emit(event), bind: (id: string) => bind(id) };
}

describe('Command Code execution', () => {
  it('uses stdin and explicit resume, never global continue or implicit auto-approval', () => {
    const launch = commandcodeLaunchSpec({ ...invocation, sessionId: 'native-1', model: 'vendor/model' });
    expect(launch.stdin).toBe('pipe');
    expect(launch.arguments).toEqual(['--print', '--output-format', 'json', '--skip-onboarding', '--no-auto-update',
      '--model', 'vendor/model', '--resume', 'native-1', '--permission-mode', 'standard']);
    expect(launch.arguments).not.toContain(invocation.prompt);
    expect(commandcodeLaunchSpec({ ...invocation, permissionMode: 'full_access' }).arguments).toContain('--yolo');
  });

  it('streams once, records native session identity and publishes one terminal', async () => {
    const f = fixture();
    const session = await f.backend.createSession({ executionSessionId: executionSessionId(`es-${'3'.repeat(32)}`),
      owner: request.owner, backendGeneration: 1 });
    const run = session.createRun(request);
    await Promise.resolve(); await Promise.resolve();
    f.bind('native-1');
    f.emit({ type: 'text_delta', delta: 'Hello' });
    f.outcome.resolve({ code: 0, result: { subtype: 'success', finalText: 'Hello' } });
    const events = [];
    for await (const event of run.events) events.push(event.event);
    expect(events.filter(event => event.kind === 'output-delta')).toEqual([
      { kind: 'output-delta', channel: 'assistant', text: 'Hello' },
    ]);
    expect(events.filter(event => event.kind === 'terminal')).toEqual([
      { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
    ]);
    expect(session.getSnapshot().nativeSessionRef).toBe('native-1');
    await f.backend.dispose();
  });

  it.each([
    { code: 0 },
    { code: 8, result: { subtype: 'max_turns' as const, finalText: 'Partial' } },
    { code: 1, result: { subtype: 'success' as const, finalText: 'Looks successful' } },
  ])('rejects an incomplete or failed process: %j', async outcome => {
    const f = fixture();
    const session = await f.backend.createSession({ executionSessionId: executionSessionId(`es-${'3'.repeat(32)}`),
      owner: request.owner, backendGeneration: 1 });
    const run = session.createRun(request);
    f.outcome.resolve(outcome);
    const events = [];
    for await (const event of run.events) events.push(event.event);
    expect(events.some(event => event.kind === 'result')).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'terminal', terminal: 'failed' });
    await f.backend.dispose();
  });

  it('does not spawn after cancellation during preparation', async () => {
    const f = fixture();
    const pending = deferred<CommandcodeInvocation>();
    f.context.resolve = () => pending.promise;
    const session = await f.backend.createSession({ executionSessionId: executionSessionId(`es-${'3'.repeat(32)}`),
      owner: request.owner, backendGeneration: 1 });
    const run = session.createRun(request);
    await run.cancel();
    pending.resolve(invocation);
    await Promise.resolve();
    expect(f.context.runner.start).not.toHaveBeenCalled();
    await f.backend.dispose();
  });

  it('reports unknown cancellation when process-tree termination cannot be confirmed', async () => {
    const f = fixture();
    f.handle.confirmTerminated = async () => false;
    f.handle.terminate = async () => 'unconfirmed';
    const session = await f.backend.createSession({ executionSessionId: executionSessionId(`es-${'3'.repeat(32)}`),
      owner: request.owner, backendGeneration: 1 });
    const run = session.createRun(request);
    await Promise.resolve(); await Promise.resolve();
    await run.cancel();
    const events = [];
    for await (const event of run.events) events.push(event.event);
    expect(events.at(-1)).toMatchObject({ kind: 'terminal', terminal: 'indeterminate', reason: 'cancellation-unknown' });
    f.outcome.resolve({ code: 130 });
    await f.backend.dispose();
  });
});

describe('Command Code presentation and discovery', () => {
  it('settles a headless permission block as a failed tool instead of leaving Edit running', () => {
    const presenter = new CommandcodeContentPresenter();
    const chunks: unknown[] = [];
    const stream = new CommandcodeStream(event => chunks.push(...presenter.present(event)));
    stream.accept(JSON.stringify({ type: 'event', event: { type: 'tool_queued',
      toolCallId: 'edit-1', toolName: 'edit_file', input: { file_path: 'Note.md' } } }));
    stream.accept(JSON.stringify({ type: 'event', event: { type: 'tool_hook_blocked',
      toolCallId: 'edit-1', toolName: 'edit_file', hookOutput: 'Edit requires permissions.' } }));
    expect(chunks).toEqual([
      { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'Note.md' } },
      { type: 'tool_result', id: 'edit-1', content: 'Edit requires permissions.', isError: true },
    ]);
  });

  it('persists and invalidates the native session through the shared history port', () => {
    const history = commandcodeProviderModule.runtimePorts({ resolveSessionId: () => 'native-1' }).history!;
    expect(history.resolveSessionId('chat-1')).toBe('native-1');
    expect(history.buildSessionPatch({ conversationId: 'chat-1', nativeSessionRef: 'native-1', sessionInvalidated: false }))
      .toEqual({ sessionId: 'native-1' });
    expect(history.buildSessionPatch({ conversationId: 'chat-1', nativeSessionRef: 'native-1', sessionInvalidated: true }))
      .toEqual({ sessionId: null });
  });

  it('uses reported input tokens without counting cached input twice', () => {
    const presenter = new CommandcodeContentPresenter(() => 100_000);
    expect(presenter.present({ type: 'model_request_end', model: 'vendor/model',
      usage: { inputTokens: 14_711, cacheReadTokens: 7072, outputTokens: 44 } }))
      .toMatchObject([{ type: 'usage', usage: { model: 'vendor/model', inputTokens: 14_711,
        contextTokens: 14_711, contextWindow: 100_000, contextWindowIsAuthoritative: false } }]);
  });

  it('renders observed queued/completed/errored tool events', () => {
    const presenter = new CommandcodeContentPresenter();
    expect(presenter.present({ type: 'tool_queued', toolCallId: 'tool-1', toolName: 'read_file', input: { file_path: 'probe.txt' } }))
      .toEqual([{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'probe.txt' } }]);
    expect(presenter.present({ type: 'tool_completed', toolCallId: 'tool-1', result: [{ type: 'text', text: 'File content' }] }))
      .toEqual([{ type: 'tool_result', id: 'tool-1', content: 'File content' }]);
    expect(presenter.present({ type: 'tool_errored', toolCallId: 'tool-1', error: 'Denied' }))
      .toEqual([{ type: 'tool_result', id: 'tool-1', content: 'Denied', isError: true }]);
  });

  it('reads opaque model IDs without treating headings or examples as models', () => {
    expect(parseCommandcodeModels('Available models  ·  70 models\n\nOpen Source\nvendor/model:free  description\n\ncmd --model vendor/model:free\nDocs:  https://commandcode.ai\n'))
      .toEqual([{ rawId: 'vendor/model:free', label: 'vendor/model:free', description: 'description' }]);
  });
});
