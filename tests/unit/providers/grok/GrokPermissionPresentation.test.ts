import { buildGrokPermissionPresentation } from '@/providers/grok/execution/GrokPermissionPresentation';

/**
 * The sentence a person reads before allowing something.
 *
 * Grok names a permission by the tool *and* the kind — a distinction OpenCode
 * does not make — and these are the legacy runtime's own tests for it, moved
 * onto the vocabulary when that runtime was deleted. The wording is the
 * behaviour: an approval nobody can read is an approval nobody can judge.
 */
describe('Grok permission presentation', () => {
  it('summarizes a workflow approval with the tools it would pre-approve', () => {
    const tools = [
      { name: 'bash', args: JSON.stringify({ title: 'npm test' }) },
      { name: 'edit', args: JSON.stringify({ title: 'src/app.ts' }) },
      { name: 'read', args: '{}' },
      { name: 'glob', args: '{}' },
    ];

    const presentation = buildGrokPermissionPresentation(
      'workflow_tool_approval',
      'other',
      { tools },
      null,
    );

    // Named, counted, and truncated: a session-level approval that lists
    // nothing is a blank cheque, and one that lists everything is unreadable.
    expect(presentation).toEqual(expect.objectContaining({
      toolName: 'Workflow Approval',
      description:
        'Pre-approve workflow tools for this session: bash: npm test, edit: src/app.ts, read +1 more.',
      decisionReason: 'Session-level workflow approval requested',
    }));
  });

  it('reads a verbose execute title as the shell command it is', () => {
    const command = 'python3 .grimoire/generate_data.py 2>&1 | tail -5 && wc -l vault-data.js';

    const presentation = buildGrokPermissionPresentation(
      `Execute \`${command}\``,
      'execute',
      { command },
      null,
    );

    // The title carries the whole command line, and reading it back verbatim
    // put a wall of shell into the prompt. The kind is what says what it is.
    expect(presentation).toEqual(expect.objectContaining({
      toolName: 'bash',
      description: 'Grok Build wants to run a shell command.',
      decisionReason: 'Command execution permission required',
    }));
  });

  it('names a shell command by the kind alone, for a title with no rule', () => {
    // A title the vocabulary has never seen: without the kind this reads back
    // at the user as a tool called "Shell".
    const presentation = buildGrokPermissionPresentation('Shell', 'execute', { command: 'ls' }, null);

    expect(presentation.toolName).toBe('bash');
  });
});
