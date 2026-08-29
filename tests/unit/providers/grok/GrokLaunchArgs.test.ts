import { buildGrokAgentProcessArgs } from '@/providers/grok/runtime/GrokLaunchArgs';

describe('GrokLaunchArgs', () => {
  it('launches stdio without reasoning effort when unset', () => {
    expect(buildGrokAgentProcessArgs(null)).toEqual(['agent', 'stdio']);
    expect(buildGrokAgentProcessArgs('default')).toEqual(['agent', 'stdio']);
  });

  it('passes the native always-approve flag before stdio', () => {
    expect(buildGrokAgentProcessArgs(null, 'always-approve')).toEqual([
      'agent',
      '--always-approve',
      'stdio',
    ]);
    expect(buildGrokAgentProcessArgs('high', 'always-approve')).toEqual([
      'agent',
      '--always-approve',
      '--reasoning-effort',
      'high',
      'stdio',
    ]);
  });

  it('keeps Safe and Plan launches interactive', () => {
    expect(buildGrokAgentProcessArgs(null, 'ask')).toEqual(['agent', 'stdio']);
    expect(buildGrokAgentProcessArgs(null, 'plan')).toEqual(['agent', 'stdio']);
  });

  it('passes --reasoning-effort before stdio for native launch-time effort', () => {
    expect(buildGrokAgentProcessArgs('high')).toEqual([
      'agent',
      '--reasoning-effort',
      'high',
      'stdio',
    ]);
    expect(buildGrokAgentProcessArgs('xhigh')).toEqual([
      'agent',
      '--reasoning-effort',
      'xhigh',
      'stdio',
    ]);
  });
});
