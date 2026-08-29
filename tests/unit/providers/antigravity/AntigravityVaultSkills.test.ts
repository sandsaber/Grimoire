import { expandAntigravityVaultSkillInvocation } from '@/providers/antigravity/runtime/AntigravityVaultSkills';

/**
 * What `/skill` means to a provider that has no slash commands.
 *
 * `agy --print` resolves nothing: without this the CLI receives the literal
 * text `/researcher` and the agent is left to guess what was meant (#58).
 */
describe('expandAntigravityVaultSkillInvocation', () => {
  const skills = {
    listVaultEntries: async () => [
      { name: 'researcher', content: 'Read the vault and answer with citations.' },
      { name: 'empty', content: '   ' },
    ],
  };

  it('replaces the invocation with the skill body and the words after it', async () => {
    const expanded = await expandAntigravityVaultSkillInvocation(
      '/researcher what changed this week?',
      skills,
    );

    expect(expanded).toBe([
      'You are executing the vault skill "researcher". Follow its instructions.',
      '',
      'Read the vault and answer with citations.',
      '',
      'User input for this skill:',
      'what changed this week?',
    ].join('\n'));
  });

  it('keeps the context the composer appended, and never searches it', async () => {
    // `<current_note>` and its siblings are appended after the user's words. A
    // skill invocation is only ever the first thing a person typed, so the tail
    // rides along untouched — searching it would let a note's own text look
    // like an invocation.
    const expanded = await expandAntigravityVaultSkillInvocation(
      '/researcher summarize\n\n<current_note path="a.md">/researcher</current_note>',
      skills,
    );

    expect(expanded).toContain('Read the vault and answer with citations.');
    expect(expanded.endsWith('<current_note path="a.md">/researcher</current_note>')).toBe(true);
  });

  it('sends what the person typed when there is nothing to expand it into', async () => {
    // Three ways to have nothing: no such skill, a skill with an empty body,
    // and no vault to ask. None of them is a reason to fail a turn.
    await expect(expandAntigravityVaultSkillInvocation('/unknown hello', skills))
      .resolves.toBe('/unknown hello');
    await expect(expandAntigravityVaultSkillInvocation('/empty hello', skills))
      .resolves.toBe('/empty hello');
    await expect(expandAntigravityVaultSkillInvocation('/researcher hello', null))
      .resolves.toBe('/researcher hello');
    await expect(expandAntigravityVaultSkillInvocation('just a question', skills))
      .resolves.toBe('just a question');
  });

  it('sends what the person typed when the vault cannot be listed', async () => {
    const broken = { listVaultEntries: async () => { throw new Error('vault unreadable'); } };

    await expect(expandAntigravityVaultSkillInvocation('/researcher hello', broken))
      .resolves.toBe('/researcher hello');
  });
});
