import '@/providers';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';

interface ProviderTopologyRecord {
  providerId: string;
  processTopology: string;
  backendOwnership: string;
  sessionTopology: string;
  runTopology: string;
  concurrency: string;
  recovery: string;
  historyHydration: string;
  agentObservation: string;
  evidence: string[];
}

interface TopologyFixture {
  schemaVersion: number;
  capturedAt: string;
  providers: ProviderTopologyRecord[];
}

const allowedValues = {
  processTopology: new Set([
    'process-per-run',
    'app-server-per-runtime',
    'persistent-sdk-stream',
    'managed-acp-subprocess',
  ]),
  backendOwnership: new Set(['runtime-instance']),
  sessionTopology: new Set([
    'reconstructed-context',
    'native-thread',
    'native-session',
    'acp-session',
    'acp-session-with-extensions',
  ]),
  runTopology: new Set([
    'single-process',
    'native-turn',
    'sdk-query',
    'acp-request',
  ]),
  concurrency: new Set([
    'one-active-run-per-session',
  ]),
  recovery: new Set([
    'restart-only-before-dispatch',
    'native-resume-and-status',
    'native-session-resume',
    'load-session-and-snapshot',
    'native-resume-and-history-discovery',
    'native-resume-without-hydration',
  ]),
  historyHydration: new Set([
    'provider-native',
    'grimoire-projection',
  ]),
  agentObservation: new Set([
    'full',
    'aggregate',
    'opaque',
    'none',
  ]),
} satisfies Record<
  Exclude<keyof ProviderTopologyRecord, 'providerId' | 'evidence'>,
  ReadonlySet<string>
>;

describe('current provider topology record', () => {
  const fixturePath = resolve(
    process.cwd(),
    'tests/fixtures/provider-traces/current-topologies.json',
  );
  const rawFixture = readFileSync(fixturePath, 'utf8');
  const fixture = JSON.parse(rawFixture) as TopologyFixture;

  it('covers every registered provider exactly once', () => {
    const recordedIds = fixture.providers.map(record => record.providerId);

    expect(new Set(recordedIds).size).toBe(recordedIds.length);
    expect([...recordedIds].sort()).toEqual(
      [...ProviderRegistry.getRegisteredProviderIds()].sort(),
    );
  });

  it('records controlled lifecycle dimensions with repository evidence', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.capturedAt).toBe('2000-01-01T00:00:00.000Z');

    for (const record of fixture.providers) {
      for (const [field, values] of Object.entries(allowedValues)) {
        expect(values.has(record[field as keyof typeof allowedValues])).toBe(true);
      }
      expect(record.evidence.length).toBeGreaterThan(0);
      for (const path of record.evidence) {
        expect(existsSync(resolve(process.cwd(), path))).toBe(true);
      }
    }
  });

  it('pins ownership facts that shape the new execution contract', () => {
    const byProvider = new Map(
      fixture.providers.map(record => [record.providerId, record]),
    );

    expect(byProvider.get('codex')).toMatchObject({
      processTopology: 'app-server-per-runtime',
      backendOwnership: 'runtime-instance',
      concurrency: 'one-active-run-per-session',
    });
    expect(byProvider.get('antigravity')).toMatchObject({
      processTopology: 'process-per-run',
      sessionTopology: 'reconstructed-context',
    });
    expect(byProvider.get('qwen')).toMatchObject({
      recovery: 'native-resume-without-hydration',
      historyHydration: 'grimoire-projection',
    });
  });

  it('contains no machine paths, secrets, or runtime payloads', () => {
    expect(rawFixture).not.toMatch(/\/Users\/|[A-Za-z]:\\|api[_-]?key|secret|token/i);
  });
});
