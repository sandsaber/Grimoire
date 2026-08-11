import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

import {
  type GeminiHistoryReplayExpectationResolver,
  GeminiHistoryReplayInventoryUnavailableError,
} from './GeminiHistoryReplayFence';

const PROJECT_SLUG = /^[a-z0-9-]+$/;
const SESSION_FILE_PREFIX = 'session-';

interface NativeConversation {
  readonly lastUpdated?: string;
  readonly messages: readonly NativeMessage[];
  readonly sessionId: string;
}

type NativeMessage = Record<string, unknown> & { readonly id: string };

interface NativeProjectLocation {
  readonly allowLegacyMigration: boolean;
  readonly legacyId: string;
  readonly primaryId?: string;
}

export interface GeminiNativeHistoryReplayResolverOptions {
  readonly globalGeminiDir?: string;
  readonly maxProjectEntries?: number;
  readonly maxRegistryBytes?: number;
  readonly maxSessionBytes?: number;
  readonly maxSessionFiles?: number;
}

/** Reads Gemini CLI's native JSON/JSONL session record and mirrors its history emission count. */
export class GeminiNativeHistoryReplayResolver
implements GeminiHistoryReplayExpectationResolver {
  private readonly globalGeminiDir: string;
  private readonly maxProjectEntries: number;
  private readonly maxRegistryBytes: number;
  private readonly maxSessionBytes: number;
  private readonly maxSessionFiles: number;

  constructor(options: GeminiNativeHistoryReplayResolverOptions = {}) {
    this.globalGeminiDir = options.globalGeminiDir ?? path.join(homedir(), '.gemini');
    this.maxProjectEntries = options.maxProjectEntries ?? 10_000;
    this.maxRegistryBytes = options.maxRegistryBytes ?? 1_048_576;
    this.maxSessionBytes = options.maxSessionBytes ?? 16_777_216;
    this.maxSessionFiles = options.maxSessionFiles ?? 10_000;
    for (const bound of [
      this.maxProjectEntries,
      this.maxRegistryBytes,
      this.maxSessionBytes,
      this.maxSessionFiles,
    ]) {
      if (!Number.isSafeInteger(bound) || bound <= 0) {
        throw new Error('Gemini native history bound is invalid.');
      }
    }
  }

  async count(input: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  }): Promise<number> {
    throwIfAborted(input.signal);
    if (!input.sessionId.trim() || !path.isAbsolute(input.cwd)) {
      throw new Error('Gemini native history identity is invalid.');
    }
    const location = await this.resolveProjectLocation(input.cwd, input.signal);
    let conversations = location.primaryId
      ? await this.loadMatchingConversations(
        location.primaryId,
        input.sessionId,
        input.signal,
      )
      : [];
    if (conversations.length === 0
      && location.allowLegacyMigration
      && location.primaryId !== location.legacyId) {
      conversations = await this.loadMatchingConversations(
        location.legacyId,
        input.sessionId,
        input.signal,
      );
    }
    if (conversations.length === 0) {
      throw new GeminiHistoryReplayInventoryUnavailableError();
    }
    const selected = selectLatestConversation(conversations);
    return countReplayNotifications(selected.messages);
  }

  private async resolveProjectLocation(
    cwd: string,
    signal: AbortSignal,
  ): Promise<NativeProjectLocation> {
    const normalizedCwd = normalizeProjectPath(cwd);
    const legacyId = createHash('sha256').update(path.resolve(cwd)).digest('hex');
    const registryPath = path.join(this.globalGeminiDir, 'projects.json');
    const registryText = await readBoundedText(registryPath, this.maxRegistryBytes, signal, true);
    if (registryText !== undefined) {
      const registry = parseRecord(registryText, 'Gemini project registry is malformed.');
      const projects = registry.projects;
      if (!isRecord(projects) || Object.keys(projects).length > this.maxProjectEntries) {
        throw new Error('Gemini project registry is malformed.');
      }
      for (const projectId of Object.values(projects)) validateProjectId(projectId);
      const registered = projects[normalizedCwd];
      if (registered !== undefined) {
        const primaryId = validateProjectId(registered);
        if (await this.hasValidOwnership(primaryId, normalizedCwd, signal)) {
          return {
            primaryId,
            legacyId,
            allowLegacyMigration: await this.canReceiveLegacyMigration(primaryId, signal),
          };
        }
      }
    }

    for (const baseDirectory of ['tmp', 'history']) {
      const root = path.join(this.globalGeminiDir, baseDirectory);
      const entries = await readDirectory(root, this.maxProjectEntries, signal);
      for (const entry of entries) {
        throwIfAborted(signal);
        if (!PROJECT_SLUG.test(entry)) continue;
        const marker = await readBoundedText(
          path.join(root, entry, '.project_root'),
          this.maxRegistryBytes,
          signal,
          true,
        );
        if (marker === undefined || normalizeProjectPath(marker.trim()) !== normalizedCwd) continue;
        if (!await this.hasValidOwnership(entry, normalizedCwd, signal)) {
          throw new Error('Gemini native project ownership is inconsistent.');
        }
        return {
          primaryId: entry,
          legacyId,
          allowLegacyMigration: await this.canReceiveLegacyMigration(entry, signal),
        };
      }
    }

    return { legacyId, allowLegacyMigration: true };
  }

  private async hasValidOwnership(
    projectId: string,
    normalizedCwd: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (const baseDirectory of ['tmp', 'history']) {
      const marker = await readBoundedText(
        path.join(this.globalGeminiDir, baseDirectory, projectId, '.project_root'),
        this.maxRegistryBytes,
        signal,
        true,
      );
      if (marker !== undefined && normalizeProjectPath(marker.trim()) !== normalizedCwd) {
        return false;
      }
    }
    return true;
  }

  private async canReceiveLegacyMigration(projectId: string, signal: AbortSignal): Promise<boolean> {
    const entries = await readDirectory(
      path.join(this.globalGeminiDir, 'tmp', projectId),
      this.maxSessionFiles,
      signal,
    );
    return entries.every(entry => entry === '.project_root');
  }

  private async loadMatchingConversations(
    projectId: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<NativeConversation[]> {
    const chatsDir = path.join(this.globalGeminiDir, 'tmp', projectId, 'chats');
    const entries = await readDirectory(chatsDir, this.maxSessionFiles, signal);
    const shortId = sessionId.slice(0, 8);
    const candidates = entries.filter(file => file.startsWith(SESSION_FILE_PREFIX)
      && (file.endsWith(`-${shortId}.json`) || file.endsWith(`-${shortId}.jsonl`)));
    const conversations: NativeConversation[] = [];
    for (const file of candidates) {
      throwIfAborted(signal);
      const text = await readBoundedText(
        path.join(chatsDir, file),
        this.maxSessionBytes,
        signal,
        false,
      );
      if (text === undefined) continue;
      const conversation = parseNativeConversation(text);
      if (conversation.sessionId === sessionId) conversations.push(conversation);
    }
    return conversations;
  }
}

function parseNativeConversation(text: string): NativeConversation {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Gemini native session history is malformed.');
  const legacy = tryParseRecord(trimmed);
  if (legacy && typeof legacy.sessionId === 'string' && Array.isArray(legacy.messages)) {
    const sessionId = readSessionId(legacy);
    const messages = validateMessages(legacy.messages);
    return { sessionId, messages, lastUpdated: readOptionalString(legacy.lastUpdated) };
  }

  let metadata: Record<string, unknown> = {};
  const messages = new Map<string, NativeMessage>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const record = parseRecord(line, 'Gemini native session history is malformed.');
    if (typeof record.$rewindTo === 'string') {
      rewindMessages(messages, record.$rewindTo);
      continue;
    }
    if (typeof record.id === 'string') {
      messages.set(record.id, validateMessage(record));
      continue;
    }
    if (isRecord(record.$set)) {
      if (Array.isArray(record.$set.messages)) {
        messages.clear();
        for (const message of validateMessages(record.$set.messages)) {
          messages.set(message.id, message);
        }
      }
      metadata = { ...metadata, ...record.$set };
      continue;
    }
    if (typeof record.sessionId === 'string' && typeof record.projectHash === 'string') {
      metadata = { ...metadata, ...record };
      if (Array.isArray(record.messages)) {
        for (const message of validateMessages(record.messages)) {
          messages.set(message.id, message);
        }
      }
    }
  }
  return {
    sessionId: readSessionId(metadata),
    messages: [...messages.values()],
    lastUpdated: readOptionalString(metadata.lastUpdated),
  };
}

function countReplayNotifications(messages: readonly NativeMessage[]): number {
  let count = 0;
  for (const message of messages) {
    const content = nativePartToString(message.content);
    if (message.type === 'user') {
      if (content.trim()) count += 1;
      continue;
    }
    if (message.type !== 'gemini') continue;
    if (message.thoughts !== undefined && !Array.isArray(message.thoughts)) {
      throw new Error('Gemini native session history is malformed.');
    }
    if (message.toolCalls !== undefined && !Array.isArray(message.toolCalls)) {
      throw new Error('Gemini native session history is malformed.');
    }
    count += Array.isArray(message.thoughts) ? message.thoughts.length : 0;
    if (content.trim()) count += 1;
    count += Array.isArray(message.toolCalls) ? message.toolCalls.length : 0;
    if (!Number.isSafeInteger(count)) {
      throw new Error('Gemini native history replay inventory exceeds its bound.');
    }
  }
  return count;
}

function nativePartToString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(nativePartToString).join('');
  if (!isRecord(value)) return '';
  for (const key of [
    'videoMetadata',
    'thought',
    'codeExecutionResult',
    'executableCode',
    'fileData',
    'inlineData',
  ]) {
    if (value[key] !== undefined) return '[native content]';
  }
  for (const key of ['functionCall', 'functionResponse']) {
    if (value[key] !== undefined) {
      if (!isRecord(value[key])) throw new Error('Gemini native session history is malformed.');
      return '[native content]';
    }
  }
  if (value.text === undefined) return '';
  if (typeof value.text !== 'string') {
    throw new Error('Gemini native session history is malformed.');
  }
  return value.text;
}

function validateMessages(value: readonly unknown[]): NativeMessage[] {
  return value.map(message => {
    if (!isRecord(message) || typeof message.id !== 'string') {
      throw new Error('Gemini native session history is malformed.');
    }
    return validateMessage(message);
  });
}

function validateMessage(message: Record<string, unknown>): NativeMessage {
  if (typeof message.id !== 'string' || !message.id.trim()) {
    throw new Error('Gemini native session history is malformed.');
  }
  return { ...message, id: message.id };
}

function rewindMessages(messages: Map<string, NativeMessage>, rewindTo: string): void {
  let found = false;
  for (const id of [...messages.keys()]) {
    if (id === rewindTo) found = true;
    if (found) messages.delete(id);
  }
  if (!found) messages.clear();
}

function selectLatestConversation(conversations: readonly NativeConversation[]): NativeConversation {
  return [...conversations].sort((left, right) => {
    const rightTime = Date.parse(right.lastUpdated ?? '');
    const leftTime = Date.parse(left.lastUpdated ?? '');
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
}

async function readBoundedText(
  filePath: string,
  maximumBytes: number,
  signal: AbortSignal,
  optional: boolean,
): Promise<string | undefined> {
  throwIfAborted(signal);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    throwIfAborted(signal);
    if (!stat.isFile() || stat.size > maximumBytes) {
      throw new Error('Gemini native history file exceeds its bound.');
    }
    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset <= maximumBytes) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) {
      throw new Error('Gemini native history file exceeds its bound.');
    }
    return buffer.toString('utf8', 0, offset);
  } catch (error) {
    if (optional && isFileNotFound(error)) return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readDirectory(
  directory: string,
  maximumEntries: number,
  signal: AbortSignal,
): Promise<string[]> {
  throwIfAborted(signal);
  let handle: Awaited<ReturnType<typeof fs.opendir>> | undefined;
  try {
    handle = await fs.opendir(directory);
    const entries: string[] = [];
    while (true) {
      throwIfAborted(signal);
      const entry = await handle.read();
      if (!entry) break;
      if (entries.length === maximumEntries) {
        throw new Error('Gemini native directory inventory exceeds its bound.');
      }
      entries.push(entry.name);
    }
    return entries;
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  } finally {
    await handle?.close();
  }
}

function validateProjectId(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_SLUG.test(value)) {
    throw new Error('Gemini project registry is malformed.');
  }
  return value;
}

function normalizeProjectPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function readSessionId(record: Record<string, unknown>): string {
  if (typeof record.sessionId !== 'string' || !record.sessionId.trim()) {
    throw new Error('Gemini native session history is malformed.');
  }
  return record.sessionId;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseRecord(text: string, message: string): Record<string, unknown> {
  const value = tryParseRecord(text);
  if (value) return value;
  throw new Error(message);
}

function tryParseRecord(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Gemini native history read was aborted.');
}
