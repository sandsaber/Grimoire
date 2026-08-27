import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { SubagentAgentRecorder } from '@/app/agents/SubagentAgentRecorder';
import { AgentCoordinator } from '@/core/agents/AgentCoordinator';

/**
 * The adapter between a provider's background subagent and a durable agent.
 *
 * `SubagentManager` knows a provider launched something and what it is called;
 * the agent domain knows what a durable agent is. This is the only thing that
 * knows both, and what it must get right is that **observing the same agent
 * twice records it once** — a subagent's state changes many times and this is
 * called on each.
 */
describe('subagent agent recorder', () => {
  function createRecorder() {
    const storage = new TestDurableStorage();
    let clock = 1_000;
    const coordinator = new AgentCoordinator(storage, { now: () => (clock += 1) });
    const reported: unknown[] = [];
    const recorder = new SubagentAgentRecorder({
      coordinator,
      definitionFor: () => ({
        definitionId: 'task',
        revisionDigest: 'd'.repeat(64),
        source: 'provider-native',
      }),
      // The three ceilings a policy is resolved against, and what the agent's
      // own definition asks for. Nothing here invents a permission: the
      // resolver intersects them.
      policyFor: () => ({
        provider: { granted: ['read'], approvable: ['write'] },
        workspace: { granted: ['read'], approvable: ['write'] },
        root: { granted: ['read'], approvable: [] },
        definition: { requested: ['read'], approvable: [] },
      }),
      now: () => clock,
      report: error => reported.push(error),
    });
    return { coordinator, recorder, reported };
  }

  function running(overrides: Record<string, unknown> = {}) {
    return {
      nativeAgentRef: 'agent_abc123',
      conversationId: 'conv-1',
      providerId: 'claude' as const,
      goal: 'Summarize the vault',
      status: 'running' as const,
      ...overrides,
    };
  }

  it('records a provider-launched agent as one the conversation owns', async () => {
    const { coordinator, recorder, reported } = createRecorder();

    await recorder.observe(running());

    expect(reported).toEqual([]);
    const ids = await coordinator.repositories.instances.listRecordIds();
    expect(ids).toHaveLength(1);
    const instance = await coordinator.repositories.instances.read(ids[0]);
    expect(instance.kind === 'current' && instance.record.payload).toMatchObject({
      origin: 'observed-native',
      rootOwner: { kind: 'conversation', ownerId: 'conv-1' },
      nativeAgentRef: 'agent_abc123',
      // Detached is the whole point: an attached agent dies with its parent,
      // and these are the ones a person starts and walks away from.
      attachment: 'detached',
      status: 'active',
    });
  });

  it('records the same agent once however many times it is seen', async () => {
    // A subagent's state changes many times and this is called on each. The
    // adoption key is derived from the provider's own id, so the second call
    // adopts the instance the first one made.
    const { coordinator, recorder } = createRecorder();

    await recorder.observe(running());
    await recorder.observe(running());
    await recorder.observe(running());

    expect(await coordinator.repositories.instances.listRecordIds()).toHaveLength(1);
    expect(await coordinator.repositories.runs.listRecordIds()).toHaveLength(1);
  });

  it('keeps two agents apart', async () => {
    const { coordinator, recorder } = createRecorder();

    await recorder.observe(running());
    await recorder.observe(running({ nativeAgentRef: 'agent_def456' }));

    expect(await coordinator.repositories.instances.listRecordIds()).toHaveLength(2);
  });

  it('records what it answered when it finishes', async () => {
    const { coordinator, recorder } = createRecorder();
    await recorder.observe(running());

    await recorder.observe(running({ status: 'completed', resultText: 'forty-two notes' }));

    const results = await coordinator.repositories.results.listRecordIds();
    expect(results).toHaveLength(1);
    const result = await coordinator.repositories.results.read(results[0]);
    expect(result.kind === 'current' && result.record.payload).toMatchObject({
      status: 'succeeded',
      finalText: 'forty-two notes',
      provenance: { kind: 'provider-native', providerId: 'claude' },
    });
  });

  it('classifies a failure rather than storing what the provider said', async () => {
    // `.grimoire/control/**` holds no prompts, no reasoning and no raw
    // payloads, and a free-text error message is where one of those arrives.
    const { coordinator, recorder } = createRecorder();
    await recorder.observe(running());

    await recorder.observe(running({ status: 'error', resultText: 'it broke' }));

    const results = await coordinator.repositories.results.listRecordIds();
    const result = await coordinator.repositories.results.read(results[0]);
    expect(result.kind === 'current' && result.record.payload).toMatchObject({
      status: 'failed',
      error: { code: 'subagent-failed', retryable: true },
    });
  });

  it('writes a goal a record can hold, not the description a person typed', async () => {
    // A control record holds a constrained identifier, and "Summarize the
    // vault" is refused at the write — the same shape as the dispatch rejection
    // code the review found, and the same answer: normalize at the boundary
    // rather than make every caller learn the record's rules. The description
    // itself stays where it belongs, in the conversation.
    const { coordinator, recorder, reported } = createRecorder();

    await recorder.observe(running({ goal: 'Summarize the vault, twice!' }));

    expect(reported).toEqual([]);
    const runs = await coordinator.repositories.runs.listRecordIds();
    const run = await coordinator.repositories.runs.read(runs[0]);
    const goalRef = run.kind === 'current' ? run.record.payload.goalRef : '';
    expect(goalRef).toMatch(/^summarize-the-vault-twice-[0-9a-f]{8}$/);
  });

  it('keeps two agents asked the same thing apart', async () => {
    // The slug is the same for both; the agent's own id behind it is what
    // separates them.
    const { coordinator, recorder } = createRecorder();

    await recorder.observe(running({ goal: 'same goal' }));
    await recorder.observe(running({ goal: 'same goal', nativeAgentRef: 'agent_other' }));

    const runs = await coordinator.repositories.runs.listRecordIds();
    const goals = await Promise.all(runs.map(async id => {
      const run = await coordinator.repositories.runs.read(id);
      return run.kind === 'current' ? run.record.payload.goalRef : '';
    }));
    expect(new Set(goals).size).toBe(2);
  });

  it('never lets a failed recording take the turn down with it', async () => {
    // These records exist so work survives a tab. A tab that crashed because
    // one could not be written has survived nothing.
    const { recorder, reported } = createRecorder();

    await expect(recorder.observe(running({ conversationId: '' }))).resolves.toBeUndefined();

    expect(reported).toHaveLength(1);
  });
});
