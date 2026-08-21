import type { AppMcpStorage } from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  ManagedMcpConfigFile,
  ManagedMcpServer,
  McpServerConfig,
} from '../../../core/types';
import { DEFAULT_MCP_SERVER, isValidMcpServerConfig } from '../../../core/types';
import { isRecord } from '../../../utils/records';

const ACP_DEFAULT_CONTEXT_SAVING = false;

export type AcpMcpProviderId =
  | 'opencode'
  | 'grok'
  | 'mimocode'
  | 'kimicode'
  | 'qwen'
  | 'gemini';

type AcpMcpStorageAdapter = Pick<VaultFileAdapter, 'exists' | 'read' | 'write'>;

type GrimoireMcpMetadata = {
  enabled?: boolean;
  contextSaving?: boolean;
  disabledTools?: string[];
  description?: string;
};

export function getAcpMcpConfigPath(providerId: AcpMcpProviderId): string {
  return `.grimoire/mcp/${providerId}.json`;
}

/**
 * Grimoire-owned MCP persistence for ACP providers. ACP has no shared
 * provider-owned config format, so this never reads or rewrites CLI files.
 */
export class AcpMcpStorage implements AppMcpStorage {
  private readonly path: string;

  constructor(
    private readonly adapter: AcpMcpStorageAdapter,
    providerId: AcpMcpProviderId,
  ) {
    this.path = getAcpMcpConfigPath(providerId);
  }

  async load(): Promise<ManagedMcpServer[]> {
    try {
      if (!(await this.adapter.exists(this.path))) return [];

      const parsed: unknown = JSON.parse(await this.adapter.read(this.path));
      if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return [];

      const metadataByServer = getMetadataByServer(parsed);
      const servers: ManagedMcpServer[] = [];

      for (const [name, config] of Object.entries(parsed.mcpServers)) {
        if (!name || !isValidMcpServerConfig(config)) continue;

        const metadata = metadataByServer[name];
        servers.push({
          name,
          config,
          enabled: typeof metadata?.enabled === 'boolean'
            ? metadata.enabled
            : DEFAULT_MCP_SERVER.enabled,
          contextSaving: typeof metadata?.contextSaving === 'boolean'
            ? metadata.contextSaving
            : ACP_DEFAULT_CONTEXT_SAVING,
          disabledTools: normalizeStringArray(metadata?.disabledTools),
          description: typeof metadata?.description === 'string'
            ? metadata.description
            : undefined,
        });
      }

      return servers;
    } catch {
      return [];
    }
  }

  async save(servers: ManagedMcpServer[]): Promise<void> {
    const mcpServers: Record<string, McpServerConfig> = {};
    const metadataByServer: Record<string, GrimoireMcpMetadata> = {};

    for (const server of servers) {
      mcpServers[server.name] = server.config;

      const metadata: GrimoireMcpMetadata = {};
      if (server.enabled !== DEFAULT_MCP_SERVER.enabled) {
        metadata.enabled = server.enabled;
      }
      if (server.contextSaving !== ACP_DEFAULT_CONTEXT_SAVING) {
        metadata.contextSaving = server.contextSaving;
      }

      const disabledTools = normalizeStringArray(server.disabledTools);
      if (disabledTools) metadata.disabledTools = disabledTools;
      if (server.description) metadata.description = server.description;
      if (Object.keys(metadata).length > 0) metadataByServer[server.name] = metadata;
    }

    const file: ManagedMcpConfigFile = { mcpServers };
    if (Object.keys(metadataByServer).length > 0) {
      file._grimoire = { servers: metadataByServer };
    }

    await this.adapter.write(this.path, JSON.stringify(file, null, 2));
  }
}

function getMetadataByServer(file: Record<string, unknown>): Record<string, GrimoireMcpMetadata> {
  if (!isRecord(file._grimoire) || !isRecord(file._grimoire.servers)) return {};

  return Object.fromEntries(
    Object.entries(file._grimoire.servers)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      .map(([name, metadata]) => [name, {
        enabled: typeof metadata.enabled === 'boolean' ? metadata.enabled : undefined,
        contextSaving: typeof metadata.contextSaving === 'boolean' ? metadata.contextSaving : undefined,
        disabledTools: normalizeStringArray(metadata.disabledTools),
        description: typeof metadata.description === 'string' ? metadata.description : undefined,
      }]),
  );
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((item): item is string => typeof item === 'string');
  return normalized.length > 0 ? normalized : undefined;
}

