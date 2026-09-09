import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import trace from '@test/fixtures/provider-traces/devin-execution.json';

import { JsonRpcErrorResponse } from '@/providers/acp';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';
import { DevinAcpDynamicConfigApplier } from '@/providers/devin/execution/DevinAcpDynamicConfig';
import { DevinAcpFileSystem } from '@/providers/devin/execution/DevinAcpFileSystem';
import { DevinInteractionBridge } from '@/providers/devin/execution/DevinInteractionBridge';
import { buildDevinPermissionPresentation } from '@/providers/devin/execution/DevinPermissionPresentation';
import { DevinProjectionResultSink } from '@/providers/devin/execution/DevinProjectionResultSink';

describe('Devin dynamic configuration', () => {
  function createClient(): { client: ManagedAcpClient; calls: string[] } {
    const calls: string[] = [];
    const client = {
      setConfigOption: async ({ configId, value }: { configId: string; value: string }) => {
        calls.push(`set-config:${configId}:${value}`);
        return { configOptions: [] };
      },
      // Probed 2026-09-09: `devin acp` answers `session/set_model` with
      // `-32601 Method not found`. A fake that accepted it would hide the one
      // call this provider must never make.
      setModel: async () => {
        throw new JsonRpcErrorResponse('session/set_model', -32601, 'Method not found');
      },
      setMode: async ({ modeId }: { modeId: string }) => {
        calls.push(`set-mode:${modeId}`);
        return {};
      },
    } as unknown as ManagedAcpClient;
    return { client, calls };
  }

  it('sets the model, then the mode, both as config options', async () => {
    const { client, calls } = createClient();
    const applier = new DevinAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'swe-1-6-slow', modeId: 'plan' }),
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
    const applier = new DevinAcpDynamicConfigApplier({
      // `full_access` is Grimoire's word, not Devin's.
      resolve: async () => ({ modeId: 'full_access' }),
    });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(['set-config:mode:bypass']);
  });

  it('runs the turn even when the agent will not take the mode', async () => {
    const refused: string[] = [];
    const client = {
      setConfigOption: async ({ configId }: { configId: string }) => {
        if (configId === 'mode') {
          throw new JsonRpcErrorResponse(
            'session/set_config_option',
            -32602,
            'Invalid params',
            { details: 'Mode bypass is not available for this account.' },
          );
        }
        return { configOptions: [] };
      },
    } as unknown as ManagedAcpClient;
    const presented: unknown[] = [];
    const applier = new DevinAcpDynamicConfigApplier(
      { resolve: async () => ({ modeId: 'full_access' }) },
      ({ modeId }) => refused.push(modeId),
    );

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
      presentContent: payload => presented.push(payload),
    })).resolves.toBeUndefined();

    expect(refused).toEqual(['bypass']);
    expect(presented).toEqual([{
      kind: 'mode-refused',
      modeId: 'bypass',
      detail: 'Mode bypass is not available for this account.',
    }]);
  });

  it('reads the reason out of the shape a missing model answers with', async () => {
    // Recorded: `-32002 Resource not found` with the sentence under `data.uri`.
    const presented: unknown[] = [];
    const client = {
      setConfigOption: async () => {
        throw new JsonRpcErrorResponse(
          'session/set_config_option',
          -32002,
          'Resource not found',
          { uri: 'Mode not found: bypass. Available modes: accept-edits' },
        );
      },
    } as unknown as ManagedAcpClient;
    const applier = new DevinAcpDynamicConfigApplier({ resolve: async () => ({ modeId: 'full_access' }) });

    await applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: new AbortController().signal,
      presentContent: payload => presented.push(payload),
    });

    expect(presented).toEqual([expect.objectContaining({
      detail: 'Mode not found: bypass. Available modes: accept-edits',
    })]);
  });

  it('still stops when the run the mode belonged to was abandoned', async () => {
    const abort = new AbortController();
    const client = {
      setConfigOption: async () => {
        abort.abort(new Error('cancelled'));
        throw new Error('cancelled');
      },
    } as unknown as ManagedAcpClient;
    const applier = new DevinAcpDynamicConfigApplier({
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
    const applier = new DevinAcpDynamicConfigApplier({ resolve });

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
      setConfigOption: async ({ configId, value }: { configId: string; value: string }) => {
        calls.push(`set-config:${configId}:${value}`);
        abort.abort(new Error('settings transition'));
        return { configOptions: [] };
      },
    } as unknown as ManagedAcpClient;
    const applier = new DevinAcpDynamicConfigApplier({
      resolve: async () => ({ modelId: 'swe-1-6-slow', modeId: 'plan' }),
    });

    await expect(applier.apply({
      client,
      sessionId: 'native-session',
      dynamicRef: 'opaque-config',
      signal: abort.signal,
    })).rejects.toThrow('settings transition');
    expect(calls).toEqual(['set-config:model:swe-1-6-slow']);
  });
});

describe('Devin permission presentation', () => {
  it('names the command line the request carries in its meta', () => {
    // The recorded shape: no title, no kind, no input — only the command.
    expect(buildDevinPermissionPresentation(undefined, undefined, {}, undefined, {
      'cognition.ai/editableCommand': 'rm out.txt',
    })).toEqual({
      description: 'Devin wants to run `rm out.txt`.',
      toolName: 'Shell command',
    });
  });

  it('reads the plan exit and the edit out of the tool call that preceded the request', () => {
    // Observed in Plan mode: the request carries the id alone, and the
    // `tool_call` update before it said `switch_mode` / `Exit plan mode`.
    expect(buildDevinPermissionPresentation(undefined, undefined, {}, undefined, undefined, {
      toolCallId: 'call_7e672f0d22d945a5b832c919',
      title: 'Exit plan mode',
      kind: 'switch_mode',
      rawInput: { plan: 'Create a single file.' },
      meta: { 'cognition.ai/isExitPlan': true },
    })).toEqual({
      description: 'Devin wants to leave Plan mode and start implementing the plan.',
      toolName: 'Exit plan mode',
    });
    expect(buildDevinPermissionPresentation(undefined, undefined, {}, undefined, undefined, {
      toolCallId: 'call_02691547eb984af7a97065e5',
      title: 'Wrote /vault/plan.md',
      kind: 'edit',
      diffPath: '/vault/plan.md',
    })).toEqual({
      blockedPath: '/vault/plan.md',
      description: 'Devin wants to write /vault/plan.md.',
      toolName: 'Wrote /vault/plan.md',
    });
  });

  it('names the tool the title carries, and the path when there is one', () => {
    expect(buildDevinPermissionPresentation('Write file', 'edit', { file_path: 'notes/today.md' }, undefined))
      .toEqual({
        blockedPath: 'notes/today.md',
        description: 'Devin wants to write notes/today.md.',
        toolName: 'Write file',
      });
    expect(buildDevinPermissionPresentation('Read file', 'read', { file_path: 'notes/today.md' }, undefined))
      .toEqual({
        blockedPath: 'notes/today.md',
        description: 'Read file requests access to notes/today.md.',
        toolName: 'Read file',
      });
  });

  it('falls back to the kind, then to a name, rather than asking about nothing', () => {
    expect(buildDevinPermissionPresentation('   ', 'read', {}, undefined).toolName).toBe('read');
    expect(buildDevinPermissionPresentation(null, null, {}, undefined))
      .toEqual({ description: 'Devin action requests permission.', toolName: 'Devin action' });
  });

  it('takes the path from the input before the tool call locations', () => {
    expect(buildDevinPermissionPresentation('Read', 'read', {
      path: 'first.md',
      filePath: 'second.md',
    }, [{ path: 'location.md' }]).blockedPath).toBe('first.md');
    expect(buildDevinPermissionPresentation('Read', 'read', {}, [{ path: 'location.md' }])
      .blockedPath).toBe('location.md');
  });
});

describe('Devin interactions', () => {
  /** The recorded `session/request_permission`, options and all. */
  function permissionRequest(): AcpRequestPermissionRequest {
    return {
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'allow_session', kind: 'allow_always', name: 'Yes, allow `rm` commands (this session)' },
        { optionId: 'allow_always', kind: 'allow_always', name: 'Yes, always allow `rm` commands in `vault`' },
        { optionId: 'allow_always_global', kind: 'allow_always', name: 'Yes, always allow `rm` commands in all projects' },
        { optionId: 'switch_bypass', kind: 'allow_always', name: 'Yes, switch to bypass mode' },
        { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' },
      ],
      toolCall: {
        toolCallId: 'call_2044a883d1ef429087276f94',
        _meta: { 'cognition.ai/editableCommand': 'rm out.txt' },
      },
    };
  }

  it('describes the permission by the command it is about', async () => {
    const bridge = new DevinInteractionBridge();

    const prepared = await bridge.prepare(permissionRequest());

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      kind: 'approval',
      toolName: 'Shell command',
      description: 'Devin wants to run `rm out.txt`.',
      options: [
        { responseId: 'allow-once', label: 'Allow', presentation: 'allow' },
        { responseId: 'allow-always', label: 'Yes, allow `rm` commands (this session)', presentation: 'always' },
        { responseId: 'allow-always-2', label: 'Yes, always allow `rm` commands in `vault`', presentation: 'always' },
        { responseId: 'allow-always-3', label: 'Yes, always allow `rm` commands in all projects', presentation: 'always' },
        { responseId: 'allow-always-4', label: 'Yes, switch to bypass mode', presentation: 'always' },
        { responseId: 'reject-once', label: 'Reject', presentation: 'reject' },
      ],
    }));
  });

  it('describes a bare request by the tool call the composition remembered', async () => {
    const bridge = new DevinInteractionBridge(undefined, toolCallId => (
      toolCallId === 'call_exit'
        ? { toolCallId, title: 'Exit plan mode', kind: 'switch_mode' }
        : undefined
    ));

    const prepared = await bridge.prepare({
      sessionId: 'acp-session-1',
      options: [
        { optionId: 'plan_accept_edits', kind: 'allow_once', name: 'Yes, implement plan and accept edits' },
        { optionId: 'plan_bypass', kind: 'allow_once', name: 'Yes, implement plan and bypass permissions' },
        { optionId: 'reject_once', kind: 'reject_once', name: 'No, plan needs changes' },
      ],
      toolCall: { toolCallId: 'call_exit' },
    });

    expect(bridge.presentation(prepared.presentationRef)).toEqual(expect.objectContaining({
      toolName: 'Exit plan mode',
      description: 'Devin wants to leave Plan mode and start implementing the plan.',
    }));
    // `allow` lands on the first `allow_once`, which is the plan-and-edits one.
    await expect(prepared.resolve('allow-once')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'plan_accept_edits' },
    });
  });

  it('answers the agent with the option its response id stands for', async () => {
    const bridge = new DevinInteractionBridge();
    const prepared = await bridge.prepare(permissionRequest());

    await expect(prepared.resolve('allow-once')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
  });
});

describe('DevinProjectionResultSink', () => {
  const commit = (overrides: Record<string, unknown> = {}) =>
    new DevinProjectionResultSink().storeResult({
      output: 'the answer',
      nativeSessionRef: 'devin-session',
      nativeRunRef: 'message-1',
      signal: new AbortController().signal,
      ...overrides,
    });

  it('commits a reference and never the answer', async () => {
    const outcome = await commit();

    expect(outcome.kind).toBe('committed');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('the answer');
    expect(serialized).not.toContain('devin-session');
  });

  it('commits nothing for a run that was already abandoned', async () => {
    const abort = new AbortController();
    abort.abort(new Error('stopped'));

    await expect(commit({ signal: abort.signal })).resolves.toEqual({ kind: 'aborted' });
  });
});

describe('DevinAcpFileSystem', () => {
  it('refuses a write in Devin own name when the person said no', async () => {
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-devin-fs-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const fileSystem = new DevinAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite: async () => false,
    });
    try {
      await expect(fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: 'notes/result.md',
        content: 'unapproved',
      })).rejects.toThrow('Devin file write was not approved.');
      await expect(readFile(join(root, 'notes', 'result.md'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(enclosing, { recursive: true, force: true });
    }
  });

  it('lets Devin keep its own plans outside the workspace, unasked', async () => {
    // Observed in Plan mode: the plan goes to `~/.devin/plans/<id>.md` through
    // `fs/write_text_file`. Contained, it was refused and the agent had no plan
    // to exit into.
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-devin-plans-'));
    const root = join(enclosing, 'workspace');
    const plans = join(enclosing, 'home', '.devin', 'plans');
    await mkdir(root, { recursive: true });
    const approveWrite = jest.fn(async () => false);
    const fileSystem = new DevinAcpFileSystem({
      resolveSession: () => ({ cwd: root, allowOutsideWorkspace: false }),
      approveWrite,
      plansDirectory: plans,
    });
    try {
      await fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: join(plans, 'plan-1.md'),
        content: '# plan',
      });
      await expect(fileSystem.readTextFile({ sessionId: 'session-1', path: join(plans, 'plan-1.md') }))
        .resolves.toEqual({ content: '# plan' });
      expect(approveWrite).not.toHaveBeenCalled();
      // The door is the directory, not its parent: a sibling is still outside.
      await expect(fileSystem.writeTextFile({
        sessionId: 'session-1',
        path: join(enclosing, 'home', '.devin', 'credentials.toml'),
        content: 'x',
      })).rejects.toThrow();
    } finally {
      await rm(enclosing, { recursive: true, force: true });
    }
  });

  it('contains a read to the session workspace', async () => {
    const enclosing = await mkdtemp(join(tmpdir(), 'grimoire-devin-contained-'));
    const root = join(enclosing, 'workspace');
    await mkdir(root, { recursive: true });
    const approveWrite = jest.fn(async () => true);
    const fileSystem = new DevinAcpFileSystem({
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
