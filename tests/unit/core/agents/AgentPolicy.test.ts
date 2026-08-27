import {
  approveAgentPermission,
  resolveEffectiveAgentPolicy,
} from '@/core/agents/AgentPolicy';

describe('AgentPolicy', () => {
  it('intersects every hard ceiling and exposes only declared approval allowance', () => {
    const policy = resolveEffectiveAgentPolicy({
      provider: { granted: ['read'], approvable: ['network', 'write'] },
      workspace: { granted: ['read', 'write'], approvable: ['network'] },
      root: { granted: ['read'], approvable: ['write'] },
      parent: { granted: ['read'], approvable: ['network', 'write'] },
      definition: {
        requested: ['network', 'read', 'shell', 'write'],
        approvable: ['network', 'shell', 'write'],
      },
    });

    expect(policy).toEqual({
      granted: ['read'],
      approvable: ['write'],
      denied: ['network', 'shell'],
    });
  });

  it('never permits approval outside the already intersected allowance', () => {
    const policy = resolveEffectiveAgentPolicy({
      provider: { granted: ['read'], approvable: ['write'] },
      workspace: { granted: ['read'], approvable: ['write'] },
      root: { granted: ['read'], approvable: ['write'] },
      definition: { requested: ['read', 'write'], approvable: ['write'] },
    });

    expect(approveAgentPermission(policy, 'write')).toEqual({
      granted: ['read', 'write'],
      approvable: [],
      denied: [],
    });
    expect(() => approveAgentPermission(policy, 'network'))
      .toThrow('outside the approvable allowance');
  });
});
