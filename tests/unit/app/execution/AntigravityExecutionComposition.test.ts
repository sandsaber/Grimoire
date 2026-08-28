import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import {
  AntigravityExecution,
  buildAntigravityRequest,
  describeAntigravityFailure,
} from '@/app/execution/antigravity/AntigravityExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { PreparedChatTurn } from '@/core/runtime/types';
import type { ChatMessage, StreamChunk } from '@/core/types';
import type {
  AntigravityInvocation,
  AntigravityProcessHandle,
  AntigravityProcessOutcome,
  AntigravityProcessRunner,
} from '@/providers/antigravity/execution/AntigravityExecutionBackend';
import { AntigravityRequestStore } from '@/providers/antigravity/execution/AntigravityRequestStore';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

/**
 * The half of the Antigravity flip that only exists in production.
 *
 * The backend takes a request reference and knows nothing about what is inside
 * it; the adapter produces one and knows nothing either. This module is the
 * only place that knows both, so a defect here is invisible to every suite that
 * proved the two halves separately — which is exactly what happened. The first
 * end-to-end turn written here failed on the registry's identifier rule,
 * because the reference had been built to carry the prompt itself.
 */
describe('Antigravity execution composition', () => {
  function createPlugin(overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = { permissionMode: 'full_access', ...overrides };
    updateAntigravityProviderSettings(settings, {
      enabled: true,
      visibleModels: ['Gemini 3.5 Flash (Medium)'],
    });
    return {
      settings,
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/agy',
      recordDebugLog: () => undefined,
    };
  }

  function turn(text: string): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: text,
      prompt: text,
      request: { text },
    };
  }

  /** One `agy` run, without an `agy`. */
  class FakeRunner implements AntigravityProcessRunner {
    readonly invocations: AntigravityInvocation[] = [];
    readonly terminations: Array<'graceful' | 'forced'> = [];
    outcome: AntigravityProcessOutcome = { exitCode: 0, stdout: 'the answer\n', stderr: '' };
    /** Held open so a turn can be cancelled while the process is still running. */
    hang = false;
    private release: ((outcome: AntigravityProcessOutcome) => void) | undefined;

    start(invocation: AntigravityInvocation): AntigravityProcessHandle {
      this.invocations.push(invocation);
      const completed = this.hang
        ? new Promise<AntigravityProcessOutcome>(resolve => { this.release = resolve; })
        : Promise.resolve(this.outcome);
      return {
        started: Promise.resolve(),
        completed,
        outputLimitExceeded: new Promise(() => undefined),
        confirmTerminated: async () => true,
        terminate: async mode => {
          this.terminations.push(mode);
          this.release?.({ exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' });
          return 'confirmed' as const;
        },
      };
    }
  }

  async function createTurnHarness(plugin: any): Promise<{
    runtime: ReturnType<AntigravityExecution['createRuntime']>;
    runner: FakeRunner;
  }> {
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const execution = new AntigravityExecution(plugin, host.registry);
    const runner = new FakeRunner();
    host.registerBackend({ backend: execution.createBackend(runner) });
    await host.start();
    return { runtime: execution.createRuntime(), runner };
  }

  async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
      await new Promise(resolve => { setTimeout(resolve, 1); });
    }
  }

  async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const collected: StreamChunk[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    return collected;
  }

  it('carries a whole turn from the tab to the CLI invocation and back', async () => {
    // The flip path end to end: the runtime stores a request and hands the
    // kernel a reference, the registry dispatches it, the backend resolves it
    // into an invocation, and the print output comes back as a chunk. Every
    // seam in that sentence is covered by a suite that stubs the next one.
    const plugin = createPlugin();
    const { runtime, runner } = await createTurnHarness(plugin);
    const history: ChatMessage[] = [
      { role: 'user', content: 'earlier question' } as ChatMessage,
      { role: 'assistant', content: 'earlier answer' } as ChatMessage,
    ];

    const chunks = await drain(runtime.query(turn('what now?'), history, {
      model: 'antigravity:Fast',
    }));

    expect(runner.invocations).toHaveLength(1);
    // Print mode keeps no session, so continuity exists only as replayed
    // history inside the prompt. Losing it here loses the conversation.
    expect(runner.invocations[0]?.prompt).toBe(
      'User: earlier question\n\nAssistant: earlier answer\n\nUser: what now?',
    );
    expect(runner.invocations[0]?.model).toBe('Fast');
    expect(runner.invocations[0]?.command).toBe('/usr/local/bin/agy');
    expect(runner.invocations[0]?.cwd).toBe('/vault');
    expect(chunks).toEqual([{ type: 'text', content: 'the answer' }]);
    expect(runtime.consumeTurnMetadata().wasSent).toBe(true);
  });

  it('carries every context surface into the persisted turn and the CLI prompt', async () => {
    // Print mode has no session, no MCP, and no file-reading tools of its own,
    // so everything Grimoire knows about the note, the selection and the pinned
    // files exists in the turn only if it was composed into the prompt. This was
    // covered by the legacy runtime's suite until that runtime was deleted with
    // it; the replacement asserts the same surfaces against the real invocation.
    const { runtime, runner } = await createTurnHarness(createPlugin());

    const prepared = runtime.prepareTurn({
      browserSelection: {
        selectedText: 'Browser quote',
        source: 'browser:https://example.com',
        title: 'Example',
        url: 'https://example.com',
      },
      canvasSelection: { canvasPath: 'board.canvas', nodeIds: ['node-1', 'node-2'] },
      contextFiles: ['notes/instructions.md'],
      currentNotePath: 'notes/today.md',
      excludedFolders: ['Climate'],
      editorSelection: {
        mode: 'selection',
        notePath: 'notes/today.md',
        selectedText: 'Selected text',
        startLine: 4,
        lineCount: 2,
      },
      text: 'Summarize this',
    } as never);
    await drain(runtime.query(prepared));

    const surfaces = [
      '<current_note>',
      'notes/today.md',
      '<context_files>',
      'notes/instructions.md',
      '<excluded_folders>',
      '<folder>Climate</folder>',
      '<editor_selection path="notes/today.md" lines="4-5">',
      'Selected text',
      '<browser_selection source="browser:https://example.com" title="Example" url="https://example.com">',
      '<canvas_selection path="board.canvas">',
    ];
    for (const surface of surfaces) {
      // Both halves: what the conversation stores, and what `agy` is asked.
      expect(prepared.persistedContent).toContain(surface);
      expect(runner.invocations[0]?.prompt).toContain(surface);
    }
  });

  it('rebuilds a prior turn\'s note context from conversation history', async () => {
    // The note a past turn was asked about is metadata on the message, not part
    // of its text, so replaying history without it silently drops the context
    // the earlier answer depended on.
    const { runtime, runner } = await createTurnHarness(createPlugin());

    await drain(runtime.query(turn('Continue'), [{
      content: 'Earlier request',
      currentNote: 'notes/prior.md',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    }]));

    const prompt = runner.invocations[0]?.prompt ?? '';
    expect(prompt).toContain('<current_note>');
    expect(prompt).toContain('notes/prior.md');
    expect(prompt).toContain('Earlier request');
    expect(prompt).toContain('User: Continue');
  });

  it('cancels a running turn by terminating the process, and closes the turn', async () => {
    // Smoke-matrix step 3, as a gate rather than a click. The legacy runtime
    // cancelled by sending SIGTERM to a child it held; the kernel path dispatches
    // a cancellation the run answers for, so the two things worth pinning are
    // that the process is actually terminated and that the generator closes —
    // a cancel that leaves the turn open is how a tab never becomes idle again.
    const { runtime, runner } = await createTurnHarness(createPlugin());
    runner.hang = true;

    const chunks: StreamChunk[] = [];
    const turnDone = (async () => {
      for await (const chunk of runtime.query(turn('go'))) {
        chunks.push(chunk);
      }
    })();
    await waitFor(() => runner.invocations.length === 1);
    runtime.cancel();
    await turnDone;

    expect(runner.terminations[0]).toBe('graceful');
    expect(chunks).toEqual([]);
    // `wasSent` stays true: the turn did reach the provider, which is what
    // separates a cancellation from a pre-dispatch rejection.
    expect(runtime.consumeTurnMetadata().wasSent).toBe(true);
  });

  it('reads the permission mode this provider was given, not another provider\'s', async () => {
    // Recorded from a real vault. The toolbar toggle writes the mode into
    // `savedProviderPermissionMode[providerId]`, and only copies it to the
    // top-level `permissionMode` when the provider happens to be the one the
    // settings tab is showing. Reading the top-level value therefore reads
    // whatever the *settings* provider is set to — here Codex, on `normal` —
    // so Antigravity refused every turn while its own toggle said Auto-approve.
    const plugin = createPlugin({
      settingsProvider: 'codex',
      permissionMode: 'normal',
      savedProviderPermissionMode: { antigravity: 'full_access', codex: 'normal' },
    });
    const { runtime, runner } = await createTurnHarness(plugin);

    const chunks = await drain(runtime.query(turn('go')));

    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]?.permissionMode).toBe('full_access');
    expect(chunks).toEqual([{ type: 'text', content: 'the answer' }]);
  });

  it('renders the safe-mode refusal as the chunk the chat surface shows', async () => {
    // The shipped permission mode is `normal` and `agy --print` cannot request
    // approvals, so this is the first thing an Antigravity user sees. The
    // kernel classifies it as `pre-dispatch-rejected`, whose neutral sentence
    // cannot name the setting to change.
    const { runtime, runner } = await createTurnHarness(createPlugin({
      permissionMode: 'normal',
      savedProviderPermissionMode: { antigravity: 'normal' },
    }));

    const chunks = await drain(runtime.query(turn('go')));

    expect(runner.invocations).toEqual([]);
    expect(chunks).toEqual([
      { type: 'error', content: expect.stringContaining('Safe mode is unavailable') },
    ]);
    expect(runtime.consumeTurnMetadata().wasSent).toBe(false);
  });

  it('reads settings when the run dispatches, not when the turn was queued', async () => {
    // The store holds only what the turn decided. A CLI path captured at send
    // time would launch what the user had configured then, which is the bug
    // this split exists to avoid.
    const plugin = createPlugin();
    const { runtime, runner } = await createTurnHarness(plugin);
    plugin.getResolvedProviderCliPath = () => '/opt/agy';

    await drain(runtime.query(turn('go')));

    expect(runner.invocations[0]?.command).toBe('/opt/agy');
  });

  it('persists the same session binding the runtime it replaced did', async () => {
    // Persisted-state parity across the flip. The legacy runtime wrote
    // `sessionId: null` and echoed `providerState` back unchanged — a no-op
    // patch, since print mode has no native session to record. The adapter
    // contributes no history port for this provider and so patches nothing.
    // The one observable difference, an explicit null against an absent key,
    // cannot change a conversation whose session id was never anything else.
    const { runtime } = await createTurnHarness(createPlugin());

    expect(runtime.getSessionId()).toBeNull();
    expect(runtime.resolveSessionIdForFork?.({ id: 'conversation-1' })).toBeNull();
    expect(runtime.buildSessionUpdates?.({
      conversation: { id: 'conversation-1' },
      sessionInvalidated: false,
    })).toEqual({ updates: {} });
  });

  it('explains the failures it can, and defers on the rest', () => {
    const plugin = createPlugin();

    expect(describeAntigravityFailure(plugin, 'missing-required-result'))
      .toContain('finished without a response');
    // Full access and enabled: the only remaining cause of a pre-dispatch
    // rejection is a reference that no longer resolves, which is a defect and
    // not something to explain to a user in provider terms.
    expect(describeAntigravityFailure(plugin, 'pre-dispatch-rejected')).toBeUndefined();
    expect(describeAntigravityFailure(plugin, 'nonzero-exit')).toBeUndefined();
    expect(describeAntigravityFailure(plugin, 'timeout')).toBeUndefined();

    updateAntigravityProviderSettings(plugin.settings, { enabled: false });
    expect(describeAntigravityFailure(plugin, 'pre-dispatch-rejected'))
      .toContain('Enable it in provider settings');
  });

  it('falls back to the first visible model when the turn selected none', () => {
    const plugin = createPlugin();

    expect(buildAntigravityRequest(plugin, turn('go')).model).toBe('Gemini 3.5 Flash (Medium)');
  });
});

/**
 * The store behind the reference, on its own.
 *
 * The registry validates `requestRef` as a constrained identifier, so the
 * reference names the request and the store holds it. Its bound matters too: a
 * turn rejected before dispatch never comes back for its request.
 */
describe('Antigravity request store', () => {
  it('hands a request back exactly once', () => {
    let ordinal = 0;
    const store = new AntigravityRequestStore(() => `agyreq-${++ordinal}`);

    const reference = store.reference({ prompt: 'hello', model: null });

    expect(store.resolve(reference)).toEqual({ prompt: 'hello', model: null });
    expect(() => store.resolve(reference)).toThrow('unknown');
    expect(store.pendingCount).toBe(0);
  });

  it('drops the oldest un-dispatched request rather than growing forever', () => {
    let ordinal = 0;
    const store = new AntigravityRequestStore(() => `agyreq-${++ordinal}`, 2);

    const first = store.reference({ prompt: 'one', model: null });
    store.reference({ prompt: 'two', model: null });
    const third = store.reference({ prompt: 'three', model: null });

    expect(store.pendingCount).toBe(2);
    // The evicted reference resolves to nothing, which the backend turns into
    // `pre-dispatch-rejected` — the honest answer for a turn it cannot launch.
    expect(() => store.resolve(first)).toThrow('unknown');
    expect(store.resolve(third)).toEqual({ prompt: 'three', model: null });
  });
});
