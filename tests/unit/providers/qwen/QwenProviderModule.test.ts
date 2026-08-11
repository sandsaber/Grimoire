import trace from '@test/fixtures/provider-traces/qwen-execution.json';

import {
  qwenActiveSessionCommands,
  qwenConfiguredModelsPort,
  qwenHistoryPort,
  qwenProviderModule,
} from '@/providers/qwen/QwenProviderModule';

describe('qwenProviderModule', () => {
  it('declares native ACP resume without fabricated transcript or child-agent fidelity', () => {
    expect(qwenProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(qwenProviderModule.capabilities).toEqual(expect.objectContaining({
      process: { topology: trace.topology, concurrency: trace.concurrency },
      session: { resume: 'native', transcriptHydration: 'unsupported' },
      history: { ownership: trace.historyOwnership },
      commands: { discovery: 'active-session' },
      agents: {
        definitionInventory: 'provider-files',
        spawnOrigins: ['provider-native'],
        stableIdentity: false,
        observation: trace.agentObservation,
        resultExtraction: 'unsupported',
        cancellation: 'unsupported',
        statusQuery: 'unsupported',
        reattachment: 'unsupported',
      },
    }));
  });

  it('round-trips normalized settings and preserves unknown future fields', () => {
    const decoded = qwenProviderModule.settings.decode({
      enabled: true,
      cliPath: ' /bin/qwen ',
      cliPathsByHost: { workstation: ' /opt/qwen ' },
      effortLevel: 'xhigh',
      discoveredModels: [{ rawId: 'qwen3-coder', label: 'Qwen 3 Coder' }],
      modelAliases: { 'qwen3-coder': 'Coder' },
      visibleModels: ['qwen3-coder'],
      futureField: { keep: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected settings to decode.');
    expect(qwenProviderModule.settings.encode(decoded.value, decoded.preservedUnknown))
      .toEqual(expect.objectContaining({
        enabled: true,
        cliPath: '/bin/qwen',
        cliPathsByHost: { workstation: '/opt/qwen' },
        effortLevel: 'xhigh',
        modelAliases: { 'qwen3-coder': 'Coder' },
        visibleModels: ['qwen3-coder'],
        futureField: { keep: true },
      }));
  });

  it('rejects malformed nested settings instead of silently normalizing them', () => {
    const decoded = qwenProviderModule.settings.decode({
      effortLevel: 'ultra',
      cliPathsByHost: { workstation: 42 },
      discoveredModels: [{ rawId: 'model', label: 42 }],
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('Expected invalid settings.');
    expect(decoded.issues).not.toHaveLength(0);
  });

  it('keeps model, command, and visible-history ports truthful', async () => {
    const settings = qwenProviderModule.settings.defaults();
    expect(qwenConfiguredModelsPort.list({
      ...settings,
      discoveredModels: [{ rawId: 'qwen3-coder', label: 'Runtime model' }],
      modelAliases: { 'qwen3-coder': 'Preferred model' },
      visibleModels: ['qwen3-coder'],
    })).toEqual([{
      id: 'qwen:qwen3-coder',
      label: 'Preferred model',
      description: '',
    }]);

    qwenActiveSessionCommands.replace('session-a', [{
      id: 'acp:review',
      name: 'review',
      content: '',
      source: 'sdk',
    }]);
    expect(qwenActiveSessionCommands.list('session-a')).toEqual([
      expect.objectContaining({ name: 'review' }),
    ]);
    expect(qwenActiveSessionCommands.list('session-b')).toEqual([]);
    qwenActiveSessionCommands.clear('session-a');

    const conversation = { sessionId: 'saved-session', messages: [] } as never;
    await expect(qwenHistoryPort.hydrateConversationHistory(conversation, '/vault'))
      .resolves.toBeUndefined();
    expect(qwenHistoryPort.resolveSessionIdForConversation(conversation)).toBe('saved-session');
    expect(trace.cases.visibleHistoryHydration).toEqual(['history/visible:no-op']);
  });

  it('binds every Qwen lifecycle-sensitive trace case to a real assertion', () => {
    expect(Object.keys(trace.cases)).toEqual([
      'initializeNewPrompt',
      'resumeLoadWithoutResponseIdentity',
      'missingSessionReplacement',
      'transientLoadFailure',
      'retryBeforeOutput',
      'restartConfiguration',
      'dynamicConfiguration',
      'approval',
      'question',
      'activeSessionCommands',
      'usageContext',
      'opaqueAgentEvidence',
      'filesystemContainment',
      'visibleHistoryHydration',
    ]);
    expect(qwenProviderModule.capabilities.agents).toEqual({
      definitionInventory: trace.agentEvidence.definitionInventory,
      spawnOrigins: trace.agentEvidence.spawnOrigins,
      stableIdentity: trace.agentEvidence.stableIdentity,
      observation: trace.agentEvidence.observation,
      resultExtraction: trace.agentEvidence.resultExtraction,
      cancellation: trace.agentEvidence.cancellation,
      statusQuery: trace.agentEvidence.statusQuery,
      reattachment: trace.agentEvidence.reattachment,
    });
  });
});
