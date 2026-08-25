import { ConversationRepository } from '../conversations/ConversationRepository';
import type { DurableStorage } from '../persistence/DurableStorage';
import { providerCatalog } from '../providers/ProviderCatalog';
import { ProviderRegistry } from '../providers/ProviderRegistry';
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

  const providerId = (value as { providerId?: unknown }).providerId;
  return providerId === undefined || providerCatalog().has(providerId);
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

/**
 * What a conversation id may be, given that it becomes a file name.
 *
 * A conversation's id is its provider's session id whenever one was resumed, so
 * it is a value Grimoire did not mint and cannot vouch for. Interpolated into a
 * path unchecked, a `/` or a `..` writes outside `.grimoire/sessions/` — and
 * the vault is the user's own notes. One path segment, and one that means the
 * same thing on every filesystem the plugin runs on.
 */
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function requireStorableId(id: string): string {
  if (!SAFE_CONVERSATION_ID.test(id) || id.includes('..')) {
    throw new Error('Conversation id is not usable as a session file name.');
  }
  return id;
}

/**
 * A conversation field one writer changed, and therefore the only thing it may
 * write.
 *
 * The whole point of naming them: a writer that carries a title writes a title.
 * The legacy path wrote the whole conversation the writer happened to be
 * holding, so a background title generator reverted whatever had been appended
 * since it read.
 */
export const CONVERSATION_METADATA_FIELDS = [
  'title',
  'titleGenerationStatus',
  'lastResponseAt',
  'sessionId',
  'model',
  'providerState',
  'messages',
  'currentNote',
  'externalContextPaths',
  'enabledMcpServers',
  'orchestratorMode',
  'usage',
  'resumeAtMessageId',
] as const;

export type ConversationMetadataField = typeof CONVERSATION_METADATA_FIELDS[number];

export class SessionStorage {
  /**
   * @param durable the recoverable replacement a metadata write goes through.
   *   A metadata file is a whole conversation's transcript, and a plain write
   *   torn by a crash or a quit left a truncated JSON file that `loadMetadata`
   *   then answered as a conversation that no longer exists. Injected rather
   *   than built here so this module stays inside `src/core`, which is not
   *   where a vault-shaped implementation belongs.
   */
  private readonly conversations: ConversationRepository;

  constructor(
    private adapter: VaultFileAdapter,
    private readonly durable: DurableStorage,
  ) {
    this.conversations = new ConversationRepository({ storage: durable });
  }

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${requireStorableId(id)}.meta.json`;
  }

  getLegacyMetadataPath(id: string): string {
    return `${LEGACY_SESSIONS_PATH}/${requireStorableId(id)}.meta.json`;
  }

  /**
   * Writes a conversation the vault does not have yet.
   *
   * A create over an id that already exists replaces it, which is what the
   * legacy path did and is preserved here rather than changed inside a
   * persistence milestone: a conversation may be created under a provider's own
   * session id, and refusing that would break resuming into one. It is recorded
   * as an open question, not endorsed.
   */
  async createMetadata(metadata: SessionMetadata): Promise<void> {
    // The vault's own rule, kept ahead of the record store's: it is the
    // stricter of the two, and it is the refusal every caller already handles.
    requireStorableId(metadata.id);
    await this.conversations.merge(metadata.id, metadata, () => metadata);
    await this.deleteLegacyMetadataIfPresent(metadata.id);
  }

  /**
   * Applies the fields this writer changed, leaving every other field as it is
   * on disk.
   *
   * The operation the whole milestone is for. `changed` is what the caller
   * actually set — not everything it happens to be holding — so two writers on
   * one conversation compose instead of the later one reverting the earlier.
   */
  async updateMetadata(
    conversation: Conversation,
    changed: readonly ConversationMetadataField[],
  ): Promise<void> {
    requireStorableId(conversation.id);
    await this.conversations.merge(
      conversation.id,
      projectConversationFields(conversation, changed),
      () => this.toSessionMetadata(conversation),
    );
    await this.deleteLegacyMetadataIfPresent(conversation.id);
  }

  /**
   * Writes a whole conversation over whatever is there.
   *
   * What is left of the legacy write, and it has one caller: relocating a
   * `.claude/sessions` file into `.grimoire/sessions`, where the record being
   * written *is* the whole of what was read a moment ago.
   */
  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    requireStorableId(metadata.id);
    await this.conversations.merge(metadata.id, metadata, () => metadata);
    await this.deleteLegacyMetadataIfPresent(metadata.id);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    try {
      requireStorableId(id);
      const record = await this.conversations.read(id);
      if (record.kind === 'present') {
        return isSupportedSessionMetadata(record.metadata) ? record.metadata : null;
      }
      // A record this build must not act on. Reported as "no conversation" for
      // now, which is what the legacy reader answered for a file it could not
      // parse — surfacing it is the typed-hydration half of this milestone.
      if (record.kind === 'unreadable') {
        return null;
      }

      const found = await this.readLegacyMetadata(id);
      if (!found) {
        return null;
      }
      const metadata: unknown = JSON.parse(found);
      if (!isSupportedSessionMetadata(metadata)) {
        return null;
      }
      await this.saveMetadata(metadata);
      return metadata;
    } catch {
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    requireStorableId(id);
    // Whatever revision it reached: a user deleting a conversation is not racing
    // themselves for a newer version of something they asked to be gone.
    await this.conversations.removeIfPresent(id);
    await this.deleteLegacyMetadataIfPresent(id);
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    const metas: SessionMetadata[] = [];

    const files = await this.listUniqueMetadataFiles();

    for (const filePath of files) {
      try {
        const content = await this.durable.read(filePath);
        if (content === null) {
          continue;
        }
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
      providerState: buildPersistedProviderState(conversation),
      messages: cloneMessagesForMetadata(conversation.messages),
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      orchestratorMode: conversation.orchestratorMode === true ? true : undefined,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
      vaultSearchContexts: collectVaultSearchContexts(conversation.messages),
      assistantResponseMetadata: collectAssistantResponseMetadata(conversation.messages),
    };
  }

  /**
   * The `.claude/sessions` file, where one is still there.
   *
   * Read through the durable store rather than asked about: a write interrupted
   * between the temporary file and the rename leaves the destination missing
   * and the value recoverable, and only a read puts it back.
   */
  private async readLegacyMetadata(id: string): Promise<string | null> {
    return this.durable.read(this.getLegacyMetadataPath(id));
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

  /**
   * The metadata files that exist, including the ones only a recovery finds.
   *
   * Through the durable store rather than the adapter, and that is the whole
   * point: `writeAtomic` renames `x.meta.json` to `x.meta.json.backup` before
   * it renames the pending file into place, so a crash inside that window
   * leaves no `x.meta.json` at all. The adapter's listing then omits the
   * conversation, nothing else ever asks for that id, and it is invisible for
   * good — the exact failure the durable path was added to prevent.
   * `durable.list` completes the interrupted rename first and reports what is
   * there afterwards.
   */
  private async listMetadataFiles(folderPath: string): Promise<string[]> {
    try {
      const files = await this.durable.list(folderPath);
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

/**
 * The metadata fields one writer changed, and nothing else.
 *
 * Each is projected the way `toSessionMetadata` projects it, because what is
 * written has to be the same value either way — the difference is only how much
 * of the conversation goes with it. The derived fields travel with the field
 * they are derived from: the vault search contexts and the response metadata
 * are read out of the messages, so they move when the messages do and stay put
 * when they do not.
 */
function projectConversationFields(
  conversation: Conversation,
  changed: readonly ConversationMetadataField[],
): Partial<SessionMetadata> {
  const fields: Partial<SessionMetadata> = { updatedAt: conversation.updatedAt };
  for (const field of new Set(changed)) {
    switch (field) {
      case 'messages':
        fields.messages = cloneMessagesForMetadata(conversation.messages);
        fields.vaultSearchContexts = collectVaultSearchContexts(conversation.messages);
        fields.assistantResponseMetadata = collectAssistantResponseMetadata(conversation.messages);
        break;
      case 'providerState':
        fields.providerState = buildPersistedProviderState(conversation);
        break;
      case 'orchestratorMode':
        // The same narrowing `toSessionMetadata` does: `false` is the absence of
        // the mode rather than a value worth writing.
        fields.orchestratorMode = conversation.orchestratorMode === true ? true : undefined;
        break;
      default:
        fields[field] = conversation[field] as never;
        break;
    }
  }
  return fields;
}

function buildPersistedProviderState(
  conversation: Conversation,
): Record<string, unknown> | undefined {
  const providerState = ProviderRegistry
    .getConversationHistoryService(conversation.providerId)
    .buildPersistedProviderState?.(conversation)
    ?? conversation.providerState;
  return providerState && Object.keys(providerState).length > 0 ? providerState : undefined;
}
