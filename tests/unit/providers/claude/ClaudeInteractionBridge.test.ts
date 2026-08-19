import type { PermissionMode } from '@/core/types/settings';
import type { ClaudeToolPermissionOptions } from '@/providers/claude/execution/ClaudeExecutionBackend';
import { ClaudeInteractionBridge } from '@/providers/claude/execution/ClaudeInteractionBridge';

/**
 * Claude's permission requests, as interactions the kernel can carry.
 *
 * The legacy handler answered three different questions through one callback —
 * a plan decision, a question with structured answers, and an approval — and
 * two things that are not questions at all: a tool outside the query's
 * allow-list, and a read-only MCP tool the vault trusts. Everything below is
 * that behaviour, kept, in the shape the kernel dispatches.
 */
describe('Claude interaction bridge', () => {
  function createBridge(mode: PermissionMode = 'normal'): {
    bridge: ClaudeInteractionBridge;
    synced: Array<{ mode: PermissionMode; sdkMode: string }>;
  } {
    const synced: Array<{ mode: PermissionMode; sdkMode: string }> = [];
    const bridge = new ClaudeInteractionBridge({
      permissionMode: () => mode,
      resolveSdkPermissionMode: permissionMode => (
        permissionMode === 'full_access' ? 'bypassPermissions' : 'default'
      ),
      syncPermissionMode: (permissionMode, sdkMode) => {
        synced.push({ mode: permissionMode, sdkMode });
      },
    });
    return { bridge, synced };
  }

  function permissionOptions(
    overrides: Partial<ClaudeToolPermissionOptions> = {},
  ): ClaudeToolPermissionOptions {
    return {
      signal: new AbortController().signal,
      requestId: 'request-1',
      toolUseId: 'tool-use-1',
      ...overrides,
    };
  }

  async function prepare(
    bridge: ClaudeInteractionBridge,
    toolName: string,
    toolInput: Record<string, unknown> = {},
    extra: { allowedTools?: readonly string[]; options?: ClaudeToolPermissionOptions } = {},
  ) {
    return bridge.prepare({
      toolName,
      toolInput,
      options: extra.options ?? permissionOptions(),
      ...(extra.allowedTools ? { allowedTools: extra.allowedTools } : {}),
    });
  }

  it('asks about a tool, and carries what the surface has to render', async () => {
    const { bridge } = createBridge();

    const prepared = await prepare(bridge, 'Bash', { command: 'rm -rf build' }, {
      options: permissionOptions({ decisionReason: 'Destructive command', blockedPath: 'build' }),
    });

    expect(prepared.kind).toBe('approval');
    if (prepared.kind === 'resolved') {
      throw new Error('An approval must be asked, not resolved.');
    }
    expect(prepared.responseIds).toEqual(['allow-once', 'allow-always', 'deny']);
    const presentation = bridge.presentation(prepared.presentationRef);
    expect(presentation).toMatchObject({
      kind: 'approval',
      toolName: 'Bash',
      description: 'Run command: rm -rf build',
      decisionReason: 'Destructive command',
      blockedPath: 'build',
    });
  });

  it('turns each answer into the permission the SDK acts on', async () => {
    const { bridge } = createBridge();

    const once = await prepare(bridge, 'Read', { file_path: 'note.md' });
    const always = await prepare(bridge, 'Read', { file_path: 'note.md' });
    const denied = await prepare(bridge, 'Read', { file_path: 'note.md' });
    if (once.kind === 'resolved' || always.kind === 'resolved' || denied.kind === 'resolved') {
      throw new Error('An approval must be asked, not resolved.');
    }

    await expect(once.resolve('allow-once')).resolves.toMatchObject({ behavior: 'allow' });
    // A rule that outlives the session is what "always" means, and it is the
    // difference the destination carries.
    const alwaysResult = await always.resolve('allow-always');
    expect(alwaysResult).toMatchObject({ behavior: 'allow' });
    expect((alwaysResult as { updatedPermissions?: Array<{ destination?: string }> })
      .updatedPermissions?.some(update => update.destination === 'projectSettings')).toBe(true);
    // Denied, not interrupted: the model is told no and the turn goes on.
    await expect(denied.resolve('deny')).resolves.toMatchObject({
      behavior: 'deny',
      interrupt: false,
    });
  });

  it('denies an answer it never offered', async () => {
    // An id this interaction never offered is a defect upstream, and denying is
    // both what the legacy runtime answered and the safe way to be wrong.
    const { bridge } = createBridge();
    const prepared = await prepare(bridge, 'Write', { file_path: 'note.md' });
    if (prepared.kind === 'resolved') {
      throw new Error('An approval must be asked, not resolved.');
    }

    await expect(prepared.resolve('allow-forever')).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('ends a cancelled prompt as an interruption', async () => {
    const { bridge } = createBridge();
    const prepared = await prepare(bridge, 'Bash', { command: 'sleep 60' });
    if (prepared.kind === 'resolved') {
      throw new Error('An approval must be asked, not resolved.');
    }
    const settled: string[] = [];
    bridge.onSettled(ref => settled.push(ref));

    await expect(prepared.cancel()).resolves.toMatchObject({
      behavior: 'deny',
      interrupt: true,
    });

    // The surface cannot see a run cancelled out from under its prompt; without
    // this the prompt stays on screen with the composer locked behind it.
    expect(settled).toEqual([prepared.presentationRef]);
    expect(bridge.presentation(prepared.presentationRef)).toBeUndefined();
  });

  it('answers a question with what the surface collected', async () => {
    const { bridge } = createBridge();

    const prepared = await prepare(bridge, 'AskUserQuestion', {
      questions: [{ question: 'Which one?', options: ['a', 'b'] }],
    });
    if (prepared.kind === 'resolved') {
      throw new Error('A question must be asked, not resolved.');
    }
    bridge.submitAnswers(prepared.presentationRef, { kind: 'answers', answers: { 'Which one?': 'a' } });
    const result = await prepared.resolve('answered');

    expect(prepared.kind).toBe('question');
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Which one?': 'a' } },
    });
    // The SDK documents "Other will be provided automatically" and does not
    // inject it; Grimoire renders this prompt itself, so it has to.
    const presented = bridge.presentation(prepared.presentationRef);
    expect(presented).toBeUndefined();
  });

  it('offers the other option the SDK documents but never injects', async () => {
    const { bridge } = createBridge();

    const prepared = await prepare(bridge, 'AskUserQuestion', {
      questions: [{ question: 'Which one?', options: ['a', 'b'] }],
    });
    if (prepared.kind === 'resolved') {
      throw new Error('A question must be asked, not resolved.');
    }

    expect(bridge.presentation(prepared.presentationRef)).toMatchObject({
      kind: 'question',
      input: { questions: [{ isOther: true }] },
    });
  });

  it('declines a question nobody answered', async () => {
    const { bridge } = createBridge();
    const prepared = await prepare(bridge, 'AskUserQuestion', { questions: [] });
    if (prepared.kind === 'resolved') {
      throw new Error('A question must be asked, not resolved.');
    }

    // No answers were submitted, so `answered` is not answerable: the safe
    // reading is that nobody answered.
    await expect(prepared.resolve('answered')).resolves.toMatchObject({
      behavior: 'deny',
      interrupt: true,
    });
    expect(prepared.providerResolvedResponseId).toBe('declined');
  });

  it('leaves planning in the mode the session was given when a plan is approved', async () => {
    const { bridge, synced } = createBridge('full_access');
    const prepared = await prepare(bridge, 'ExitPlanMode', { plan: 'Do the thing' });
    if (prepared.kind === 'resolved') {
      throw new Error('A plan decision must be asked, not resolved.');
    }

    const result = await prepared.resolve('approved');

    expect(prepared.kind).toBe('plan-decision');
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedPermissions: [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }],
    });
    // The toolbar would otherwise still show the mode the turn started in.
    expect(synced).toEqual([{ mode: 'full_access', sdkMode: 'bypassPermissions' }]);
  });

  it('sends a refused plan back as feedback rather than an interruption', async () => {
    const { bridge } = createBridge();
    const prepared = await prepare(bridge, 'ExitPlanMode', { plan: 'Do the thing' });
    if (prepared.kind === 'resolved') {
      throw new Error('A plan decision must be asked, not resolved.');
    }
    bridge.submitAnswers(prepared.presentationRef, { kind: 'feedback', text: 'Do less' });

    // The model is being told what to change, and the turn goes on.
    await expect(prepared.resolve('feedback')).resolves.toEqual({
      behavior: 'deny',
      message: 'Do less',
      interrupt: false,
    });
  });

  it('answers the two requests that are policy rather than questions', async () => {
    // A prompt with one possible answer is not a question. Both of these were
    // answered by the legacy handler without anyone being asked, and a flip
    // that started asking would be a new prompt for unchanged behaviour.
    const { bridge } = createBridge('normal');

    const outside = await prepare(bridge, 'Bash', { command: 'ls' }, {
      allowedTools: ['Read', 'Glob'],
    });
    const trusted = await prepare(bridge, 'mcp__obsidian__obsidian_get_file_contents', {});

    expect(outside).toMatchObject({
      kind: 'resolved',
      result: { behavior: 'deny' },
    });
    expect(outside.kind === 'resolved' && String(outside.result.message))
      .toContain('Allowed tools: Read, Glob.');
    expect(trusted).toMatchObject({ kind: 'resolved', result: { behavior: 'allow' } });
  });

  it('still asks about a trusted read-only tool outside normal mode', async () => {
    // The auto-allow is a property of the mode the user chose, not of the tool.
    const { bridge } = createBridge('plan');

    const prepared = await prepare(bridge, 'mcp__obsidian__obsidian_get_file_contents', {});

    expect(prepared.kind).toBe('approval');
  });

  it('lets a skill through an allow-list that does not name it', async () => {
    // The exception the legacy handler carried: a skill is how a query reaches
    // the tools it was allowed, so refusing it refuses the whole query.
    const { bridge } = createBridge();

    const prepared = await prepare(bridge, 'Skill', {}, { allowedTools: ['Read'] });

    expect(prepared.kind).toBe('approval');
  });
});
