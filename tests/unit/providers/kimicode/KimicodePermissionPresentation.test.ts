import { normalizeApprovalInput } from '@/providers/acp/execution/AcpPermissionBridge';
import {
  buildKimicodePermissionPresentation,
} from '@/providers/kimicode/execution/KimicodePermissionPresentation';

/**
 * The words a Kimi Code approval prompt uses, pinned where they now live.
 *
 * They were moved out of `KimicodeChatRuntime`, not rewritten, and a move is
 * only safe if what came out the other side is the same text. So this asserts
 * the sentences rather than that a sentence exists: a reworded prompt is a
 * change to the product, and it should have to be typed here to happen.
 */
describe('Kimi Code permission presentation', () => {
  it.each([
    ['codesearch', 'Kimi Code wants to search indexed code outside the active buffer.', 'codesearch'],
    ['glob', 'Kimi Code wants to scan file paths with a glob pattern.', 'glob'],
    ['grep', 'Kimi Code wants to search file contents with a pattern.', 'grep'],
    ['lsp', 'Kimi Code wants to query language server data.', 'lsp'],
    ['plan_enter', 'Kimi Code wants to switch this session into planning mode.', 'Enter Plan Mode'],
    ['plan_exit', 'Kimi Code wants to leave planning mode and resume implementation.', 'Exit Plan Mode'],
    ['question', 'Kimi Code wants to ask you a direct question before continuing.', 'Ask Question'],
    ['skill', 'Kimi Code wants to load a skill into the current session.', 'skill'],
    ['todowrite', 'Kimi Code wants to update the shared task list.', 'todowrite'],
    ['webfetch', 'Kimi Code wants to fetch content from a URL.', 'webfetch'],
    ['websearch', 'Kimi Code wants to search the web.', 'websearch'],
  ])('describes %s the way the legacy runtime did', (permissionId, description, toolName) => {
    expect(buildKimicodePermissionPresentation(permissionId, {}, undefined))
      .toEqual({ description, toolName });
  });

  it('gives a command, a write and an escape their own reason', () => {
    expect(buildKimicodePermissionPresentation('bash', { command: 'ls' }, undefined))
      .toEqual({
        decisionReason: 'Command execution permission required',
        description: 'Kimi Code wants to run a shell command.',
        toolName: 'bash',
      });
    expect(buildKimicodePermissionPresentation('edit', { filePath: 'notes/today.md' }, undefined))
      .toEqual({
        blockedPath: 'notes/today.md',
        decisionReason: 'File write permission required',
        description: 'Kimi Code wants to modify this file.',
        toolName: 'edit',
      });
    expect(buildKimicodePermissionPresentation('external_directory', {}, [{ path: '/elsewhere' }]))
      .toEqual({
        blockedPath: '/elsewhere',
        decisionReason: 'Path is outside the session working directory',
        description: 'Kimi Code wants to access a path outside the working directory.',
        toolName: 'External Directory',
      });
  });

  it('says which tool is repeating when the loop guard asks', () => {
    expect(buildKimicodePermissionPresentation('doom_loop', { tool: 'grep' }, undefined))
      .toEqual({
        decisionReason: 'Kimi Code detected repeated identical tool calls',
        description: 'Allow another repeated `grep` call.',
        toolName: 'Doom Loop Guard',
      });
    // Nothing to name is not nothing to say: the prompt still has to describe
    // what is being allowed.
    expect(buildKimicodePermissionPresentation('doom_loop', {}, undefined).description)
      .toBe('Allow another repeated tool call.');
  });

  it('summarises a workflow approval, and stops summarising at three', () => {
    const tools = (count: number) => Array.from({ length: count }, (_unused, index) => ({
      name: `tool${index + 1}`,
    }));

    expect(buildKimicodePermissionPresentation('workflow_tool_approval', { tools: tools(2) }, undefined))
      .toEqual({
        decisionReason: 'Session-level workflow approval requested',
        description: 'Pre-approve workflow tools for this session: tool1, tool2.',
        toolName: 'Workflow Approval',
      });
    expect(buildKimicodePermissionPresentation('workflow_tool_approval', { tools: tools(5) }, undefined)
      .description)
      .toBe('Pre-approve workflow tools for this session: tool1, tool2, tool3 +2 more.');
  });

  it('reads a title out of a workflow tool argument string, and survives one that is not JSON', () => {
    const described = buildKimicodePermissionPresentation('workflow_tool_approval', {
      tools: [
        { name: 'write', args: JSON.stringify({ title: 'Draft the summary' }) },
        { name: 'read', args: '{ not json' },
      ],
    }, undefined);
    expect(described.description)
      .toBe('Pre-approve workflow tools for this session: write: Draft the summary, read.');
  });

  it('describes a permission it has never seen rather than refusing to name it', () => {
    // Kimi Code adds tools between releases, and the id arrives off the wire.
    expect(buildKimicodePermissionPresentation('some_new_tool', { path: 'notes/today.md' }, undefined))
      .toEqual({
        blockedPath: 'notes/today.md',
        description: 'Kimi Code wants permission to use Some New Tool on this path.',
        toolName: 'Some New Tool',
      });
    expect(buildKimicodePermissionPresentation(null, {}, undefined))
      .toEqual({ description: 'Kimi Code wants permission to use Tool.', toolName: 'Tool' });
  });

  it('takes the first path the request offers, in the order the runtime looked', () => {
    expect(buildKimicodePermissionPresentation('read', {
      filepath: 'first.md',
      filePath: 'second.md',
      path: 'third.md',
    }, [{ path: 'location.md' }]).blockedPath).toBe('first.md');
    expect(buildKimicodePermissionPresentation('read', { filepath: '   ' }, [{ path: 'location.md' }])
      .blockedPath).toBe('location.md');
  });

  it('hands the bridge an input record whatever the agent sent', () => {
    expect(normalizeApprovalInput({ command: 'ls' })).toEqual({ command: 'ls' });
    expect(normalizeApprovalInput(undefined)).toEqual({});
    expect(normalizeApprovalInput('bare')).toEqual({ value: 'bare' });
  });
});
