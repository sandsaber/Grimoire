import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import type {
  AgentInstanceRecord,
  AgentResultRecord,
  AgentRunRecord,
} from '@/core/agents/AgentContracts';
import { AGENT_RUNS_PATH } from '@/core/agents/AgentControlPaths';
import {
  agentInstanceId,
  agentResultId,
  agentRunId,
} from '@/core/agents/AgentIds';
import { AgentRepositories } from '@/core/agents/AgentRepositories';

const INSTANCE_ID = agentInstanceId(`agi-${'1'.repeat(32)}`);
const RUN_ID = agentRunId(`agr-${'2'.repeat(32)}`);

describe('AgentRepositories', () => {
  it('persists only data-minimized agent control records', async () => {
    const repositories = new AgentRepositories(new TestDurableStorage(), () => 10);

    await expect(repositories.instances.create(INSTANCE_ID, instanceRecord()))
      .resolves.toMatchObject({ revision: 1 });
    await expect(repositories.runs.create(RUN_ID, runRecord()))
      .resolves.toMatchObject({ revision: 1 });
    await expect(repositories.instances.create(agentInstanceId(`agi-${'3'.repeat(32)}`), {
      ...instanceRecord(agentInstanceId(`agi-${'3'.repeat(32)}`)),
      prompt: 'must never enter the control journal',
    } as AgentInstanceRecord)).rejects.toThrow('contains unknown fields');
  });

  it('keeps result payloads bounded and rejects hidden or unknown provider fields', async () => {
    const repositories = new AgentRepositories(new TestDurableStorage());
    const result = resultRecord();

    await expect(repositories.results.append(result.agentResultId, result))
      .resolves.toMatchObject({ revision: 1 });
    await expect(repositories.results.append(agentResultId(`ares-${'4'.repeat(32)}`), {
      ...result,
      agentResultId: agentResultId(`ares-${'4'.repeat(32)}`),
      finalText: 'x'.repeat(1024 * 1024 + 1),
    })).rejects.toThrow('no larger than');
    await expect(repositories.results.append(agentResultId(`ares-${'5'.repeat(32)}`), {
      ...result,
      agentResultId: agentResultId(`ares-${'5'.repeat(32)}`),
      hiddenReasoning: 'not a whitelisted result field',
    } as AgentResultRecord)).rejects.toThrow('contains unknown fields');
  });

  describe('the run record\'s own conversation (D10)', () => {
    const RUN_PATH = `${AGENT_RUNS_PATH}/${RUN_ID}.json`;

    it('round trips the reference through a store opened again', async () => {
      const files = new TestDurableStorage();
      await new AgentRepositories(files, () => 10).runs.create(RUN_ID, {
        ...runRecord(),
        conversationId: 'conv-worker-1',
      });

      const read = await new AgentRepositories(files, () => 10).runs.read(RUN_ID);

      expect(read.kind).toBe('current');
      expect(read.kind === 'current' && read.record.payload.conversationId).toBe('conv-worker-1');
    });

    it('reads a record written before the field, and re-stamps it', async () => {
      // **The whole reason the version was bumped rather than the field added
      // quietly.** The run shape is exact, so a build without the field reading
      // a record that has one reports `corrupt` — an error about a well-formed
      // file. With the bump it reports `future`, which is D5's read-only state
      // and what D6's revert safety rests on. This is the other direction: a
      // version-1 record is a version-2 record without the field.
      const files = new TestDurableStorage();
      await new AgentRepositories(files, () => 10).runs.create(RUN_ID, runRecord());
      const stored = JSON.parse(await files.read(RUN_PATH) as string);
      await files.writeAtomic(RUN_PATH, JSON.stringify({ ...stored, schemaVersion: 1 }));

      const read = await new AgentRepositories(files, () => 10).runs.read(RUN_ID);

      expect(read.kind).toBe('migrated');
      expect(read.kind === 'migrated' && read.record.payload.conversationId).toBeUndefined();
    });
  });
});

function instanceRecord(id = INSTANCE_ID): AgentInstanceRecord {
  return {
    agentInstanceId: id,
    providerId: 'codex',
    definition: {
      definitionId: 'researcher',
      revisionDigest: 'a'.repeat(64),
      source: 'provider-files',
    },
    executionMode: 'grimoire-managed',
    origin: 'grimoire-dispatched',
    rootOwner: { kind: 'conversation', ownerId: 'conversation-1' },
    attachment: 'attached',
    observation: 'none',
    runIds: [RUN_ID],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
}

function runRecord(): AgentRunRecord {
  return {
    agentRunId: RUN_ID,
    agentInstanceId: INSTANCE_ID,
    attempt: 1,
    goalRef: 'goal-1',
    policy: { granted: ['read'], approvable: [], denied: [] },
    terminalTransactionId: `tx-${'1'.repeat(32)}`,
    state: 'running',
    resultIds: [],
    observedResultIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function resultRecord(): AgentResultRecord {
  return {
    agentResultId: agentResultId(`ares-${'3'.repeat(32)}`),
    agentInstanceId: INSTANCE_ID,
    agentRunId: RUN_ID,
    status: 'succeeded',
    finalText: 'safe result',
    artifacts: [],
    changedFiles: [],
    citations: [],
    childResultIds: [],
    provenance: { kind: 'grimoire-managed', providerId: 'codex', observedAt: 2 },
    completedAt: 2,
  };
}
