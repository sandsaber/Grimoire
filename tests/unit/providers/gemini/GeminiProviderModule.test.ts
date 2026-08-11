import trace from '@test/fixtures/provider-traces/gemini-execution.json';

import {
  geminiConfiguredModelsPort,
  geminiHistoryPort,
  geminiProviderModule,
} from '@/providers/gemini/GeminiProviderModule';

describe('geminiProviderModule', () => {
  it('declares native ACP resume without fabricated transcript or child-agent fidelity', () => {
    expect(geminiProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(geminiProviderModule.capabilities).toEqual(expect.objectContaining({
      process: { topology: trace.topology, concurrency: trace.concurrency },
      session: { resume: 'native', transcriptHydration: 'unsupported' },
      history: { ownership: trace.historyOwnership },
      commands: { discovery: 'static' },
      agents: {
        definitionInventory: 'provider-files',
        spawnOrigins: [],
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
    const decoded = geminiProviderModule.settings.decode({
      enabled: true,
      cliPath: ' /bin/gemini ',
      cliPathsByHost: { workstation: ' /opt/gemini ' },
      discoveredModels: [{ rawId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
      modelAliases: { 'gemini-2.5-flash': 'Fast' },
      visibleModels: ['gemini-2.5-flash'],
      futureField: { keep: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected settings to decode.');
    expect(geminiProviderModule.settings.encode(decoded.value, decoded.preservedUnknown))
      .toEqual(expect.objectContaining({
        enabled: true,
        cliPath: '/bin/gemini',
        cliPathsByHost: { workstation: '/opt/gemini' },
        modelAliases: { 'gemini-2.5-flash': 'Fast' },
        visibleModels: ['gemini-2.5-flash'],
        futureField: { keep: true },
      }));
  });

  it('rejects malformed nested settings instead of silently normalizing them', () => {
    const decoded = geminiProviderModule.settings.decode({
      cliPathsByHost: { workstation: 42 },
      discoveredModels: [{ rawId: 'model', label: 42 }],
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('Expected invalid settings.');
    expect(decoded.issues).not.toHaveLength(0);
  });

  it('keeps model and visible-history ports truthful', async () => {
    const settings = geminiProviderModule.settings.defaults();
    expect(geminiConfiguredModelsPort.list({
      ...settings,
      discoveredModels: [{ rawId: 'gemini-2.5-flash', label: 'Runtime model' }],
      modelAliases: { 'gemini-2.5-flash': 'Preferred model' },
      visibleModels: ['gemini-2.5-flash'],
    })).toEqual([{
      id: 'gemini:gemini-2.5-flash',
      label: 'Preferred model',
      description: '',
    }]);

    const conversation = { sessionId: 'saved-session', messages: [] } as never;
    await expect(geminiHistoryPort.hydrateConversationHistory(conversation, '/vault'))
      .resolves.toBeUndefined();
    expect(geminiHistoryPort.resolveSessionIdForConversation(conversation)).toBe('saved-session');
    expect(trace.cases.visibleHistoryHydration).toEqual(['history/visible:no-op']);
  });

  it('binds every Gemini lifecycle-sensitive trace case to a real assertion', () => {
    expect(Object.keys(trace.cases)).toEqual([
      'initializeNewPrompt',
      'resumeReplayFence',
      'missingSessionReplacement',
      'transientLoadFailure',
      'retryBeforeOutput',
      'restartConfiguration',
      'dynamicConfiguration',
      'approval',
      'usage',
      'filesystemContainment',
      'visibleHistoryHydration',
    ]);
    expect(geminiProviderModule.capabilities.agents).toEqual({
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
