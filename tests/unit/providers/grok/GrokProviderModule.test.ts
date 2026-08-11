import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import trace from '@test/fixtures/provider-traces/grok-execution.json';

import {
  grokConfiguredModelsPort,
  grokHistoryPort,
  grokProviderModule,
} from '@/providers/grok/GrokProviderModule';

describe('grokProviderModule', () => {
  it('declares only the provider-shaped native agent capabilities backed by events', () => {
    expect(grokProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(grokProviderModule.capabilities).toEqual(expect.objectContaining({
      process: { topology: trace.topology, concurrency: trace.concurrency },
      session: { resume: 'native', transcriptHydration: 'native' },
      history: { ownership: 'provider-native' },
      agents: expect.objectContaining({
        stableIdentity: true,
        observation: trace.agentObservation,
        resultExtraction: 'native',
        cancellation: 'unsupported',
        reattachment: 'unsupported',
      }),
    }));
  });

  it('round-trips normalized settings and preserves unknown future fields', () => {
    const decoded = grokProviderModule.settings.decode({
      enabled: true,
      cliPath: ' /bin/grok ',
      cliPathsByHost: { workstation: ' /opt/grok ' },
      discoveredModels: [{ rawId: 'provider/model', label: 'Model' }],
      modelAliases: { 'provider/model': 'Preferred model' },
      visibleModels: ['provider/model'],
      futureField: { keep: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected settings to decode.');
    expect(grokProviderModule.settings.encode(
      decoded.value,
      decoded.preservedUnknown,
    )).toEqual(expect.objectContaining({
      enabled: true,
      cliPath: '/bin/grok',
      cliPathsByHost: { workstation: '/opt/grok' },
      modelAliases: { 'provider/model': 'Preferred model' },
      visibleModels: ['provider/model'],
      futureField: { keep: true },
    }));
  });

  it('rejects malformed nested settings instead of silently normalizing them', () => {
    const decoded = grokProviderModule.settings.decode({
      cliPathsByHost: { workstation: 42 },
      discoveredModels: [{ rawId: 'model', label: 42 }],
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('Expected invalid settings.');
    expect(decoded.issues).not.toHaveLength(0);
  });

  it('exposes configured provider models and provider-native history ownership', async () => {
    const settings = grokProviderModule.settings.defaults();
    const models = grokConfiguredModelsPort.list({
      ...settings,
      discoveredModels: [{ rawId: 'provider/model', label: 'Runtime model' }],
      modelAliases: { 'provider/model': 'Preferred model' },
      visibleModels: ['provider/model'],
    });
    expect(models).toEqual([{
      id: 'grok:provider/model',
      label: 'Preferred model',
      description: '',
    }]);
    const directory = await mkdtemp(join(tmpdir(), 'grimoire-grok-module-'));
    const historyPath = join(directory, 'chat_history.jsonl');
    await writeFile(historyPath, JSON.stringify({
      type: 'assistant',
      content: 'hydrated result',
    }), 'utf8');
    try {
      await expect(grokHistoryPort.load('native-session', { sessionDirPath: directory }))
        .resolves.toEqual([expect.objectContaining({
          assistantMessageId: 'grok-assistant-1',
          content: 'hydrated result',
          role: 'assistant',
        })]);
      expect(['history/load:provider-native']).toEqual(trace.cases.databaseHydration);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps every lifecycle-sensitive golden trace case explicit', () => {
    expect(Object.keys(trace.cases)).toEqual([
      'initializeNewPrompt',
      'resumeLoad',
      'missingSessionReplacement',
      'transientLoadFailure',
      'retryBeforeOutput',
      'restartConfiguration',
      'dynamicConfiguration',
      'approval',
      'question',
      'notificationDeduplication',
      'usageBilling',
      'nativeAgentLifecycle',
      'filesystemContainment',
      'databaseHydration',
      'isolatedAuxiliary',
    ]);
  });
});
