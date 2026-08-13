import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { AcpMcpProviderId } from '../mcp/AcpMcpStorage';
import { AcpMcpStorage } from '../mcp/AcpMcpStorage';
import { toAcpMcpServers } from '../mcp/toAcpMcpServers';
import type { AcpNewSessionRequest } from '../types';

/**
 * Reads the Grimoire-owned MCP servers a provider's ACP session should carry.
 *
 * Storage is `.grimoire/mcp/<provider>.json`, owned by Grimoire and separate
 * from the CLI's own configuration. The turn preparers call this per turn
 * rather than caching, because a server can be added or disabled between
 * messages and a stale list would silently keep the old tools.
 *
 * A read failure yields no servers instead of failing the turn: MCP is
 * additive, and refusing to send a message because an optional tool list could
 * not be parsed would be worse than sending it without them.
 */
export interface AcpMcpServerSource {
  load(providerId: AcpMcpProviderId): Promise<AcpNewSessionRequest['mcpServers']>;
}

export function createAcpMcpServerSource(
  adapter: Pick<VaultFileAdapter, 'exists' | 'read' | 'write'>,
  onError?: (providerId: AcpMcpProviderId, error: unknown) => void,
): AcpMcpServerSource {
  return {
    async load(providerId) {
      try {
        const servers = await new AcpMcpStorage(adapter, providerId).load();
        return toAcpMcpServers(servers);
      } catch (error) {
        onError?.(providerId, error);
        return [];
      }
    },
  };
}
