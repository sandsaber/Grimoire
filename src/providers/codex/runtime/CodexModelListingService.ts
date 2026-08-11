import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import type { CodexDiscoveredModel } from '../modelDiscoveryState';
import { formatCodexModelLabel } from '../types/models';
import { CodexAppServerProcess } from './CodexAppServerProcess';
import {
  initializeCodexAppServerTransport,
  resolveCodexAppServerLaunchSpec,
} from './codexAppServerSupport';
import type { CodexRpcTransport } from './CodexRpcTransport';
import { CodexRpcTransport as CodexRpcTransportClass } from './CodexRpcTransport';

interface CodexModelListServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

interface CodexRuntimeModel {
  description?: string;
  displayName?: string;
  hidden?: boolean;
  id?: string;
  isDefault?: boolean;
  model?: string;
}

interface CodexModelListResult {
  data?: CodexRuntimeModel[];
  nextCursor?: string | null;
}

const DEFAULT_MODEL_LIST_TTL_MS = 60_000;
const MODEL_LIST_PAGE_LIMIT = 100;

export class CodexModelListingService {
  private cache: CodexDiscoveredModel[] | null = null;
  private cacheExpiresAt = 0;
  private pending: Promise<CodexDiscoveredModel[]> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly plugin: LegacyProviderContext,
    options: CodexModelListServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_MODEL_LIST_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async listModels(options?: { forceReload?: boolean }): Promise<CodexDiscoveredModel[]> {
    if (options?.forceReload) {
      const models = await this.fetchModels();
      this.storeCache(models);
      return models;
    }

    if (this.cache && this.now() < this.cacheExpiresAt) {
      return this.cache;
    }

    if (this.pending) {
      return this.pending;
    }

    this.pending = this.fetchModels()
      .then((models) => {
        this.storeCache(models);
        return models;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  invalidate(): void {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  private async fetchModels(): Promise<CodexDiscoveredModel[]> {
    const launchSpec = resolveCodexAppServerLaunchSpec(this.plugin, 'codex');
    const process = new CodexAppServerProcess(launchSpec);
    process.start();

    const transport = new CodexRpcTransportClass(process);
    transport.start();

    try {
      await initializeCodexAppServerTransport(transport);
      return await listCodexModelsViaTransport(transport);
    } finally {
      transport.dispose();
      await process.shutdown();
    }
  }

  private storeCache(models: CodexDiscoveredModel[]): void {
    this.cache = models;
    this.cacheExpiresAt = this.now() + this.ttlMs;
  }
}

export async function listCodexModelsViaTransport(
  transport: Pick<CodexRpcTransport, 'request'>,
): Promise<CodexDiscoveredModel[]> {
  const models: CodexDiscoveredModel[] = [];
  let cursor: string | null | undefined;

  do {
    const params: Record<string, unknown> = {
      includeHidden: false,
      limit: MODEL_LIST_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    };
    const result = await transport.request<CodexModelListResult>('model/list', params);
    models.push(...normalizeRuntimeModels(result.data ?? []));
    cursor = result.nextCursor;
  } while (cursor);

  return dedupeDiscoveredModels(models);
}

function normalizeRuntimeModels(models: CodexRuntimeModel[]): CodexDiscoveredModel[] {
  return models.flatMap((model) => {
    if (model.hidden) {
      return [];
    }

    const id = (model.id || model.model || '').trim();
    if (!id) {
      return [];
    }

    const label = (model.displayName || '').trim() || formatCodexModelLabel(id);
    const description = (model.description || '').trim();

    return [{
      ...(description ? { description } : {}),
      id,
      ...(model.isDefault === true ? { isDefault: true } : {}),
      label,
    }];
  });
}

function dedupeDiscoveredModels(models: CodexDiscoveredModel[]): CodexDiscoveredModel[] {
  const seen = new Set<string>();
  const unique: CodexDiscoveredModel[] = [];

  for (const model of models) {
    if (seen.has(model.id)) {
      continue;
    }

    seen.add(model.id);
    unique.push(model);
  }

  return unique;
}
