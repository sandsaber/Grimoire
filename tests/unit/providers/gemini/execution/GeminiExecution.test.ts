import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import trace from '@test/fixtures/provider-traces/gemini-execution.json';
import wire from '@test/fixtures/provider-traces/wire/gemini-wire.json';

import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { GeminiAcpDynamicConfigApplier } from '@/providers/gemini/execution/GeminiAcpDynamicConfig';
import { GeminiAcpFileSystem } from '@/providers/gemini/execution/GeminiAcpFileSystem';
import { GeminiInteractionBridge } from '@/providers/gemini/execution/GeminiInteractionBridge';
import { buildGeminiPermissionPresentation } from '@/providers/gemini/execution/GeminiPermissionPresentation';
import { GeminiProjectionResultSink } from '@/providers/gemini/execution/GeminiProjectionResultSink';

describe('Gemini dynamic configuration', () => {
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
    } as unknown as ManagedAcpClient;
    return { client, calls };
  }

  it('sets the model, then a mode the agent actually has', async () => {
    const { client, calls } = createClient();
    const applier = new GeminiAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'gemini-2.5-pro', modeId: 'plan' }),
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
    const applier = new GeminiAcpDynamicConfigApplier({
      // What the tab composes a turn with. `full_access` is Grimoire's word,
      // not Gemini's, and sending it is a mode the agent does not have — the
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

  it('sets nothing through a config option, because the session offers none', () => {
    // Not an assumption: `session/new` in the recording answers with `models`
    // and `modes` and no `configOptions` at all, which is why this provider's
    // applier has no third call and no thought-level branch.
    const answered = wire.exchange
      .map(entry => (entry.message as { result?: Record<string, unknown> }).result)
      .find(result => result !== undefined && 'sessionId' in result);
    expect(answered).toBeDefined();
    expect(Object.keys(answered ?? {})).toEqual(['sessionId', 'modes', 'models']);
  });

  it('performs no provider call without an opaque config reference', async () => {
    const resolve = jest.fn();
    const applier = new GeminiAcpDynamicConfigApplier({ resolve });

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
    const applier = new GeminiAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'gemini-2.5-pro', modeId: 'plan' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(calls).toEqual(['set-model:gemini-2.5-pro']);
  });
});

describe('Gemini permission presentation', () => {
  it('names the tool the title carries, and the path when there is one', () => {
    expect(buildGeminiPermissionPresentation('WriteFile', 'edit', { path: 'notes/today.md' }, undefined))
      .toEqual({
        blockedPath: 'notes/today.md',
        description: 'WriteFile requests access to notes/today.md.',
        toolName: 'WriteFile',
      });
    expect(buildGeminiPermissionPresentation('Shell', 'execute', {}, undefined))
      .toEqual({ description: 'Shell requests permission.', toolName: 'Shell' });
  });

  it('falls back to the kind, then to a name, rather than asking about nothing', () => {
    // A prompt that says only "requests permission" with no subject is one a
    // person cannot answer.
    expect(buildGeminiPermissionPresentation('   ', 'read_file', {}, undefined).toolName)
      .toBe('read_file');
    expect(buildGeminiPermissionPresentation(null, null, {}, undefined).toolName)
      .toBe('Gemini action');
  });

  it('takes the path in the order the legacy runtime looked', () => {
    expect(buildGeminiPermissionPresentation('Read', 'read', {
      path: 'first.md',
      filePath: 'second.md',
    }, [{ path: 'location.md' }]).blockedPath).toBe('first.md');
    expect(buildGeminiPermissionPresentation('Read', 'read', {}, [{ path: 'location.md' }])
      .blockedPath).toBe('location.md');
  });
});

describe('Gemini interactions', () => {
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
    const bridge = new GeminiInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest());

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      kind: 'approval',
      toolName: 'WriteFile',
      description: 'WriteFile requests access to notes/today.md.',
      blockedPath: 'notes/today.md',
    }));
  });

  it('answers the agent with the option its response id stands for', async () => {
    const bridge = new GeminiInteractionBridge();
    const prepared = await bridge.prepare(permissionRequest());

    await expect(prepared.resolve('allow-once')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    });
  });
});

describe('GeminiProjectionResultSink', () => {
  const commit = (overrides: Record<string, unknown> = {}) =>
    new GeminiProjectionResultSink().storeResult({
      output: 'the answer',
      nativeSessionRef: 'gemini-session',
      nativeRunRef: 'message-1',
      signal: new AbortController().signal,
      ...overrides,
    });

  it('commits a reference and never the answer', async () => {
    const outcome = await commit();

    expect(outcome.kind).toBe('committed');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('the answer');
    expect(serialized).not.toContain('gemini-session');
  });

  it('commits nothing for a run that was already abandoned', async () => {
    const abort = new AbortController();
    abort.abort(new Error('stopped'));

    await expect(commit({ signal: abort.signal })).resolves.toEqual({ kind: 'aborted' });
  });
});

describe('GeminiAcpFileSystem', () => {
  it('refuses a write in Gemini own name when the person said no', async () => {
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-gemini-fs-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const fileSystem = new GeminiAcpFileSystem({
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
      })).rejects.toThrow('Gemini file write was not approved.');
      await expect(readFile(join(root, 'notes', 'result.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(enclosing, { recursive: true, force: true });
    }
  });

  it('contains a read to the session workspace', async () => {
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-gemini-contained-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const approveWrite = jest.fn(async () => true);
    const fileSystem = new GeminiAcpFileSystem({
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
