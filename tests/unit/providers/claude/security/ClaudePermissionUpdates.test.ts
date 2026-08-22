import {
  buildPermissionUpdates,
  describeApprovalRule,
  resolveApprovalRule,
} from '@/providers/claude/security/ClaudePermissionUpdates';

describe('buildPermissionUpdates', () => {
  it('constructs allow rule for allow decision', () => {
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow');
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'session',
    }]);
  });

  it('uses projectSettings destination for always decisions', () => {
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always');
    expect(updates[0].destination).toBe('projectSettings');
  });

  it('takes a suggestion that asks for exactly what was approved', () => {
    const suggestions = [{
      type: 'addRules' as const,
      behavior: 'allow' as const,
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'session' as const,
    }];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always', suggestions);
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'projectSettings',
    }]);
  });

  it('refuses a suggestion that reaches wider than the action approved', () => {
    // The suggestion is the *agent* proposing its own permissions, and the
    // agent is the party being restrained. `git *` is not what the card said,
    // so approving that card does not grant it.
    const suggestions = [{
      type: 'addRules' as const,
      behavior: 'allow' as const,
      rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
      destination: 'session' as const,
    }];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always', suggestions);
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'projectSettings',
    }]);
  });

  it('refuses a suggested rule with no pattern at all', () => {
    // The worst shape this could take, and the reason the clamp exists: one
    // click on "Always allow" for `git status`, and every command Claude ever
    // runs in this project is pre-approved.
    const suggestions = [{
      type: 'addRules' as const,
      behavior: 'allow' as const,
      rules: [{ toolName: 'Bash' }],
      destination: 'session' as const,
    }];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always', suggestions);
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'projectSettings',
    }]);
  });

  it('refuses a suggested rule for a different tool', () => {
    const suggestions = [{
      type: 'addRules' as const,
      behavior: 'allow' as const,
      rules: [{ toolName: 'Write', ruleContent: 'git status' }],
      destination: 'session' as const,
    }];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow', suggestions);
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'session',
    }]);
  });

  it('falls back to constructed rule when no addRules suggestions', () => {
    const updates = buildPermissionUpdates('Bash', { command: 'ls' }, 'allow', []);
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
      destination: 'session',
    }]);
  });

  it('omits ruleContent when pattern is null (missing file_path)', () => {
    const updates = buildPermissionUpdates('Read', {}, 'allow');
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Read' }],
      destination: 'session',
    }]);
  });

  it('includes addDirectories suggestions without overriding destination', () => {
    const suggestions = [
      {
        type: 'addRules' as const,
        behavior: 'allow' as const,
        rules: [{ toolName: 'Read', ruleContent: '/external/path/*' }],
        destination: 'session' as const,
      },
      {
        type: 'addDirectories' as const,
        directories: ['/external/path'],
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Read', { file_path: '/external/path/file.md' }, 'allow-always', suggestions);
    // The glob reaches past the file that was shown, so the rule written is the
    // one the card described — and the directory goes with it. `addDirectories`
    // grants access to a path the prompt never named, which is the same hazard
    // as the glob and not a smaller one for being a different field.
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Read', ruleContent: '/external/path/file.md' }],
      destination: 'projectSettings',
    }]);
  });

  it('includes removeDirectories suggestions without overriding destination', () => {
    const suggestions = [
      {
        type: 'removeDirectories' as const,
        directories: ['/revoked/path'],
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Bash', { command: 'ls' }, 'allow-always', suggestions);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
      destination: 'projectSettings',
    });
    expect(updates[1]).toEqual({
      type: 'removeDirectories',
      directories: ['/revoked/path'],
      destination: 'session',
    });
  });

  it('includes setMode suggestions without overriding destination', () => {
    const suggestions = [
      {
        type: 'setMode' as const,
        mode: 'default' as const,
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Bash', { command: 'echo hi' }, 'allow-always', suggestions);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'echo hi' }],
      destination: 'projectSettings',
    });
    expect(updates[1]).toEqual({
      type: 'setMode',
      mode: 'default',
      destination: 'session',
    });
  });

  it('prepends constructed addRules when suggestions have no addRules type', () => {
    const suggestions = [
      {
        type: 'addDirectories' as const,
        directories: ['/new/dir'],
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Read', { file_path: '/new/dir/file.md' }, 'allow', suggestions);
    // The grant the person actually clicked, and nothing else: the directory
    // suggestion is dropped rather than carried alongside it.
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('addRules');
  });

  it('never promotes a replaceRules suggestion', () => {
    // Replacing the rule set can take away denials the person put there, and no
    // approval button offers that.
    const suggestions = [
      {
        type: 'replaceRules' as const,
        behavior: 'allow' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always', suggestions);
    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'projectSettings',
    }]);
  });

  it('refuses a mode suggestion that would stop the asking', () => {
    // The same hazard through another door: one approval must not put the
    // session into a mode where nothing is asked again.
    const suggestions = [
      { type: 'setMode' as const, mode: 'bypassPermissions' as const, destination: 'session' as const },
    ];
    const updates = buildPermissionUpdates('Bash', { command: 'ls' }, 'allow', suggestions);

    expect(updates.some(update => update.type === 'setMode')).toBe(false);
  });

  it('prepends addRules when only removeRules suggestion is present', () => {
    const suggestions = [
      {
        type: 'removeRules' as const,
        behavior: 'allow' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'old-pattern' }],
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow', suggestions);
    expect(updates).toHaveLength(1);
    expect(updates[0].type).toBe('addRules');
    expect(updates[0]).toMatchObject({
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'session',
    });
  });

  it('never carries a removeRules suggestion', () => {
    // A `deny` the person wrote, removed by a button that said "allow this
    // one". The same hazard `replaceRules` is dropped for, through a narrower
    // door — and this one arrived pre-filled with the behavior to strip.
    const suggestions = [
      {
        type: 'removeRules' as const,
        behavior: 'deny' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        destination: 'session' as const,
      },
    ];
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always', suggestions);

    expect(updates.some(update => update.type === 'removeRules')).toBe(false);
  });

  it('still grants when the agent suggests an empty rule list', () => {
    // `[].every(...)` is vacuously true, so an empty suggestion used to pass
    // the clamp, claim to be the rule update, and suppress the explicit grant:
    // "Always allow" then granted nothing and the same call asked again.
    const updates = buildPermissionUpdates('Bash', { command: 'git status' }, 'allow-always', [
      { type: 'addRules' as const, behavior: 'allow' as const, rules: [], destination: 'session' as const },
    ]);

    expect(updates).toEqual([{
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      destination: 'projectSettings',
    }]);
  });
});

describe('what the card says an approval grants', () => {
  it('names the rule, and says so plainly when the rule has no pattern', () => {
    // The sentence and the grant come from one call, so a card cannot describe
    // something narrower than what the button writes.
    expect(describeApprovalRule(resolveApprovalRule('Bash', { command: 'git status' }), 'projectSettings'))
      .toBe('Allows Bash(git status) for this project');
    expect(describeApprovalRule(resolveApprovalRule('Read', {}), 'session'))
      .toBe('Allows every Read call for this session');
  });
});
