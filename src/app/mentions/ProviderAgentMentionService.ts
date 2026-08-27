import type {
  ProviderAgentMention,
  ProviderAgentMentionsPort,
} from '@/core/providers/ProviderModule';
import type { AgentMentionProvider, AgentMentionSource } from '@/core/providers/types';

/**
 * The `@agents/` list, held by the host and filtered here.
 *
 * The row this replaces was `searchAgents(query)` on every provider, and all
 * five implementations were the same case-insensitive substring match over
 * name, id and description. Four of the five set an agent's id to its own name,
 * so the one filter that looked different — Claude's, which also matches ids —
 * gives the same answer everywhere else. One filter, once.
 *
 * **Synchronous, because the dropdown is.** It filters on each keystroke while
 * the user types, so the list is held rather than fetched: `load()` fills it and
 * `searchAgents` reads it. Before the first load there are no agents, which is
 * what a provider whose definitions have not been read yet has always looked
 * like.
 */
export class ProviderAgentMentionService implements AgentMentionProvider {
  private agents: readonly ProviderAgentMention[] = [];

  constructor(private readonly port: ProviderAgentMentionsPort | undefined) {}

  /** Reads the provider's list. Safe to call again; the last answer wins. */
  async load(): Promise<void> {
    this.agents = await this.port?.list() ?? [];
  }

  /** Asks the provider to re-read its definitions, then takes the new list. */
  async refresh(): Promise<void> {
    await this.port?.refresh();
    await this.load();
  }

  searchAgents(query: string): Array<{
    id: string;
    name: string;
    description?: string;
    source: AgentMentionSource;
  }> {
    const needle = query.toLowerCase();
    return this.agents
      .filter(agent => (
        agent.label.toLowerCase().includes(needle)
        || agent.id.toLowerCase().includes(needle)
        || (agent.description?.toLowerCase().includes(needle) ?? false)
      ))
      .map(agent => ({
        id: agent.id,
        name: agent.label,
        source: agent.source,
        ...(agent.description ? { description: agent.description } : {}),
      }));
  }
}
