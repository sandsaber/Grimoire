import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import trace from '@test/fixtures/provider-traces/qwen-execution.json';

import { JsonRpcErrorResponse } from '@/providers/acp';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { QwenAcpDynamicConfigApplier } from '@/providers/qwen/execution/QwenAcpDynamicConfig';
import { QwenAcpFileSystem } from '@/providers/qwen/execution/QwenAcpFileSystem';
import { QwenInteractionBridge } from '@/providers/qwen/execution/QwenInteractionBridge';
import { buildQwenPermissionPresentation } from '@/providers/qwen/execution/QwenPermissionPresentation';
import { QwenProjectionResultSink } from '@/providers/qwen/execution/QwenProjectionResultSink';

describe('Qwen dynamic configuration', () => {
  function createClient(): { client: ManagedAcpClient; calls: string[] } {
    const calls: string[] = [];
    const client = {
      setModel: async ({ modelId }: { modelId: string }) => {
        calls.push(`set-model:${modelId}`);
        return {};
      },
      setMode: async ({ modeId }: { modeId: string }) => {
        calls.push(`set-mode:${modeId}`);
        return {};
      },
      // The third call is a *prompt*, which is what makes this provider's
      // configuration cost a turn.
      prompt: async ({ prompt }: { prompt: Array<{ text?: string }> }) => {
        calls.push(`prompt:${prompt[0]?.text ?? ''}`);
        return { stopReason: 'end_turn' };
      },
    } as unknown as ManagedAcpClient;
    return { client, calls };
  }

  it('sets the model, then the mode, then talks the session into an effort', async () => {
    const { client, calls } = createClient();
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({
        modelId: 'qwen3-coder-plus',
        modeId: 'plan',
        effortLevel: 'high',
      }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(trace.cases.dynamicConfiguration);
  });

  it('translates the toolbar vocabulary rather than forwarding it', async () => {
    const { client, calls } = createClient();
    const applier = new QwenAcpDynamicConfigApplier({
      // What the tab composes a turn with. `full_access` is Grimoire's word,
      // not Qwen's, and sending it is a mode the agent does not have — the
      // call is awaited before the prompt, so the rejection ends the turn.
      resolve: async () => ({ modeId: 'full_access' }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(['set-mode:yolo']);
  });

  it('spends no turn on an effort the session is not being asked to change', async () => {
    // Applying it is a whole `session/prompt` the vendor charges for, so the
    // composition is expected to leave it out when the session is already on it
    // — and an applier that sent one anyway would make that skip meaningless.
    const { client, calls } = createClient();
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ modeId: 'plan' }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(['set-mode:plan']);
  });

  it('asks for the effort last, after the mode it might have failed on', async () => {
    const { client, calls } = createClient();
    const applier = new QwenAcpDynamicConfigApplier(
      { resolve: async () => ({ modeId: 'full_access', effortLevel: 'max' }) },
      () => undefined,
    );
    const refusing = {
      ...client,
      setMode: async () => {
        calls.push('set-mode:refused');
        throw new JsonRpcErrorResponse('session/set_mode', -32603, 'Internal error');
      },
    } as unknown as ManagedAcpClient;

    await applier.apply({
      client: refusing,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    // The mode was refused and the turn survived it — and the effort still went,
    // because a refused mode is not a reason to run at the wrong level.
    expect(calls).toEqual(['set-mode:refused', 'prompt:/effort max']);
  });

  it('runs the turn even when the agent will not take the mode', async () => {
    // Observed, not imagined: `qwen 0.55.1` advertises all four modes in its
    // reply to `session/new` and then answers `session/set_mode` for `yolo`
    // with `-32603 Cannot enable privileged approval modes in an untrusted
    // folder`. The call is awaited before the prompt, so a thrown rejection
    // ended every turn a user ran with Auto-approve on in a folder Qwen has
    // not been told to trust.
    const refused: string[] = [];
    const client = {
      setModel: async () => ({}),
      setMode: async () => {
        throw new JsonRpcErrorResponse(
          'session/set_mode',
          -32603,
          'Internal error',
          { details: 'Cannot enable privileged approval modes in an untrusted folder.' },
        );
      },
    } as unknown as ManagedAcpClient;
    const applier = new QwenAcpDynamicConfigApplier(
      { resolve: async () => ({ modeId: 'full_access' }) },
      ({ modeId }) => refused.push(modeId),
    );

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    })).resolves.toBeUndefined();

    // Recorded, because the session is then in a mode the toolbar does not
    // show — stricter than promised, which is the safe way to be wrong, and
    // still wrong.
    expect(refused).toEqual(['yolo']);
  });

  it('still stops when the run the mode belonged to was abandoned', async () => {
    // The one rejection that is not the agent declining a mode: a cancelled
    // turn must not be swallowed into a prompt nobody is waiting for.
    const abort = new AbortController();
    const client = {
      setMode: async () => {
        abort.abort(new Error('cancelled'));
        throw new Error('cancelled');
      },
    } as unknown as ManagedAcpClient;
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ modeId: 'plan' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('cancelled');
  });

  it('performs no provider call without an opaque config reference', async () => {
    const resolve = jest.fn();
    const applier = new QwenAcpDynamicConfigApplier({ resolve });

    await applier.apply({
      client: {} as ManagedAcpClient,
      sessionId: 'native-session',
      signal: new AbortController().signal,
    });

    expect(resolve).not.toHaveBeenCalled();
  });

  it('stops before the mode when the owning run is aborted', async () => {
    const abort = new AbortController();
    const calls: string[] = [];
    const client = {
      setModel: async ({ modelId }: { modelId: string }) => {
        calls.push(`set-model:${modelId}`);
        abort.abort(new Error('settings transition'));
        return {};
      },
      setMode: async () => {
        calls.push('set-mode');
        return {};
      },
    } as unknown as ManagedAcpClient;
    const applier = new QwenAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'qwen-2.5-pro', modeId: 'plan' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(calls).toEqual(['set-model:qwen-2.5-pro']);
  });
});

describe('Qwen permission presentation', () => {
  it('names the tool the title carries, and the path when there is one', () => {
    expect(buildQwenPermissionPresentation('WriteFile', 'edit', { path: 'notes/today.md' }, undefined))
      .toEqual({
        blockedPath: 'notes/today.md',
        description: 'WriteFile requests access to notes/today.md.',
        toolName: 'WriteFile',
      });
    expect(buildQwenPermissionPresentation('Shell', 'execute', {}, undefined))
      .toEqual({ description: 'Shell requests permission.', toolName: 'Shell' });
  });

  it('falls back to the kind, then to a name, rather than asking about nothing', () => {
    // A prompt that says only "requests permission" with no subject is one a
    // person cannot answer.
    expect(buildQwenPermissionPresentation('   ', 'read_file', {}, undefined).toolName)
      .toBe('read_file');
    expect(buildQwenPermissionPresentation(null, null, {}, undefined).toolName)
      .toBe('Qwen Code action');
  });

  it('takes the path in the order the legacy runtime looked', () => {
    expect(buildQwenPermissionPresentation('Read', 'read', {
      path: 'first.md',
      filePath: 'second.md',
    }, [{ path: 'location.md' }]).blockedPath).toBe('first.md');
    expect(buildQwenPermissionPresentation('Read', 'read', {}, [{ path: 'location.md' }])
      .blockedPath).toBe('location.md');
  });
});

describe('Qwen interactions', () => {
  function permissionRequest(): AcpRequestPermissionRequest {
    return {
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'no', kind: 'reject_once', name: 'Deny' },
      ],
      toolCall: {
        toolCallId: 'tool-1',
        title: 'WriteFile',
        kind: 'edit',
        rawInput: { path: 'notes/today.md' },
      },
    };
  }

  it('describes the permission in the words the tool gave', async () => {
    const bridge = new QwenInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest());

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      kind: 'approval',
      toolName: 'WriteFile',
      description: 'WriteFile requests access to notes/today.md.',
      blockedPath: 'notes/today.md',
    }));
  });

  it('answers the agent with the option its response id stands for', async () => {
    const bridge = new QwenInteractionBridge();
    const prepared = await bridge.prepare(permissionRequest());

    await expect(prepared.resolve('allow-once')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
  });
});

describe('QwenProjectionResultSink', () => {
  const commit = (overrides: Record<string, unknown> = {}) =>
    new QwenProjectionResultSink().storeResult({
      output: 'the answer',
      nativeSessionRef: 'qwen-session',
      nativeRunRef: 'message-1',
      signal: new AbortController().signal,
      ...overrides,
    });

  it('commits a reference and never the answer', async () => {
    const outcome = await commit();

    expect(outcome.kind).toBe('committed');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('the answer');
    expect(serialized).not.toContain('qwen-session');
  });

  it('commits nothing for a run that was already abandoned', async () => {
    const abort = new AbortController();
    abort.abort(new Error('stopped'));

    await expect(commit({ signal: abort.signal })).resolves.toEqual({ kind: 'aborted' });
  });
});

describe('QwenAcpFileSystem', () => {
  it('refuses a write in Qwen own name when the person said no', async () => {
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-qwen-fs-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const fileSystem = new QwenAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite: async () => false,
    });
    try {
      // The refusal reaches the agent as text, and it is the one place this
      // provider's own label has to be in it.
      await expect(fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: 'notes/result.md',
        content: 'unapproved',
      })).rejects.toThrow('Qwen file write was not approved.');
      await expect(readFile(join(root, 'notes', 'result.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(enclosing, { recursive: true, force: true });
    }
  });

  it('contains a read to the session workspace', async () => {
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-qwen-contained-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const approveWrite = jest.fn(async () => true);
    const fileSystem = new QwenAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite,
    });
    try {
      await expect(fileSystem.readTextFile({
        sessionId: 'session-1',
        path: join(enclosing, 'outside-secret.md'),
      })).rejects.toThrow('limited to the current workspace');
      expect(approveWrite).not.toHaveBeenCalled();
    } finally {
      await rm(enclosing, { recursive: true, force: true });
    }
  });
});
