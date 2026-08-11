import trace from '@test/fixtures/provider-traces/claude-execution.json';

import {
  claudeConfiguredModelsPort,
  claudeProviderModule,
} from '@/providers/claude/ClaudeProviderModule';

describe('claudeProviderModule', () => {
  it('declares the persistent SDK topology and independent native agent capabilities', () => {
    expect(claudeProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(claudeProviderModule.capabilities).toEqual(expect.objectContaining({
      process: { topology: trace.topology, concurrency: trace.concurrency },
      agents: expect.objectContaining({
        stableIdentity: true,
        observation: trace.agentObservation,
        cancellation: 'native',
        statusQuery: 'unsupported',
        reattachment: 'unsupported',
      }),
      controls: expect.objectContaining({ fork: 'native', rewind: 'native' }),
      interactions: { approval: 'native', question: 'native', planExit: 'native' },
    }));
  });

  it('round-trips normalized settings while preserving unknown future fields', () => {
    const decoded = claudeProviderModule.settings.decode({
      enabled: true,
      cliPath: ' /bin/claude ',
      cliPathsByHost: { workstation: ' /opt/claude ' },
      lastModel: 'sonnet',
      discoveredModels: [{ id: 'claude-custom', displayName: 'Custom' }],
      futureField: { keep: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected settings to decode.');

    expect(claudeProviderModule.settings.encode(
      decoded.value,
      decoded.preservedUnknown,
    )).toEqual(expect.objectContaining({
      enabled: true,
      cliPath: '/bin/claude',
      cliPathsByHost: { workstation: '/opt/claude' },
      discoveredModels: [{ id: 'claude-custom', displayName: 'Custom' }],
      futureField: { keep: true },
    }));
  });

  it('uses discovered models first and appends unique configured models', () => {
    const settings = claudeProviderModule.settings.defaults();
    const choices = claudeConfiguredModelsPort.list({
      ...settings,
      discoveredModels: [{ id: 'runtime-model', displayName: 'Runtime model' }],
      customModels: 'runtime-model\nprivate-model',
    });
    expect(choices).toEqual([
      { id: 'runtime-model', label: 'Runtime model', description: '' },
      { id: 'private-model', label: 'private-model', description: 'Custom model' },
    ]);
  });

  it.each([
    ['cli path map', { cliPathsByHost: { workstation: 42 } }],
    ['model entry', { discoveredModels: [{ id: 'model', displayName: 42 }] }],
    ['duplicate model identity', {
      discoveredModels: [
        { id: 'model', displayName: 'One' },
        { id: 'model', displayName: 'Two' },
      ],
    }],
    ['project environment', { projectSettingsSnapshot: { model: '', env: { TOKEN: 42 } } }],
  ])('reports malformed nested %s settings instead of silently normalizing them', (_label, input) => {
    const decoded = claudeProviderModule.settings.decode(input);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('Expected malformed settings.');
    expect(decoded.issues).not.toHaveLength(0);
  });

  it('keeps the sanitized topology trace complete for lifecycle-sensitive cases', () => {
    expect(Object.keys(trace.cases)).toEqual([
      'persistentTurns',
      'dynamicWithoutRestart',
      'restartConfiguration',
      'resumeForkRewind',
      'interactions',
      'interruptCancellation',
      'backgroundAgentLateResult',
      'isolatedAuxiliary',
      'sessionRecovery',
    ]);
    expect(trace.cases.backgroundAgentLateResult).toContain(
      'native-agent-result:task-1:projection',
    );
  });
});
