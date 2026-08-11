import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import trace from '@test/fixtures/provider-traces/kimicode-execution.json';

import {
  kimicodeConfiguredModelsPort,
  kimicodeHistoryPort,
  kimicodeProviderModule,
} from '@/providers/kimicode/KimicodeProviderModule';

describe('kimicodeProviderModule', () => {
  it('declares the managed ACP topology without fabricated agent capabilities', () => {
    expect(kimicodeProviderModule.execution.descriptor.backendId).toBe(trace.backendId);
    expect(kimicodeProviderModule.capabilities).toEqual(expect.objectContaining({
      process: { topology: trace.topology, concurrency: trace.concurrency },
      session: { resume: 'native', transcriptHydration: 'native' },
      history: { ownership: 'provider-native' },
      agents: expect.objectContaining({
        stableIdentity: false,
        observation: trace.agentObservation,
        resultExtraction: 'unsupported',
        cancellation: 'unsupported',
        reattachment: 'unsupported',
      }),
    }));
  });

  it('round-trips normalized settings and preserves unknown future fields', () => {
    const decoded = kimicodeProviderModule.settings.decode({
      enabled: true,
      cliPath: ' /bin/kimicode ',
      cliPathsByHost: { workstation: ' /opt/kimicode ' },
      discoveredModels: [{ rawId: 'provider/model', label: 'Model' }],
      modelAliases: { 'provider/model': 'Preferred model' },
      visibleModels: ['provider/model'],
      futureField: { keep: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('Expected settings to decode.');
    expect(kimicodeProviderModule.settings.encode(
      decoded.value,
      decoded.preservedUnknown,
    )).toEqual(expect.objectContaining({
      enabled: true,
      cliPath: '/bin/kimicode',
      cliPathsByHost: { workstation: '/opt/kimicode' },
      modelAliases: { 'provider/model': 'Preferred model' },
      visibleModels: ['provider/model'],
      futureField: { keep: true },
    }));
  });

  it('rejects malformed nested settings instead of silently normalizing them', () => {
    const decoded = kimicodeProviderModule.settings.decode({
      cliPathsByHost: { workstation: 42 },
      discoveredModels: [{ rawId: 'model', label: 42 }],
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('Expected invalid settings.');
    expect(decoded.issues).not.toHaveLength(0);
  });

  it('exposes configured provider models and provider-native history ownership', async () => {
    const settings = kimicodeProviderModule.settings.defaults();
    const models = kimicodeConfiguredModelsPort.list({
      ...settings,
      discoveredModels: [{ rawId: 'provider/model', label: 'Runtime model' }],
      modelAliases: { 'provider/model': 'Preferred model' },
      visibleModels: ['provider/model'],
    });
    expect(models).toEqual([{
      id: 'kimicode:provider/model',
      label: 'Preferred model',
      description: '',
    }]);
    const directory = await mkdtemp(join(tmpdir(), 'grimoire-kimicode-module-'));
    const databasePath = join(directory, 'kimicode.db');
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (location: string) => {
        close(): void;
        exec(sql: string): void;
        prepare(sql: string): { run(...params: unknown[]): void };
      };
    };
    const database = new DatabaseSync(databasePath);
    database.exec('create table message (id text, session_id text, time_created integer, data text)');
    database.exec('create table part (id text, message_id text, session_id text, data text)');
    database.prepare('insert into message values (?, ?, ?, ?)').run(
      'assistant-1',
      'native-session',
      1_000,
      '{"role":"assistant","time":{"created":1000,"completed":2000}}',
    );
    database.prepare('insert into part values (?, ?, ?, ?)').run(
      'part-1',
      'assistant-1',
      'native-session',
      '{"type":"text","text":"hydrated result"}',
    );
    database.close();
    try {
      await expect(kimicodeHistoryPort.load('native-session', { databasePath }))
        .resolves.toEqual([expect.objectContaining({
          assistantMessageId: 'assistant-1',
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
      'filesystemContainment',
      'databaseHydration',
      'isolatedAuxiliary',
    ]);
  });
});
