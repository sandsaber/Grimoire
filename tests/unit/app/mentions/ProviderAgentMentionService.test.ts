import { ProviderAgentMentionService } from '@/app/mentions/ProviderAgentMentionService';

/**
 * The `@agents/` filter, which is the host's now.
 *
 * Five providers each implemented `searchAgents(query)` and all five were the
 * same case-insensitive substring match. What differed was only which fields
 * were searched — Claude's included the id, the other four set the id to the
 * agent's own name — so one filter over all three fields gives every provider
 * the answer it gave before.
 */
describe('ProviderAgentMentionService', () => {
  const AGENTS = [
    { description: 'Reads diffs', id: 'reviewer', label: 'Reviewer', source: 'vault' as const },
    { description: 'Writes tests', id: 'tester-42', label: 'Tester', source: 'plugin' as const },
    { id: 'plain', label: 'Plain', source: 'builtin' as const },
  ];

  function service(agents = AGENTS) {
    return new ProviderAgentMentionService({
      list: async () => agents,
      refresh: async () => undefined,
    });
  }

  it('offers nothing before the list has been read', () => {
    // The dropdown filters on every keystroke, so this is what a provider whose
    // definitions have not been read yet has always looked like.
    expect(service().searchAgents('')).toEqual([]);
  });

  it('offers everything for an empty query', async () => {
    const mentions = service();
    await mentions.load();

    expect(mentions.searchAgents('').map(agent => agent.id))
      .toEqual(['reviewer', 'tester-42', 'plain']);
  });

  it('matches a name, an id, or a description, case-insensitively', async () => {
    const mentions = service();
    await mentions.load();

    expect(mentions.searchAgents('REVIEW').map(agent => agent.id)).toEqual(['reviewer']);
    // Claude is the one provider whose ids differ from its names, and the one
    // whose filter matched them. Matching ids everywhere is the same answer for
    // the other four, whose id *is* the name.
    expect(mentions.searchAgents('42').map(agent => agent.id)).toEqual(['tester-42']);
    expect(mentions.searchAgents('diffs').map(agent => agent.id)).toEqual(['reviewer']);
    expect(mentions.searchAgents('nothing')).toEqual([]);
  });

  it('keeps the source the dropdown shows beside the name', async () => {
    const mentions = service();
    await mentions.load();

    // Absent from the first version of the slot, and read by the dropdown on
    // every result: a user tells a vault agent from one a plugin installed.
    expect(mentions.searchAgents('').map(agent => agent.source))
      .toEqual(['vault', 'plugin', 'builtin']);
  });

  it('leaves an agent with no description out of a description search rather than throwing', async () => {
    const mentions = service();
    await mentions.load();

    expect(mentions.searchAgents('writes').map(agent => agent.id)).toEqual(['tester-42']);
    expect(mentions.searchAgents('').find(agent => agent.id === 'plain')?.description)
      .toBeUndefined();
  });

  it('asks the provider to re-read before taking the new list', async () => {
    const order: string[] = [];
    const mentions = new ProviderAgentMentionService({
      list: async () => { order.push('list'); return AGENTS; },
      refresh: async () => { order.push('refresh'); },
    });

    await mentions.refresh();

    // The other order would take the list the provider had before it re-read,
    // which is the stale answer this exists to avoid.
    expect(order).toEqual(['refresh', 'list']);
  });

  it('offers nothing for a provider that contributes no mentions port', async () => {
    const mentions = new ProviderAgentMentionService(undefined);

    await mentions.load();
    await mentions.refresh();

    expect(mentions.searchAgents('')).toEqual([]);
  });
});
