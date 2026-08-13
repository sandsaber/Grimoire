import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  AssistantResponseMetadata,
  ChatMessage,
  Conversation,
  ConversationMeta,
  PersistedAssistantResponseMetadata,
  PersistedVaultSearchContext,
  SessionMetadata,
} from '../types';
import { LEGACY_SESSIONS_PATH, SESSIONS_PATH } from './StoragePaths';

export {
  LEGACY_SESSIONS_PATH,
  SESSIONS_PATH,
};

function cloneVaultSearchContext(
  entry: PersistedVaultSearchContext,
): PersistedVaultSearchContext {
  return {
    userMessageIndex: entry.userMessageIndex,
    ...(entry.userMessageId ? { userMessageId: entry.userMessageId } : {}),
    context: {
      query: entry.context.query,
      snippets: entry.context.snippets.map((snippet) => ({
        ...snippet,
        source: { ...snippet.source },
        matchedTerms: [...snippet.matchedTerms],
      })),
    },
  };
}

function cloneAssistantResponseMetadata(
  metadata: AssistantResponseMetadata,
): AssistantResponseMetadata | undefined {
  const clone: AssistantResponseMetadata = {};
  const assignString = <K extends keyof AssistantResponseMetadata>(key: K): void => {
    const value = metadata[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        clone[key] = trimmed;
      }
    }
  };

  assignString('providerId');
  assignString('providerLabel');
  assignString('model');
  assignString('modelLabel');
  assignString('effort');
  assignString('effortLabel');

  return Object.keys(clone).length > 0 ? clone : undefined;
}

function cloneMessagesForMetadata(
  messages: ChatMessage[] | undefined,
): ChatMessage[] | undefined {
  if (!messages || messages.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
  } catch {
    return undefined;
  }
}

export function clonePersistedMessages(
  messages: ChatMessage[] | undefined,
): ChatMessage[] {
  return cloneMessagesForMetadata(messages) ?? [];
}

function isSupportedSessionMetadata(value: unknown): value is SessionMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  // Phase 9 cutover — ProviderRegistry.isRegisteredProviderId removed.
  // Accept any providerId; membership validation now happens in the app runtime.
  return true;
}

function getMessagePreview(messages: ChatMessage[] | undefined): string {
  const firstUserMsg = messages?.find(message => message.role === 'user');
  const content = firstUserMsg?.displayContent || firstUserMsg?.content || '';
  return content.substring(0, 50) + (content.length > 50 ? '...' : '');
}

function clonePersistedAssistantResponseMetadata(
  entry: PersistedAssistantResponseMetadata,
): PersistedAssistantResponseMetadata | undefined {
  const metadata = cloneAssistantResponseMetadata(entry.metadata);
  if (!metadata) {
    return undefined;
  }

  return {
    assistantMessageIndex: entry.assistantMessageIndex,
    ...(entry.assistantMessageId ? { assistantMessageId: entry.assistantMessageId } : {}),
    metadata,
  };
}

export function collectVaultSearchContexts(
  messages: ChatMessage[],
): PersistedVaultSearchContext[] | undefined {
  const contexts: PersistedVaultSearchContext[] = [];
  let userMessageIndex = 0;

  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }

    if (message.vaultSearchContext) {
      contexts.push(cloneVaultSearchContext({
        userMessageIndex,
        ...(message.userMessageId ? { userMessageId: message.userMessageId } : {}),
        context: message.vaultSearchContext,
      }));
    }

    userMessageIndex++;
  }

  return contexts.length > 0 ? contexts : undefined;
}

export function collectAssistantResponseMetadata(
  messages: ChatMessage[],
): PersistedAssistantResponseMetadata[] | undefined {
  const entries: PersistedAssistantResponseMetadata[] = [];
  let assistantMessageIndex = 0;

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }

    const metadata = message.responseMetadata
      ? cloneAssistantResponseMetadata(message.responseMetadata)
      : undefined;
    if (metadata) {
      entries.push({
        assistantMessageIndex,
        ...(message.assistantMessageId ? { assistantMessageId: message.assistantMessageId } : {}),
        metadata,
      });
    }

    assistantMessageIndex++;
  }

  return entries.length > 0 ? entries : undefined;
}

export function applyVaultSearchContextsToMessages(
  messages: ChatMessage[],
  contexts: PersistedVaultSearchContext[] | undefined,
): void {
  if (!contexts || contexts.length === 0) {
    return;
  }

  const byUserMessageId = new Map<string, PersistedVaultSearchContext>();
  const byUserMessageIndex = new Map<number, PersistedVaultSearchContext>();

  for (const entry of contexts) {
    if (entry.userMessageId) {
      byUserMessageId.set(entry.userMessageId, entry);
    }
    byUserMessageIndex.set(entry.userMessageIndex, entry);
  }

  let userMessageIndex = 0;
  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }

    const entry = (
      message.userMessageId
        ? byUserMessageId.get(message.userMessageId)
        : undefined
    ) ?? byUserMessageIndex.get(userMessageIndex);
    if (entry) {
      message.vaultSearchContext = cloneVaultSearchContext(entry).context;
    }

    userMessageIndex++;
  }
}

export function applyAssistantResponseMetadataToMessages(
  messages: ChatMessage[],
  entries: PersistedAssistantResponseMetadata[] | undefined,
): void {
  if (!entries || entries.length === 0) {
    return;
  }

  const byAssistantMessageId = new Map<string, PersistedAssistantResponseMetadata>();
  const byAssistantMessageIndex = new Map<number, PersistedAssistantResponseMetadata>();

  for (const rawEntry of entries) {
    const entry = clonePersistedAssistantResponseMetadata(rawEntry);
    if (!entry) {
      continue;
    }
    if (entry.assistantMessageId) {
      byAssistantMessageId.set(entry.assistantMessageId, entry);
    }
    byAssistantMessageIndex.set(entry.assistantMessageIndex, entry);
  }

  let assistantMessageIndex = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }

    const entry = (
      message.assistantMessageId
        ? byAssistantMessageId.get(message.assistantMessageId)
        : undefined
    ) ?? byAssistantMessageIndex.get(assistantMessageIndex);
    const metadata = entry ? cloneAssistantResponseMetadata(entry.metadata) : undefined;
    if (metadata) {
      message.responseMetadata = {
        ...(message.responseMetadata ?? {}),
        ...metadata,
      };
    }

    assistantMessageIndex++;
  }
}

function countSessionSources(meta: SessionMetadata): number | undefined {
  const sources = new Set<string>();

  if (meta.currentNote) {
    sources.add(meta.currentNote);
  }

  for (const path of meta.externalContextPaths ?? []) {
    sources.add(path);
  }

  for (const entry of meta.vaultSearchContexts ?? []) {
    for (const snippet of entry.context.snippets) {
      sources.add(snippet.source.path);
    }
  }

  return sources.size > 0 ? sources.size : undefined;
}

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  getLegacyMetadataPath(id: string): string {
    return `${LEGACY_SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
    await this.deleteLegacyMetadataIfPresent(metadata.id);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    const filePath = await this.getLoadPath(id);

    try {
      if (!filePath) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      const metadata: unknown = JSON.parse(content);
      if (!isSupportedSessionMetadata(metadata)) {
        return null;
      }

      if (filePath !== this.getMetadataPath(id)) {
        await this.saveMetadata(metadata);
      }

      return metadata;
    } catch {
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.adapter.delete(this.getMetadataPath(id));
    await this.deleteLegacyMetadataIfPresent(id);
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    const metas: SessionMetadata[] = [];

    const files = await this.listUniqueMetadataFiles();

    for (const filePath of files) {
      try {
        const content = await this.adapter.read(filePath);
        const raw: unknown = JSON.parse(content);
        if (!isSupportedSessionMetadata(raw)) {
          continue;
        }
        metas.push(raw);

        if (filePath.startsWith(`${LEGACY_SESSIONS_PATH}/`)) {
          await this.saveMetadata(raw);
        }
      } catch {
        // Skip files that fail to load.
      }
    }

    return metas;
  }

  async listAllConversations(): Promise<ConversationMeta[]> {
    const nativeMetas = await this.listMetadata();

    const metas: ConversationMeta[] = nativeMetas.map((meta) => {
      const messages = clonePersistedMessages(meta.messages);
      return {
        id: meta.id,
        providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastResponseAt: meta.lastResponseAt,
        messageCount: messages.length,
        preview: getMessagePreview(messages),
        modelLabel: meta.usage?.model,
        sourceCount: countSessionSources(meta),
        usagePercentage: meta.usage?.percentage,
        titleGenerationStatus: meta.titleGenerationStatus,
      };
    });

    return metas.sort((a, b) =>
      (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt)
    );
  }

  toSessionMetadata(conversation: Conversation): SessionMetadata {
    // Phase 9 cutover — ProviderRegistry.getConversationHistoryService removed.
    // Provider-owned persisted state enrichment now happens in the app runtime.
    const providerState = conversation.providerState;

    return {
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      model: conversation.model,
      providerState: providerState && Object.keys(providerState).length > 0 ? providerState : undefined,
      messages: cloneMessagesForMetadata(conversation.messages),
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      orchestratorMode: conversation.orchestratorMode === true ? true : undefined,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
      vaultSearchContexts: collectVaultSearchContexts(conversation.messages),
      assistantResponseMetadata: collectAssistantResponseMetadata(conversation.messages),
      executionCompletions: conversation.executionCompletions?.map(completion => ({
        ...completion,
      })),
    };
  }

  private async getLoadPath(id: string): Promise<string | null> {
    const filePath = this.getMetadataPath(id);
    if (await this.adapter.exists(filePath)) {
      return filePath;
    }

    const legacyFilePath = this.getLegacyMetadataPath(id);
    if (await this.adapter.exists(legacyFilePath)) {
      return legacyFilePath;
    }

    return null;
  }

  private async deleteLegacyMetadataIfPresent(id: string): Promise<void> {
    const legacyFilePath = this.getLegacyMetadataPath(id);
    if (await this.adapter.exists(legacyFilePath)) {
      await this.adapter.delete(legacyFilePath);
    }
  }

  private async listUniqueMetadataFiles(): Promise<string[]> {
    const preferredFiles = await this.listMetadataFiles(SESSIONS_PATH);
    const fallbackFiles = await this.listMetadataFiles(LEGACY_SESSIONS_PATH);
    const filesByName = new Map<string, string>();

    for (const filePath of preferredFiles) {
      filesByName.set(this.getFileName(filePath), filePath);
    }

    for (const filePath of fallbackFiles) {
      const fileName = this.getFileName(filePath);
      if (!filesByName.has(fileName)) {
        filesByName.set(fileName, filePath);
      }
    }

    return Array.from(filesByName.values());
  }

  private async listMetadataFiles(folderPath: string): Promise<string[]> {
    try {
      const files = await this.adapter.listFiles(folderPath);
      return files.filter((filePath) => filePath.endsWith('.meta.json'));
    } catch {
      return [];
    }
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1] ?? filePath;
  }
}
