import type { ChatMessage } from '@/core/types';
import {
  CodexExecutionRequests,
  type CodexInvocationEnvironment,
} from '@/providers/codex/execution/CodexExecutionRequests';
import type { CodexAttachmentScratch } from '@/providers/codex/execution/CodexTurnInput';
import type { CodexLaunchSpec } from '@/providers/codex/runtime/codexLaunchTypes';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

/**
 * What a queued Codex turn becomes at the moment it is dispatched.
 *
 * Everything ambient is read here rather than frozen when the user pressed
 * send: the thread the conversation is bound to, the settings, and the target
 * the daemon runs on can all change between the two, and the turn has to be the
 * one the user would recognise now.
 */
describe('Codex execution requests', () => {
  function environment(overrides: Partial<CodexInvocationEnvironment> = {}): CodexInvocationEnvironment {
    return {
      settings: {
        permissionMode: 'default',
        effortLevel: 'medium',
        serviceTier: 'standard',
        providerConfigs: { codex: { reasoningSummary: 'detailed' } },
      },
      launchSpec: launchSpec(),
      baseInstructions: 'You are Grimoire.',
      conversation: null,
      listSkills: async () => [],
      scratch: recordingScratch(),
      ...overrides,
    };
  }

  function store(overrides: Partial<CodexInvocationEnvironment> = {}): CodexExecutionRequests {
    let minted = 0;
    return new CodexExecutionRequests(
      () => `codexreq-${++minted}`,
      async () => environment(overrides),
    );
  }

  function request(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'summarise the note',
      text: 'summarise the note',
      isCompact: false,
      externalContextPaths: [],
      orchestratorMode: false,
      ...overrides,
    };
  }

  it('starts a thread for a conversation that has none, and carries the history into the prompt', async () => {
    // A fresh thread knows nothing about what was said before it, so the
    // conversation so far is the only way the turn makes sense.
    const requests = store();
    const ref = requests.reference(request({
      history: [
        { role: 'user', content: 'what is this note about?' },
        { role: 'assistant', content: 'it is about sandboxes' },
      ] as ChatMessage[],
    }));

    const invocation = await requests.resolve(ref);

    expect(invocation.thread.kind).toBe('new');
    if (invocation.thread.kind !== 'new') throw new Error('expected a new thread');
    expect(invocation.thread.params).toMatchObject({
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      cwd: '/mnt/wsl/vault',
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
      baseInstructions: 'You are Grimoire.',
      experimentalRawEvents: true,
      persistExtendedHistory: true,
    });
    if (invocation.turn.kind !== 'start') throw new Error('expected a turn');
    const text = invocation.turn.params.input.find(item => item.type === 'text');
    expect(text).toMatchObject({ text: expect.stringContaining('sandboxes') });
    expect(text).toMatchObject({ text: expect.stringContaining('User: summarise the note') });
  });

  it('resumes a bound thread and leaves the prompt alone', async () => {
    // The thread already holds the conversation; prepending it again would
    // replay everything the model has already read.
    const requests = store({
      conversation: { sessionId: 'thread-7', providerState: {} },
    });
    const ref = requests.reference(request({
      history: [{ role: 'user', content: 'earlier' }] as ChatMessage[],
    }));

    const invocation = await requests.resolve(ref);

    expect(invocation.thread).toMatchObject({ kind: 'resume', threadId: 'thread-7' });
    if (invocation.turn.kind !== 'start') throw new Error('expected a turn');
    expect(invocation.turn.params.input).toEqual([
      { type: 'text', text: 'summarise the note', text_elements: [] },
    ]);
  });

  it('replays only what came after the checkpoint when the conversation is a pending fork', async () => {
    const requests = store({
      conversation: {
        providerState: { forkSource: { sessionId: 'thread-source', resumeAt: 'assistant-2' } },
      },
    });
    const ref = requests.reference(request({
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second', assistantMessageId: 'assistant-2' },
        { role: 'user', content: 'third' },
      ] as ChatMessage[],
    }));

    const invocation = await requests.resolve(ref);

    expect(invocation.thread).toMatchObject({
      kind: 'fork',
      sourceThreadId: 'thread-source',
      resumeAtTurnId: 'assistant-2',
    });
    if (invocation.turn.kind !== 'start') throw new Error('expected a turn');
    const text = invocation.turn.params.input.find(item => item.type === 'text');
    expect(text).toMatchObject({ text: expect.stringContaining('third') });
    expect(text).not.toMatchObject({ text: expect.stringContaining('first') });
  });

  it('asks for a compaction without composing a turn for it', async () => {
    const requests = store({ conversation: { sessionId: 'thread-7' } });
    const ref = requests.reference(request({ isCompact: true, text: '/compact', prompt: '/compact' }));

    expect((await requests.resolve(ref)).turn).toEqual({ kind: 'compact' });
  });

  it('carries the sandbox the settings describe and the mode the turn runs in', async () => {
    const requests = store({
      settings: {
        permissionMode: 'plan',
        effortLevel: 'high',
        serviceTier: 'standard',
        providerConfigs: { codex: { reasoningSummary: 'concise' } },
      },
    });
    const ref = requests.reference(request({ externalContextPaths: ['/vault/pinned.md'] }));

    const invocation = await requests.resolve(ref);

    if (invocation.turn.kind !== 'start') throw new Error('expected a turn');
    expect(invocation.turn.params).toMatchObject({
      approvalPolicy: 'on-request',
      effort: 'high',
      summary: 'concise',
      collaborationMode: expect.objectContaining({ mode: 'plan' }),
    });
    expect(invocation.turn.params.sandboxPolicy).toMatchObject({
      type: 'workspaceWrite',
      writableRoots: expect.arrayContaining(['/mnt/wsl/vault', '/mnt/wsl/vault/pinned.md']),
    });
  });

  it('resolves the skills the prompt names, and drops the ones it cannot', async () => {
    const requests = store({
      listSkills: async () => ([
        { name: 'review', path: '/skills/review', description: 'review', scope: 'repo', enabled: true },
      ] as never),
      conversation: { sessionId: 'thread-7' },
    });
    const ref = requests.reference(request({ text: 'run $review and $missing', prompt: 'run $review and $missing' }));

    const invocation = await requests.resolve(ref);

    if (invocation.turn.kind !== 'start') throw new Error('expected a turn');
    expect(invocation.turn.params.input).toContainEqual({
      type: 'skill',
      name: 'review',
      path: '/skills/review',
    });
  });

  it('gives steering the input and nothing else, since the turn is already running', async () => {
    const requests = store({ conversation: { sessionId: 'thread-7' } });
    const ref = requests.reference(request({ prompt: 'actually, stop', text: 'actually, stop' }));

    expect(await requests.resolveSteer(ref)).toEqual([
      { type: 'text', text: 'actually, stop', text_elements: [] },
    ]);
  });

  it('discards a turn\'s scratch once the next turn has one, and on shutdown', async () => {
    const scratch = recordingScratch();
    const requests = store({ scratch, conversation: { sessionId: 'thread-7' } });
    const image = { data: Buffer.from('one').toString('base64'), mediaType: 'image/png', name: 'a.png' };

    await requests.resolve(requests.reference(request({ images: [image] })));
    expect(scratch.removed).toEqual([]);

    await requests.resolve(requests.reference(request({ images: [image] })));
    expect(scratch.removed).toEqual([scratch.created[0]]);

    requests.dispose();
    expect(scratch.removed).toEqual(scratch.created);
  });

  it('lets a reference be dispatched once, and holds nothing after that', async () => {
    // A run dispatches once. Keeping the prompt afterwards is retention nobody
    // asked for, and a second dispatch of the same reference would be a turn
    // the user sent once arriving twice.
    const requests = store({ conversation: { sessionId: 'thread-7' } });
    const ref = requests.reference(request());

    await requests.resolve(ref);

    expect(requests.pendingCount).toBe(0);
    await expect(requests.resolve(ref)).rejects.toThrow(/unknown/i);
  });

  it('refuses a reference it never minted, so the run is rejected before dispatch', async () => {
    await expect(store().resolve('codexreq-never')).rejects.toThrow(/unknown/i);
  });
});

function launchSpec(): CodexLaunchSpec {
  const target = {
    method: 'wsl' as const,
    platformFamily: 'unix' as const,
    platformOs: 'linux' as const,
    distroName: 'Ubuntu',
  };
  const toTargetPath = (hostPath: string): string | null => (
    hostPath.startsWith('/') ? `/mnt/wsl${hostPath}` : null
  );
  return {
    target,
    command: 'wsl.exe',
    args: ['--cd', '/mnt/wsl/vault', 'codex', 'app-server', '--listen', 'stdio://'],
    spawnCwd: '/vault',
    targetCwd: '/mnt/wsl/vault',
    env: {},
    pathMapper: {
      target,
      toTargetPath,
      toHostPath: targetPath => targetPath,
      mapTargetPathList: hostPaths => hostPaths.map(toTargetPath).filter((p): p is string => !!p),
      canRepresentHostPath: hostPath => toTargetPath(hostPath) !== null,
    },
  };
}

function recordingScratch(): CodexAttachmentScratch & { created: string[]; removed: string[] } {
  const created: string[] = [];
  const removed: string[] = [];
  let counter = 0;
  return {
    created,
    removed,
    createDirectory: () => {
      counter += 1;
      const directory = `/scratch/${counter}`;
      created.push(directory);
      return directory;
    },
    writeFile: () => undefined,
    removeDirectory: hostPath => {
      removed.push(hostPath);
    },
  };
}
